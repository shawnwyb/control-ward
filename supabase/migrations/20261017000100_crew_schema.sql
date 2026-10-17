-- Minimal shared registry. Reconcile with the registry owner's schema before integration.
create schema if not exists extensions;
create extension if not exists postgis with schema extensions;
create extension if not exists pg_cron;
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create type public.hazard_type as enum ('debris', 'wildlife', 'downed_line', 'washout', 'other');
create type public.hazard_status as enum ('open', 'resolved');
create type public.hazard_action as enum ('submitted', 'confirmed', 'resolved', 'expired');

create table public.sites (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 120),
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  report_radius_m integer not null default 5000 check (report_radius_m between 100 and 50000),
  location extensions.geography(Point,4326) generated always as
    (extensions.st_setsrid(extensions.st_makepoint(longitude,latitude),4326)::extensions.geography) stored
);
create table public.site_memberships (
  site_id uuid not null references public.sites(id),
  user_id uuid not null references auth.users(id),
  role text not null default 'crew' check (role in ('crew','supervisor')),
  primary key (site_id,user_id)
);
create index memberships_user on public.site_memberships(user_id,site_id);

create function private.is_site_member(p_site_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.site_memberships
    where site_id=p_site_id and user_id=(select auth.uid()));
$$;
revoke all on function private.is_site_member(uuid) from public,anon;
grant execute on function private.is_site_member(uuid) to authenticated;

create table public.hazard_reports (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id),
  reporter_id uuid not null references auth.users(id),
  type public.hazard_type not null,
  severity smallint not null check (severity between 1 and 3),
  status public.hazard_status not null default 'open',
  location extensions.geography(Point,4326) not null,
  confirmations integer not null default 1 check (confirmations>0),
  created_at timestamptz not null default now(),
  last_confirmed_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolution_reason text check (resolution_reason in ('crew','expired')),
  check ((status='open' and resolved_at is null and resolution_reason is null)
      or (status='resolved' and resolved_at is not null and resolution_reason is not null))
);
create index hazards_location on public.hazard_reports using gist(location);
create index hazards_site_type_open on public.hazard_reports(site_id,type,last_confirmed_at) where status='open';

create table public.hazard_observations (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.hazard_reports(id),
  actor_id uuid references auth.users(id),
  request_id uuid,
  action public.hazard_action not null,
  location extensions.geography(Point,4326) not null,
  severity smallint not null check (severity between 1 and 3),
  created_at timestamptz not null default now(),
  unique(actor_id,request_id)
);
create index observations_report_time on public.hazard_observations(report_id,created_at);
create index observations_location on public.hazard_observations using gist(location);

create table public.hazard_photos (
  id uuid primary key,
  site_id uuid not null references public.sites(id),
  owner_id uuid not null references auth.users(id),
  observation_id uuid references public.hazard_observations(id),
  object_path text unique not null,
  content_type text not null check (content_type in ('image/jpeg','image/png','image/webp')),
  created_at timestamptz not null default now()
);
create index photos_observation on public.hazard_photos(observation_id);

create table private.hazard_requests (
  user_id uuid not null references auth.users(id),
  request_id uuid not null,
  payload jsonb not null,
  response jsonb not null,
  created_at timestamptz not null default now(),
  primary key(user_id,request_id)
);

create table public.hazard_events (
  id bigint generated always as identity primary key,
  report_id uuid not null references public.hazard_reports(id),
  observation_id uuid unique not null references public.hazard_observations(id),
  action public.hazard_action not null,
  created_at timestamptz not null default now()
);
create table public.hazard_checkin_tasks (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.hazard_reports(id),
  user_id uuid not null references auth.users(id),
  confirmation_at timestamptz not null,
  reminder_number integer not null check (reminder_number between 1 and 3),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique(report_id,user_id,confirmation_at,reminder_number)
);
create index tasks_recipient_open on public.hazard_checkin_tasks(user_id) where completed_at is null;

alter table public.sites enable row level security;
alter table public.site_memberships enable row level security;
alter table public.hazard_reports enable row level security;
alter table public.hazard_observations enable row level security;
alter table public.hazard_photos enable row level security;
alter table public.hazard_events enable row level security;
alter table public.hazard_checkin_tasks enable row level security;

revoke all on public.sites,public.site_memberships,public.hazard_reports,public.hazard_observations,
  public.hazard_photos,public.hazard_events,public.hazard_checkin_tasks from anon,authenticated;
grant select on public.sites,public.site_memberships,public.hazard_reports,public.hazard_observations,
  public.hazard_photos,public.hazard_events,public.hazard_checkin_tasks to authenticated;

create policy sites_read on public.sites for select to authenticated using (private.is_site_member(id));
create policy memberships_read on public.site_memberships for select to authenticated using (user_id=(select auth.uid()));
create policy reports_read on public.hazard_reports for select to authenticated using (private.is_site_member(site_id));
create policy observations_read on public.hazard_observations for select to authenticated using (
  exists(select 1 from public.hazard_reports h where h.id=report_id and private.is_site_member(h.site_id)));
create policy photos_read on public.hazard_photos for select to authenticated using (
  private.is_site_member(site_id) and (observation_id is not null or owner_id=(select auth.uid())));
create policy events_read on public.hazard_events for select to authenticated using (
  exists(select 1 from public.hazard_reports h where h.id=report_id and private.is_site_member(h.site_id)));
create policy tasks_read on public.hazard_checkin_tasks for select to authenticated using (
  user_id=(select auth.uid()) and exists(select 1 from public.hazard_reports h where h.id=report_id and private.is_site_member(h.site_id)));

create view public.crew_hazard_feed with (security_invoker=true) as
select h.id,h.site_id,h.reporter_id,h.type,h.severity,h.status,h.confirmations,h.created_at,
  h.last_confirmed_at,h.resolved_at,h.resolution_reason,
  extensions.st_y(h.location::extensions.geometry) as latitude,
  extensions.st_x(h.location::extensions.geometry) as longitude,
  (h.status='open' and h.last_confirmed_at>now()-interval '48 hours') as is_active
from public.hazard_reports h;
grant select on public.crew_hazard_feed to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('hazard-photos','hazard-photos',false,5242880,array['image/jpeg','image/png','image/webp']);
create policy hazard_photo_upload on storage.objects for insert to authenticated with check (
  bucket_id='hazard-photos' and exists(select 1 from public.hazard_photos p
    where p.object_path=name and p.owner_id=(select auth.uid()) and p.observation_id is null
      and p.created_at>now()-interval '1 hour' and private.is_site_member(p.site_id)));
create policy hazard_photo_download on storage.objects for select to authenticated using (
  bucket_id='hazard-photos' and exists(select 1 from public.hazard_photos p
    where p.object_path=name and private.is_site_member(p.site_id)
      and (p.observation_id is not null or p.owner_id=(select auth.uid()))));
create policy hazard_photo_discard on storage.objects for delete to authenticated using (
  bucket_id='hazard-photos' and exists(select 1 from public.hazard_photos p
    where p.object_path=name and p.owner_id=(select auth.uid()) and p.observation_id is null
      and private.is_site_member(p.site_id)));

alter publication supabase_realtime add table public.hazard_reports,public.hazard_checkin_tasks;
