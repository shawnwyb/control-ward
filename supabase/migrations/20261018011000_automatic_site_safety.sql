-- Automatic site checklists replace the required profile/job/review workflow.
-- Keep prior records and RPCs for history; no supervisor input is needed here.
create table public.automatic_safety_runs (
 id uuid primary key default gen_random_uuid(),
 site_id uuid not null references public.sites(id) on delete cascade,
 work_date date not null,
 fingerprint text not null,
 input_snapshot jsonb not null,
 state text not null default 'queued' check(state in ('queued','running','succeeded','failed')),
 attempt integer not null default 0,
 available_at timestamptz not null default now(),
 lease_token uuid,
 leased_until timestamptz,
 created_at timestamptz not null default now(),
 finished_at timestamptz,
 error_category text,
 diagnostics jsonb not null default '{}'::jsonb,
 source_documents jsonb not null default '[]'::jsonb,
 unique(site_id,work_date,fingerprint)
);
create index automatic_safety_queue on public.automatic_safety_runs(available_at) where state in ('queued','running');
create table public.automatic_safety_checklists (
 id uuid primary key default gen_random_uuid(),
 run_id uuid unique not null references public.automatic_safety_runs(id) on delete cascade,
 site_id uuid not null references public.sites(id) on delete cascade,
 work_date date not null,
 input_key text not null,
 content jsonb not null,
 generated_at timestamptz not null default now(),
 valid_until timestamptz not null,
 superseded_at timestamptz
);
create unique index automatic_safety_current on public.automatic_safety_checklists(site_id,work_date) where superseded_at is null;
create table public.automatic_safety_reads (
 checklist_id uuid not null references public.automatic_safety_checklists(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 read_at timestamptz not null default now(),
 primary key(checklist_id,user_id)
);
alter table public.automatic_safety_runs enable row level security;
alter table public.automatic_safety_checklists enable row level security;
alter table public.automatic_safety_reads enable row level security;
revoke all on public.automatic_safety_runs,public.automatic_safety_checklists,public.automatic_safety_reads from public,anon,authenticated;
grant all on public.automatic_safety_runs,public.automatic_safety_checklists,public.automatic_safety_reads to service_role;
grant select on public.automatic_safety_checklists,public.automatic_safety_reads to authenticated;
create policy automatic_safety_members on public.automatic_safety_checklists for select to authenticated using(private.is_site_member(site_id));
create policy automatic_safety_own_receipt on public.automatic_safety_reads for select to authenticated using(user_id=auth.uid() and exists(
 select 1 from public.automatic_safety_checklists c where c.id=checklist_id and private.is_site_member(c.site_id)));

create function private.automatic_safety_snapshot(p_site uuid,p_date date) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('site',jsonb_build_object('id',s.id,'name',s.name,'latitude',s.latitude,'longitude',s.longitude,
   'timezone',s.timezone,'plant_type',s.plant_type,'utility',s.utility),
   'work_date',p_date,'captured_at',now(),'model',cfg.model,
   'hazards',private.safety_snapshot(s.id,p_date)->'hazards',
   'hazard_revision',coalesce(h.hazard_revision,0))
 from public.sites s cross join private.safety_settings cfg left join private.safety_site_state h on h.site_id=s.id where s.id=p_site;
$$;
create function private.automatic_safety_key(p jsonb) returns text
language sql stable set search_path='' as $$
 select md5(jsonb_build_array(p->'site',p->'work_date',p->'model',p->'hazard_revision',
   (select coalesce(jsonb_agg(jsonb_build_array(r->>'unit',r->>'forecast_for',floor((r->>'value')::numeric/2)) order by r->>'unit',r->>'forecast_for'),'[]'::jsonb)
    from jsonb_array_elements(p#>'{hazards,readings}') r where r->>'hazard'='heat'),
   exists(select 1 from jsonb_array_elements(p#>'{hazards,readings}') r where (r->>'observed_at')::timestamptz>now()-interval '2 hours'))::text);
$$;
create function public.enqueue_automatic_safety_checklists(p_now timestamptz default now()) returns integer
language plpgsql security definer set search_path='' as $$
declare s record; d date; snap jsonb; k text; n integer:=0; added integer; begin
 if not (select enabled and model<>'unconfigured' from private.safety_settings) then return 0; end if;
 perform private.safety_lock();
 for s in select x.* from public.sites x where x.eia_plant_id is not null
   and exists(select 1 from public.site_memberships m where m.site_id=x.id) loop
  for d in select (p_now at time zone s.timezone)::date union all
    select (p_now at time zone s.timezone)::date+1 where extract(hour from p_now at time zone s.timezone)>=18 loop
   if exists(select 1 from public.automatic_safety_runs r where r.site_id=s.id and r.work_date=d and r.state in ('queued','running')) then continue; end if;
   snap:=private.automatic_safety_snapshot(s.id,d); k:=private.automatic_safety_key(snap);
   snap:=snap||jsonb_build_object('input_key',k);
   insert into public.automatic_safety_runs(site_id,work_date,fingerprint,input_snapshot)
   values(s.id,d,k||':'||floor(extract(epoch from p_now)/7200)::text,snap) on conflict do nothing;
   get diagnostics added=row_count; n:=n+added;
  end loop;
 end loop;
 return n;
end $$;
create function public.claim_automatic_safety_runs() returns setof public.automatic_safety_runs
language plpgsql security definer set search_path='' as $$ begin
 if not (select enabled and model<>'unconfigured' from private.safety_settings) then return; end if;
 update public.automatic_safety_runs set state='failed',error_category='lease_exhausted',finished_at=now()
 where state='running' and leased_until<now() and attempt>=3;
 return query with candidate as (
  select id from public.automatic_safety_runs where attempt<3 and ((state='queued' and available_at<=now()) or (state='running' and leased_until<now()))
  order by available_at,id for update skip locked limit 1)
 update public.automatic_safety_runs r set state='running',attempt=r.attempt+1,lease_token=gen_random_uuid(),leased_until=now()+interval '150 seconds'
 from candidate c where c.id=r.id returning r.*;
end $$;
create function private.automatic_safety_official_url(p_url text) returns boolean
language sql immutable set search_path='' as $$
 select p_url ~ '^https://([a-z0-9-]+\.)+gov(/[^[:space:]]*)?$'
   or p_url ~ '^https://([a-z0-9-]+\.)*state\.[a-z]{2}\.us(/[^[:space:]]*)?$';
$$;
create function public.finish_automatic_safety_run(p_run_id uuid,p_lease_token uuid,p_content jsonb default null,p_documents jsonb default '[]'::jsonb,p_error text default null,p_diagnostics jsonb default '{}'::jsonb) returns boolean
language plpgsql security definer set search_path='' as $$
declare r public.automatic_safety_runs; item jsonb; citation jsonb; src jsonb; doc jsonb; tz text; current_key text; begin
 perform private.safety_lock();
 select * into r from public.automatic_safety_runs where id=p_run_id and state='running' and lease_token=p_lease_token and leased_until>now() for update;
 if r.id is null then return false; end if;
 if p_error is not null then
  update public.automatic_safety_runs set state=case when attempt<3 then 'queued' else 'failed' end,
    available_at=now()+make_interval(secs=>30*attempt),error_category=left(p_error,80),diagnostics=p_diagnostics,
    lease_token=null,leased_until=null,finished_at=case when attempt>=3 then now() end where id=r.id;
  return true;
 end if;
 if jsonb_typeof(p_content) is distinct from 'object' or length(p_content::text)>120000
   or jsonb_typeof(p_content->'items') is distinct from 'array' or jsonb_array_length(p_content->'items')>20
   or jsonb_typeof(p_content->'sources') is distinct from 'array' or jsonb_array_length(p_content->'sources')>8
   or jsonb_typeof(p_content->'coverage_gaps') is distinct from 'array'
   or not (p_content->'coverage_gaps' ? 'Employer coverage and task-specific applicability cannot be inferred from a site''s location. Regulatory excerpts retain their scope; this checklist is not a determination of complete legal coverage.')
   or p_content->'conditions' is distinct from r.input_snapshot#>'{hazards,readings}'
   or p_content->'alerts' is distinct from r.input_snapshot#>'{hazards,alerts}'
   or jsonb_typeof(p_documents) is distinct from 'array' or length(p_documents::text)>500000 then raise exception 'Invalid automatic checklist'; end if;
 for src in select value from jsonb_array_elements(p_content->'sources') loop
  if not coalesce(private.automatic_safety_official_url(src->>'url'),false) then raise exception 'Official source URL required'; end if;
  select value into doc from jsonb_array_elements(p_documents) where value->>'id'=src->>'id' and value->>'url'=src->>'url';
  if doc is null then raise exception 'Source document missing'; end if;
 end loop;
 for item in select value from jsonb_array_elements(p_content->'items') loop
  if item->>'kind' not in ('regulation','guidance') or length(coalesce(item->>'text','')) not between 1 and 2000
   or jsonb_typeof(item->'citations') is distinct from 'array' or jsonb_array_length(item->'citations') not between 1 and 4 then raise exception 'Invalid automatic item'; end if;
  for citation in select value from jsonb_array_elements(item->'citations') loop
   select value into src from jsonb_array_elements(p_content->'sources') where value->>'id'=citation->>'source_id';
   select value into doc from jsonb_array_elements(p_documents) where value->>'id'=citation->>'source_id';
   if src is null or doc is null or length(coalesce(citation->>'quote',''))<20
     or strpos(doc->>'text',citation->>'quote')=0 then raise exception 'Citation does not match official document'; end if;
  end loop;
  if item->>'text' is distinct from item#>>'{citations,0,quote}' then raise exception 'Instruction must retain the quoted source wording'; end if;
 end loop;
 current_key:=private.automatic_safety_key(private.automatic_safety_snapshot(r.site_id,r.work_date));
 if current_key<>r.input_snapshot->>'input_key' then
  update public.automatic_safety_runs set state='failed',error_category='inputs_changed',finished_at=now(),lease_token=null,leased_until=null where id=r.id;
  return false;
 end if;
 select timezone into tz from public.sites where id=r.site_id;
 update public.automatic_safety_checklists set superseded_at=now() where site_id=r.site_id and work_date=r.work_date and superseded_at is null;
 insert into public.automatic_safety_checklists(run_id,site_id,work_date,input_key,content,valid_until)
 values(r.id,r.site_id,r.work_date,current_key,p_content,(r.work_date+1)::timestamp at time zone tz);
 update public.automatic_safety_runs set state='succeeded',finished_at=now(),diagnostics=p_diagnostics,source_documents=p_documents,
  lease_token=null,leased_until=null,error_category=null where id=r.id;
 return true;
end $$;
create function public.get_automatic_safety_workspace(p_site_id uuid,p_work_date date) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare c public.automatic_safety_checklists; r public.automatic_safety_runs; k text; begin
 if not private.is_site_member(p_site_id) then raise exception 'Site membership required' using errcode='42501'; end if;
 select * into c from public.automatic_safety_checklists where site_id=p_site_id and work_date=p_work_date and superseded_at is null;
 select * into r from public.automatic_safety_runs where site_id=p_site_id and work_date=p_work_date order by created_at desc,id desc limit 1;
 k:=private.automatic_safety_key(private.automatic_safety_snapshot(p_site_id,p_work_date));
 return jsonb_build_object('enabled',(select enabled and model<>'unconfigured' from private.safety_settings),
  'run',case when r.id is null then null else jsonb_build_object('state',r.state,'attempt',r.attempt,'error_category',r.error_category) end,
  'checklist',case when c.id is null then null else jsonb_build_object('id',c.id,'work_date',c.work_date,'content',c.content,'generated_at',c.generated_at,'valid_until',c.valid_until,
   'current',c.valid_until>now() and c.generated_at>now()-interval '4 hours' and c.input_key=k,
   'acknowledged',exists(select 1 from public.automatic_safety_reads where checklist_id=c.id and user_id=auth.uid())) end);
end $$;
create function public.acknowledge_automatic_safety_checklist(p_checklist_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare c public.automatic_safety_checklists; w jsonb; begin
 perform private.safety_lock();
 select * into c from public.automatic_safety_checklists where id=p_checklist_id;
 if c.id is null or not private.is_site_member(c.site_id) then raise exception 'Site membership required' using errcode='42501'; end if;
 w:=public.get_automatic_safety_workspace(c.site_id,c.work_date);
 if (w#>>'{checklist,id}') is distinct from c.id::text or not coalesce((w#>>'{checklist,current}')::boolean,false) then raise exception 'Checklist no longer current; refresh'; end if;
 insert into public.automatic_safety_reads values(c.id,auth.uid(),now()) on conflict do nothing;
end $$;
revoke all on function private.automatic_safety_snapshot(uuid,date),private.automatic_safety_key(jsonb),private.automatic_safety_official_url(text) from public,anon,authenticated;
revoke all on function public.enqueue_automatic_safety_checklists(timestamptz),public.claim_automatic_safety_runs(),public.finish_automatic_safety_run(uuid,uuid,jsonb,jsonb,text,jsonb) from public,anon,authenticated;
grant execute on function public.enqueue_automatic_safety_checklists(timestamptz),public.claim_automatic_safety_runs(),public.finish_automatic_safety_run(uuid,uuid,jsonb,jsonb,text,jsonb) to service_role;
revoke all on function public.get_automatic_safety_workspace(uuid,date),public.acknowledge_automatic_safety_checklist(uuid) from public,anon;
grant execute on function public.get_automatic_safety_workspace(uuid,date),public.acknowledge_automatic_safety_checklist(uuid) to authenticated;
-- Retire the old job-plan/source-review schedules, while retaining their historical data.
select cron.unschedule(jobid) from cron.job where jobname in ('safety-enqueue-evening','safety-refresh-inputs','safety-refresh-sources');
select cron.schedule('safety-enqueue-automatic','* * * * *','select public.enqueue_automatic_safety_checklists()');
-- safety-generate-worker already invokes generate-safety-briefings behind the global switch.
