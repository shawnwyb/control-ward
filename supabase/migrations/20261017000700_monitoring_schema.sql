-- Monitoring layer: registry attributes, readings, lightning, scores, alerts, crew locations, briefings.
-- Edge Functions write through the worker RPCs in the next migration; clients read through RLS.

alter table public.sites
  add column timezone text not null default 'America/New_York',
  add column eia_plant_id text unique,
  add column utility text,
  add column plant_type text,
  add column fema_flood_zone text,
  add column river_distance_m integer check (river_distance_m >= 0),
  add column coast_distance_m integer check (coast_distance_m >= 0);
-- CHECK cannot use a subquery, so time zone names are validated by trigger.
create function private.validate_site_timezone() returns trigger
language plpgsql set search_path='' as $$
begin
  if not exists(select 1 from pg_catalog.pg_timezone_names where name=new.timezone) then
    raise exception 'Unknown time zone %',new.timezone using errcode='22023';
  end if;
  return new;
end; $$;
create trigger sites_timezone before insert or update of timezone on public.sites
  for each row execute function private.validate_site_timezone();

create function private.is_site_supervisor(p_site_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.site_memberships
    where site_id=p_site_id and user_id=(select auth.uid()) and role='supervisor');
$$;
revoke all on function private.is_site_supervisor(uuid) from public,anon;
grant execute on function private.is_site_supervisor(uuid) to authenticated;

create type public.hazard_kind as enum ('weather','lightning','flood','heat','wildfire','soil','wildlife');

create table public.readings (
  id bigint generated always as identity primary key,
  site_id uuid not null references public.sites(id) on delete cascade,
  hazard public.hazard_kind not null,
  value double precision not null,
  unit text not null,
  observed_at timestamptz not null,
  forecast_for timestamptz not null default '-infinity',
  source text not null default 'live' check (source<>''),
  unique(site_id,hazard,observed_at,forecast_for,source)
);
create index readings_latest on public.readings(site_id,hazard,observed_at desc);

create table public.lightning_strikes (
  id bigint generated always as identity primary key,
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  location extensions.geography(Point,4326) generated always as
    (extensions.st_setsrid(extensions.st_makepoint(longitude,latitude),4326)::extensions.geography) stored,
  struck_at timestamptz not null,
  source text not null default 'live' check (source<>''),
  unique(source,struck_at,latitude,longitude)
);
create index strikes_location on public.lightning_strikes using gist(location);
create index strikes_time on public.lightning_strikes(struck_at desc);

create table public.lightning_state (
  site_id uuid primary key references public.sites(id) on delete cascade,
  status text not null default 'clear' check (status in ('clear','stop_work')),
  last_strike_at timestamptz,
  last_strike_distance_m integer,
  updated_at timestamptz not null default now()
);

create table public.site_subscores (
  site_id uuid primary key references public.sites(id) on delete cascade,
  weather numeric(3,1) not null default 0 check (weather between 0 and 10),
  lightning numeric(3,1) not null default 0 check (lightning between 0 and 10),
  flood numeric(3,1) not null default 0 check (flood between 0 and 10),
  heat numeric(3,1) not null default 0 check (heat between 0 and 10),
  wildfire numeric(3,1) not null default 0 check (wildfire between 0 and 10),
  soil numeric(3,1) not null default 0 check (soil between 0 and 10),
  wildlife numeric(3,1) not null default 0 check (wildlife between 0 and 10),
  top_driver text,
  computed_at timestamptz not null default now()
);

create table public.ml_scores (
  site_id uuid not null references public.sites(id) on delete cascade,
  horizon text not null check (horizon in ('now','tomorrow')),
  score numeric(3,1) not null check (score between 0 and 10),
  model_version text not null,
  computed_at timestamptz not null default now(),
  primary key(site_id,horizon)
);

create table public.site_risk (
  site_id uuid not null references public.sites(id) on delete cascade,
  horizon text not null check (horizon in ('now','tomorrow')),
  risk numeric(3,1) not null check (risk between 0 and 10),
  base numeric(3,1) not null,
  crew_term numeric(3,2) not null,
  top_driver text,
  computed_at timestamptz not null default now(),
  primary key(site_id,horizon)
);

create table public.alerts (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id) on delete cascade,
  kind text not null check (kind in ('lightning','flood','heat','wildfire','other')),
  level text not null check (level in ('info','warning','stop_work')),
  status text not null default 'active' check (status in ('active','cleared')),
  payload jsonb not null default '{}'::jsonb,
  dedup_key text not null,
  created_at timestamptz not null default now(),
  cleared_at timestamptz,
  check ((status='active' and cleared_at is null) or (status='cleared' and cleared_at is not null))
);
-- One active alert per site and event; cleared alerts keep history.
create unique index alerts_one_active on public.alerts(dedup_key) where status='active';
create index alerts_site_status on public.alerts(site_id,status,created_at desc);

create table public.alert_acks (
  alert_id uuid not null references public.alerts(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  acknowledged_at timestamptz not null default now(),
  primary key(alert_id,user_id)
);

create table public.crew_locations (
  user_id uuid primary key references auth.users(id),
  site_id uuid not null references public.sites(id) on delete cascade,
  location extensions.geography(Point,4326) not null,
  accuracy_m real check (accuracy_m >= 0),
  updated_at timestamptz not null default now()
);
create index crew_locations_geo on public.crew_locations using gist(location);

create table public.briefings (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id) on delete cascade,
  for_date date not null,
  content jsonb not null,
  generated_at timestamptz not null default now(),
  unique(site_id,for_date)
);
create table public.briefing_reads (
  briefing_id uuid not null references public.briefings(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  read_at timestamptz not null default now(),
  primary key(briefing_id,user_id)
);
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  channel text not null check (channel in ('web_push','sms')),
  address text not null check (length(address) between 3 and 2000),
  created_at timestamptz not null default now(),
  unique(user_id,channel,address)
);

alter table public.readings enable row level security;
alter table public.lightning_strikes enable row level security;
alter table public.lightning_state enable row level security;
alter table public.site_subscores enable row level security;
alter table public.ml_scores enable row level security;
alter table public.site_risk enable row level security;
alter table public.alerts enable row level security;
alter table public.alert_acks enable row level security;
alter table public.crew_locations enable row level security;
alter table public.briefings enable row level security;
alter table public.briefing_reads enable row level security;
alter table public.push_subscriptions enable row level security;

revoke all on public.readings,public.lightning_strikes,public.lightning_state,public.site_subscores,public.ml_scores,
  public.site_risk,public.alerts,public.alert_acks,public.crew_locations,public.briefings,public.briefing_reads,
  public.push_subscriptions from anon,authenticated;
grant select on public.readings,public.lightning_state,public.site_subscores,public.ml_scores,public.site_risk,
  public.alerts,public.alert_acks,public.crew_locations,public.briefings,public.briefing_reads to authenticated;
grant select,insert,delete on public.push_subscriptions to authenticated;

create policy readings_read on public.readings for select to authenticated using (private.is_site_member(site_id));
create policy lightning_state_read on public.lightning_state for select to authenticated using (private.is_site_member(site_id));
create policy subscores_read on public.site_subscores for select to authenticated using (private.is_site_member(site_id));
create policy ml_read on public.ml_scores for select to authenticated using (private.is_site_member(site_id));
create policy risk_read on public.site_risk for select to authenticated using (private.is_site_member(site_id));
create policy alerts_read on public.alerts for select to authenticated using (private.is_site_member(site_id));
create policy acks_read on public.alert_acks for select to authenticated using (
  user_id=(select auth.uid()) or exists(select 1 from public.alerts a where a.id=alert_id and private.is_site_supervisor(a.site_id)));
-- Crew may see only their own location; supervisors see everyone at their sites.
create policy locations_read on public.crew_locations for select to authenticated using (
  user_id=(select auth.uid()) or private.is_site_supervisor(site_id));
create policy briefings_read on public.briefings for select to authenticated using (private.is_site_member(site_id));
create policy briefing_reads_read on public.briefing_reads for select to authenticated using (user_id=(select auth.uid()));
create policy push_own_select on public.push_subscriptions for select to authenticated using (user_id=(select auth.uid()));
create policy push_own_insert on public.push_subscriptions for insert to authenticated with check (user_id=(select auth.uid()));
create policy push_own_delete on public.push_subscriptions for delete to authenticated using (user_id=(select auth.uid()));

grant select,insert,update,delete on public.readings,public.lightning_strikes,public.lightning_state,public.site_subscores,
  public.ml_scores,public.site_risk,public.alerts,public.alert_acks,public.crew_locations,public.briefings,
  public.briefing_reads,public.push_subscriptions to service_role;
grant usage,select on all sequences in schema public to service_role;
grant update on public.sites to service_role;

-- Views (security_invoker: RLS of the caller applies).
create view public.site_overview with (security_invoker=true) as
select s.id as site_id,s.name,s.latitude as lat,s.longitude as lon,s.timezone,
  rn.risk as risk_now,rt.risk as risk_tomorrow,coalesce(rn.top_driver,sc.top_driver) as top_driver,
  jsonb_build_object('weather',sc.weather,'lightning',sc.lightning,'flood',sc.flood,'heat',sc.heat,
    'wildfire',sc.wildfire,'soil',sc.soil,'wildlife',sc.wildlife) as subscores,
  jsonb_build_object('status',coalesce(ls.status,'clear'),'last_strike_at',ls.last_strike_at) as lightning,
  (select count(*) from public.alerts a where a.site_id=s.id and a.status='active') as active_alert_count
from public.sites s
left join public.site_risk rn on rn.site_id=s.id and rn.horizon='now'
left join public.site_risk rt on rt.site_id=s.id and rt.horizon='tomorrow'
left join public.site_subscores sc on sc.site_id=s.id
left join public.lightning_state ls on ls.site_id=s.id
order by rn.risk desc nulls last,s.name;

create view public.crew_locations_live with (security_invoker=true) as
select c.user_id,c.site_id,
  extensions.st_y(c.location::extensions.geometry) as latitude,
  extensions.st_x(c.location::extensions.geometry) as longitude,
  c.accuracy_m,c.updated_at,(c.updated_at<now()-interval '5 minutes') as is_stale
from public.crew_locations c;

create view public.hazard_heatmap with (security_invoker=true) as
select o.site_id,o.type,
  round(o.latitude::numeric,3) as cell_lat,round(o.longitude::numeric,3) as cell_lon,
  count(*) as observation_count,max(o.severity) as max_severity,max(o.created_at) as last_seen
from public.crew_observation_feed o
where o.action in ('submitted','confirmed')
group by o.site_id,o.type,round(o.latitude::numeric,3),round(o.longitude::numeric,3);

grant select on public.site_overview,public.crew_locations_live,public.hazard_heatmap to authenticated,service_role;

alter publication supabase_realtime add table public.alerts,public.lightning_state,public.site_risk,public.crew_locations;
