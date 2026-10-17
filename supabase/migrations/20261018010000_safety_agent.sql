-- Independent safety briefing workflow. Existing risk/alerts/briefings remain authoritative.
create table private.safety_settings (
  singleton boolean primary key default true check(singleton),
  enabled boolean not null default false,
  model text not null default 'unconfigured',
  prompt_version text not null default 'safety-v1'
);
insert into private.safety_settings default values;

create table public.site_safety_profiles (
  site_id uuid primary key references public.sites(id) on delete cascade,
  revision integer not null check(revision>0),
  profile jsonb not null,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);
create table public.job_plans (
  site_id uuid not null references public.sites(id) on delete cascade,
  work_date date not null,
  revision integer not null check(revision>0),
  job jsonb not null,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  primary key(site_id,work_date)
);
create table public.safety_sources (
  id uuid primary key default gen_random_uuid(),
  source_key text unique not null,
  site_id uuid references public.sites(id) on delete cascade,
  category text not null check(category in ('official','company_policy')),
  title text not null,
  issuing_body text not null,
  canonical_url text,
  audience text not null check(audience in ('crew','supervisor')),
  check ((category='official' and site_id is null and canonical_url like 'https://www.osha.gov/%')
    or (category='company_policy' and site_id is not null and canonical_url is null))
);
create table public.safety_source_versions (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.safety_sources(id) on delete cascade,
  content_hash text not null,
  status text not null default 'candidate' check(status in ('candidate','approved','superseded','rejected')),
  jurisdiction text not null,
  task_tags text[] not null,
  effective_on date,
  superseded_on date,
  fetched_at timestamptz not null default now(),
  last_checked_at timestamptz not null default now(),
  reviewed_at timestamptz,
  review_notes text,
  fictional boolean not null default false,
  conflicts boolean not null default false,
  unique(source_id,content_hash)
);
create unique index safety_one_approved_source on public.safety_source_versions(source_id) where status='approved';
create table public.safety_passages (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.safety_source_versions(id) on delete cascade,
  anchor text not null,
  excerpt text not null check(length(excerpt) between 1 and 20000),
  instruction text not null check(length(instruction) between 1 and 2000),
  conditions text not null,
  search_vector tsvector generated always as (to_tsvector('english',anchor||' '||excerpt||' '||instruction)) stored,
  unique(version_id,anchor)
);
create index safety_passages_search on public.safety_passages using gin(search_vector);
create table private.safety_site_state (
  site_id uuid primary key references public.sites(id) on delete cascade,
  hazard_revision bigint not null default 0
);
create table public.safety_briefing_runs (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id) on delete cascade,
  work_date date not null,
  fingerprint text not null,
  input_snapshot jsonb not null,
  state text not null default 'queued' check(state in ('queued','running','succeeded','failed')),
  attempt integer not null default 0,
  lease_token uuid,
  leased_until timestamptz,
  available_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  error_category text,
  diagnostics jsonb not null default '{}'::jsonb,
  unique(site_id,work_date,fingerprint)
);
create index safety_runs_queue on public.safety_briefing_runs(available_at) where state in ('queued','running');
create table public.safety_run_evidence (
  run_id uuid not null references public.safety_briefing_runs(id) on delete cascade,
  evidence_id text not null,
  evidence jsonb not null,
  primary key(run_id,evidence_id)
);
create table public.safety_briefing_revisions (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.safety_briefing_runs(id) on delete cascade,
  site_id uuid not null references public.sites(id) on delete cascade,
  work_date date not null,
  revision integer not null,
  content jsonb not null,
  author_id uuid references auth.users(id),
  provenance text not null check(provenance in ('agent','supervisor')),
  created_at timestamptz not null default now(),
  unique(site_id,work_date,revision)
);
create table public.safety_briefing_publications (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id) on delete cascade,
  work_date date not null,
  revision_id uuid unique not null references public.safety_briefing_revisions(id),
  worker_payload jsonb not null,
  published_by uuid not null references auth.users(id),
  published_at timestamptz not null default now(),
  valid_until timestamptz not null,
  status text not null default 'published' check(status in ('published','superseded','withdrawn')),
  needs_review boolean not null default false
);
create unique index safety_current_publication on public.safety_briefing_publications(site_id,work_date) where status='published';
create table public.safety_briefing_reads (
  publication_id uuid not null references public.safety_briefing_publications(id),
  user_id uuid not null references auth.users(id),
  read_at timestamptz not null default now(),
  primary key(publication_id,user_id)
);

-- No direct writes and no draft Realtime streams. Historical source versions remain readable by their audience.
do $$ declare t text; begin
  foreach t in array array['site_safety_profiles','job_plans','safety_sources','safety_source_versions','safety_passages',
    'safety_briefing_runs','safety_run_evidence','safety_briefing_revisions','safety_briefing_publications','safety_briefing_reads'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated',t);
    execute format('grant select on public.%I to authenticated',t);
    execute format('grant all on public.%I to service_role',t);
  end loop;
  foreach t in array array['site_safety_profiles','job_plans','safety_briefing_runs','safety_briefing_revisions'] loop
    execute format('create policy safety_supervisor_read on public.%I for select to authenticated using (private.is_site_supervisor(site_id))',t);
  end loop;
end $$;
create policy safety_sources_read on public.safety_sources for select to authenticated using (
  (site_id is null and exists(select 1 from public.site_memberships where user_id=auth.uid()))
  or (audience='crew' and private.is_site_member(site_id)) or private.is_site_supervisor(site_id));
create policy safety_versions_read on public.safety_source_versions for select to authenticated using (
  exists(select 1 from public.safety_sources s where s.id=source_id and (status in ('approved','superseded') or private.is_site_supervisor(s.site_id))));
create policy safety_passages_read on public.safety_passages for select to authenticated using (
  exists(select 1 from public.safety_source_versions v where v.id=version_id));
create policy safety_evidence_read on public.safety_run_evidence for select to authenticated using (
  exists(select 1 from public.safety_briefing_runs r where r.id=run_id and private.is_site_supervisor(r.site_id)));
create policy safety_publications_read on public.safety_briefing_publications for select to authenticated using(private.is_site_member(site_id));
create policy safety_reads_read on public.safety_briefing_reads for select to authenticated using(user_id=auth.uid() and exists(
  select 1 from public.safety_briefing_publications p where p.id=publication_id and private.is_site_member(p.site_id)));

-- A short global workflow lock makes source approval/publication atomic with site changes.
create function private.safety_lock() returns void language sql volatile set search_path='' as $$
  select pg_advisory_xact_lock(1700269);
$$;
create function private.safety_supported(p jsonb) returns boolean language sql immutable set search_path='' as $$
  select coalesce(p->'profile'->>'state'='FL' and p->'profile'->>'employer_sector'='private'
    and p->'profile'->>'classification'='operations_maintenance' and p->'job'->>'task'='electrical_maintenance',false);
$$;
create function private.safety_source_set(p_site uuid,p_date date) returns text language sql stable set search_path='' as $$
  select md5(coalesce(string_agg(v.id::text||':'||v.status||':'||v.last_checked_at::date::text,',' order by v.id),''))
  from public.safety_source_versions v join public.safety_sources s on s.id=v.source_id
  where v.status='approved' and (s.site_id is null or s.site_id=p_site)
    and (v.effective_on is null or v.effective_on<=p_date) and (v.superseded_on is null or v.superseded_on>p_date);
$$;
create function private.safety_snapshot(p_site uuid,p_date date) returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('site_id',s.id,'site_name',s.name,'timezone',s.timezone,'work_date',p_date,
    'profile',coalesce(p.profile,'{}'::jsonb),'profile_revision',coalesce(p.revision,0),
    'job',coalesce(j.job,'{}'::jsonb),'job_revision',coalesce(j.revision,0),'source_set',private.safety_source_set(s.id,p_date),
    'hazard_revision',coalesce(h.hazard_revision,0),'prompt_version',cfg.prompt_version,'model',cfg.model,
    'captured_at',now(), 'hazards',jsonb_build_object(
      'alerts',coalesce((select jsonb_agg(to_jsonb(a) order by a.id) from public.alerts a where a.site_id=s.id and status='active'),'[]'::jsonb),
      'lightning',(select to_jsonb(l) from public.lightning_state l where l.site_id=s.id),
      'risk',coalesce((select jsonb_agg(to_jsonb(r)) from public.site_risk r where r.site_id=s.id),'[]'::jsonb),
      'crew',coalesce((select jsonb_agg(to_jsonb(c)-'reporter_id'-'location') from public.crew_hazard_feed c where c.site_id=s.id and c.is_active),'[]'::jsonb),
      'readings',coalesce((select jsonb_agg(to_jsonb(x)) from (
        select distinct on (r.hazard,r.unit,r.forecast_for) r.id,r.hazard,r.value,r.unit,r.observed_at,r.forecast_for,r.source
        from public.readings r where r.site_id=s.id and r.observed_at>now()-interval '24 hours'
          and (r.forecast_for='-infinity' or (r.forecast_for at time zone s.timezone)::date=p_date)
        order by r.hazard,r.unit,r.forecast_for,r.observed_at desc limit 100) x),'[]'::jsonb)))
  from public.sites s left join public.site_safety_profiles p on p.site_id=s.id
  left join public.job_plans j on j.site_id=s.id and j.work_date=p_date
  left join private.safety_site_state h on h.site_id=s.id cross join private.safety_settings cfg where s.id=p_site;
$$;
create function private.safety_input_key(p jsonb) returns text language sql immutable set search_path='' as $$
 select md5(jsonb_build_array(p->'site_id',p->'work_date',p->'profile_revision',p->'job_revision',p->'source_set',p->'hazard_revision',p->'model',p->'prompt_version')::text);
$$;
create function private.safety_gaps(p jsonb) returns jsonb language plpgsql stable set search_path='' as $$
declare g jsonb := '[]'; begin
 if not private.safety_supported(p) then g:=g||jsonb_build_array('Coverage unresolved: confirm FL, private employer, operations/maintenance and electrical_maintenance task. Construction and other scope are unsupported.'); end if;
 if coalesce(p->'job'->>'energized','unknown')='unknown' then g:=g||jsonb_build_array('Confirm energized status and applicable energy controls with the employee in charge.'); end if;
 if not exists(select 1 from public.safety_source_versions v join public.safety_sources s on s.id=v.source_id
   where s.site_id=(p->>'site_id')::uuid and v.status='approved' and 'electrical_maintenance'=any(v.task_tags)
   and v.jurisdiction='FL' and (v.effective_on is null or v.effective_on<=(p->>'work_date')::date)
   and (v.superseded_on is null or v.superseded_on>(p->>'work_date')::date) and v.last_checked_at>now()-interval '30 days') then
   g:=g||jsonb_build_array('Missing current approved site procedure; obtain and review the applicable employer procedure.'); end if;
 if not exists(select 1 from public.safety_source_versions v join public.safety_sources s on s.id=v.source_id where s.category='official'
   and v.status='approved' and v.jurisdiction='FL' and 'electrical_maintenance'=any(v.task_tags) and v.last_checked_at>now()-interval '30 days'
   and (v.effective_on is null or v.effective_on<=(p->>'work_date')::date) and (v.superseded_on is null or v.superseded_on>(p->>'work_date')::date)) then
   g:=g||jsonb_build_array('Official evidence unavailable or overdue for review; this is not evidence of no requirements.'); end if;
 if not exists(select 1 from jsonb_array_elements(p->'hazards'->'readings') r where (r->>'observed_at')::timestamptz>now()-interval '2 hours') then
   g:=g||jsonb_build_array('Hazard feed missing or stale; verify current conditions and forecasts before work.'); end if;
 if exists(select 1 from public.safety_source_versions v join public.safety_sources s on s.id=v.source_id where v.status='approved'
   and v.conflicts and (s.site_id is null or s.site_id=(p->>'site_id')::uuid)) then
   g:=g||jsonb_build_array('Conflicting sources require supervisor resolution; do not choose a rule automatically.'); end if;
 return g||jsonb_build_array('Limited pilot corpus: supervisor must assess other applicable requirements and task-specific controls. Estimated weather and GLM lightning do not establish legal compliance.');
end $$;

create function public.save_safety_context(p_site_id uuid,p_work_date date,p_profile_revision integer,p_job_revision integer,p_profile jsonb,p_job jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare pr int; jr int; begin
 if not private.is_site_supervisor(p_site_id) then raise exception 'Supervisor role required' using errcode='42501'; end if;
 perform private.safety_lock();
 if p_work_date is null or p_profile is null or p_job is null or jsonb_typeof(p_profile)<>'object' or jsonb_typeof(p_job)<>'object'
   or length(p_profile::text)>6000 or length(p_job::text)>12000
   or coalesce(p_profile->>'state','') !~ '^[A-Z]{2}$'
   or coalesce(p_profile->>'employer_sector','') not in ('private','public','unknown')
   or coalesce(p_profile->>'classification','') not in ('operations_maintenance','construction','unknown')
   or jsonb_typeof(p_profile->'enabled') is distinct from 'boolean'
   or coalesce(p_job->>'task','') not in ('electrical_maintenance','construction','other')
   or length(coalesce(p_job->>'description','')) not between 1 and 2000
   or coalesce(p_job->>'energized','') not in ('unknown','energized','deenergized')
   or length(coalesce(p_job->>'equipment',''))>2000 or length(coalesce(p_job->>'conditions',''))>2000 then
   raise exception 'Invalid safety context' using errcode='22023'; end if;
 select coalesce((select revision from public.site_safety_profiles where site_id=p_site_id),0) into pr;
 select coalesce((select revision from public.job_plans where site_id=p_site_id and work_date=p_work_date),0) into jr;
 if p_profile_revision is distinct from pr or p_job_revision is distinct from jr then raise exception 'Context changed; reload before saving' using errcode='40001'; end if;
 insert into public.site_safety_profiles values(p_site_id,pr+1,p_profile,auth.uid(),now()) on conflict(site_id) do update
   set revision=excluded.revision,profile=excluded.profile,updated_by=excluded.updated_by,updated_at=excluded.updated_at;
 insert into public.job_plans values(p_site_id,p_work_date,jr+1,p_job,auth.uid(),now()) on conflict(site_id,work_date) do update
   set revision=excluded.revision,job=excluded.job,updated_by=excluded.updated_by,updated_at=excluded.updated_at;
 update public.safety_briefing_publications set needs_review=true where site_id=p_site_id and status='published';
 return jsonb_build_object('profile_revision',pr+1,'job_revision',jr+1,'profile',p_profile,'job',p_job);
end $$;

create function private.safety_enqueue(p_site uuid,p_date date,p_force boolean default false) returns uuid
language plpgsql security definer set search_path='' as $$
declare snap jsonb; k text; rid uuid; begin
 perform private.safety_lock();
 if not (select enabled from private.safety_settings) then raise exception 'Safety generation disabled' using errcode='55000'; end if;
 snap:=private.safety_snapshot(p_site,p_date);
 if snap is null or not coalesce((snap->'profile'->>'enabled')::boolean,false) or (snap->>'job_revision')::int=0 then
   raise exception 'Save an enabled safety profile and job first' using errcode='22023'; end if;
 k:=private.safety_input_key(snap)||case when p_force then ':'||gen_random_uuid()::text else '' end;
 insert into public.safety_briefing_runs(site_id,work_date,fingerprint,input_snapshot,created_by)
 values(p_site,p_date,k,snap,auth.uid()) on conflict(site_id,work_date,fingerprint) do nothing returning id into rid;
 if rid is null then select id into rid from public.safety_briefing_runs where site_id=p_site and work_date=p_date and fingerprint=k; end if;
 return rid;
end $$;
create function public.request_safety_briefing(p_site_id uuid,p_work_date date,p_regenerate boolean default false) returns uuid
language plpgsql security definer set search_path='' as $$ begin
 if not private.is_site_supervisor(p_site_id) then raise exception 'Supervisor role required' using errcode='42501'; end if;
 if p_regenerate is null or p_work_date is null then raise exception 'Date and regeneration flag required' using errcode='22023'; end if;
 return private.safety_enqueue(p_site_id,p_work_date,p_regenerate);
end $$;

-- Evidence is bound by the host through service-only retrieval, never supplied by the browser/model.
create function public.retrieve_safety_evidence(p_run_id uuid,p_lease_token uuid,p_tool text,p_query text default '',p_passage_id uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.safety_briefing_runs; result jsonb; e jsonb; begin
 select * into r from public.safety_briefing_runs where id=p_run_id and state='running' and lease_token=p_lease_token and leased_until>now() for update;
 if not found then raise exception 'Lease lost'; end if;
 if p_tool not in ('search_regulations','search_site_documents','read_source_passage') or length(p_query)>500 then raise exception 'Invalid tool'; end if;
 select coalesce(jsonb_agg(x.e),'[]'::jsonb) into result from (
   select jsonb_build_object('id',p.id::text,'passage_id',p.id,'version_id',v.id,'source_id',s.id,
     'kind',case when s.category='official' then 'legal_requirement' else 'company_policy' end,
     'title',s.title,'authority',s.issuing_body,'url',s.canonical_url,'anchor',p.anchor,'excerpt',p.excerpt,
     'instruction',p.instruction,'conditions',p.conditions,'audience',s.audience,'effective_on',v.effective_on,
     'superseded_on',v.superseded_on,'last_checked_at',v.last_checked_at,'fictional',v.fictional,'conflicts',v.conflicts) e
   from public.safety_passages p join public.safety_source_versions v on v.id=p.version_id join public.safety_sources s on s.id=v.source_id
   where v.status='approved' and (s.site_id is null or s.site_id=r.site_id)
     and v.jurisdiction=coalesce(r.input_snapshot->'profile'->>'state','unknown')
     and (r.input_snapshot->'job'->>'task')=any(v.task_tags)
     and (v.effective_on is null or v.effective_on<=r.work_date) and (v.superseded_on is null or v.superseded_on>r.work_date)
     and v.last_checked_at>now()-interval '30 days'
     and (not v.fictional or exists(select 1 from public.sites ss where ss.id=r.site_id and ss.eia_plant_id is null))
     and (s.category<>'official' or private.safety_supported(r.input_snapshot))
     and ((p_tool='search_regulations' and s.category='official') or (p_tool='search_site_documents' and s.site_id=r.site_id)
       or (p_tool='read_source_passage' and p.id=p_passage_id and exists(select 1 from public.safety_run_evidence re where re.run_id=r.id and re.evidence_id=p.id::text)))
   order by ts_rank_cd(p.search_vector,plainto_tsquery('english',coalesce(p_query,''))) desc,p.id limit 8) x;
 for e in select value from jsonb_array_elements(result) loop
   insert into public.safety_run_evidence values(r.id,e->>'id',e) on conflict do nothing;
 end loop;
 return result;
end $$;

create function private.safety_validate(p_run uuid,p_content jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare r public.safety_briefing_runs; item jsonb; ev jsonb; eid text; g jsonb; worker boolean; begin
 select * into strict r from public.safety_briefing_runs where id=p_run;
 if p_content is null or jsonb_typeof(p_content)<>'object' or length(p_content::text)>50000
   or jsonb_typeof(p_content->'worker_items') is distinct from 'array' or jsonb_typeof(p_content->'supervisor_items') is distinct from 'array'
   or jsonb_typeof(p_content->'coverage_gaps') is distinct from 'array' or jsonb_typeof(p_content->'admin_notes') is distinct from 'string'
   or jsonb_array_length(p_content->'worker_items')>20 or jsonb_array_length(p_content->'supervisor_items')>20 then raise exception 'Invalid briefing schema'; end if;
 for g in select value from jsonb_array_elements(private.safety_gaps(r.input_snapshot)) loop
   if not (p_content->'coverage_gaps' @> jsonb_build_array(g)) then raise exception 'Required coverage gap missing'; end if;
 end loop;
 for item,worker in select value,true from jsonb_array_elements(p_content->'worker_items') union all select value,false from jsonb_array_elements(p_content->'supervisor_items') loop
   if coalesce(item->>'task','')<>coalesce(r.input_snapshot->'job'->>'task','')
     or coalesce(item->>'type','') not in ('legal_requirement','company_policy','recommendation','observed_hazard')
     or coalesce(item->>'applicability','') not in ('supported','conditional','unresolved')
     or jsonb_typeof(item->'evidence_ids') is distinct from 'array' or jsonb_array_length(item->'evidence_ids') not between 1 and 8
     or jsonb_typeof(item->'explanation') is distinct from 'string' then raise exception 'Invalid item'; end if;
   for eid in select jsonb_array_elements_text(item->'evidence_ids') loop
     select evidence into ev from public.safety_run_evidence where run_id=r.id and evidence_id=eid;
     if ev is null or (worker and ev->>'audience'<>'crew') then raise exception 'Unauthorized citation'; end if;
   end loop;
   select evidence into ev from public.safety_run_evidence where run_id=r.id and evidence_id=item->'evidence_ids'->>0;
   if item->>'text' is distinct from ev->>'instruction' or item->>'conditions' is distinct from ev->>'conditions'
     or item->>'type' is distinct from ev->>'kind' then raise exception 'Instruction must match reviewed evidence'; end if;
   if item->>'type'='legal_requirement' and (not private.safety_supported(r.input_snapshot) or item->>'applicability'<>'supported') then raise exception 'Unresolved legal applicability'; end if;
   if coalesce((ev->>'conflicts')::boolean,false) then raise exception 'Conflicting source requires review'; end if;
 end loop;
end $$;

create function public.edit_safety_revision(p_revision_id uuid,p_expected_revision integer,p_content jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare r public.safety_briefing_revisions; latest int; result uuid; begin
 select * into r from public.safety_briefing_revisions where id=p_revision_id;
 if r.id is null or not private.is_site_supervisor(r.site_id) then raise exception 'Supervisor role required' using errcode='42501'; end if;
 perform private.safety_lock();
 select max(revision) into latest from public.safety_briefing_revisions where site_id=r.site_id and work_date=r.work_date;
 if p_expected_revision is distinct from latest or r.revision<>latest then raise exception 'Revision changed; reload' using errcode='40001'; end if;
 if private.safety_input_key((select input_snapshot from public.safety_briefing_runs where id=r.run_id))<>private.safety_input_key(private.safety_snapshot(r.site_id,r.work_date)) then raise exception 'Inputs changed; regenerate' using errcode='40001'; end if;
 perform private.safety_validate(r.run_id,p_content);
 insert into public.safety_briefing_revisions(run_id,site_id,work_date,revision,content,author_id,provenance)
 values(r.run_id,r.site_id,r.work_date,latest+1,p_content,auth.uid(),'supervisor') returning id into result;
 return result;
end $$;
create function public.publish_safety_revision(p_revision_id uuid,p_expected_revision integer) returns uuid
language plpgsql security definer set search_path='' as $$
declare r public.safety_briefing_revisions; snap jsonb; latest int; result uuid; evidence jsonb; items jsonb; begin
 select * into r from public.safety_briefing_revisions where id=p_revision_id;
 if r.id is null or not private.is_site_supervisor(r.site_id) then raise exception 'Supervisor role required' using errcode='42501'; end if;
 perform private.safety_lock();
 select max(revision) into latest from public.safety_briefing_revisions where site_id=r.site_id and work_date=r.work_date;
 if p_expected_revision is distinct from latest or r.revision<>latest then raise exception 'Revision changed; reload' using errcode='40001'; end if;
 snap:=private.safety_snapshot(r.site_id,r.work_date);
 if private.safety_input_key((select input_snapshot from public.safety_briefing_runs where id=r.run_id))<>private.safety_input_key(snap) then raise exception 'Inputs changed; regenerate' using errcode='40001'; end if;
 if r.work_date<(now() at time zone (snap->>'timezone'))::date then raise exception 'Work date expired'; end if;
 perform private.safety_validate(r.run_id,r.content);
 select id into result from public.safety_briefing_publications where revision_id=r.id;
 if result is not null then raise exception 'Revision already published'; end if;
 select coalesce(jsonb_agg(x.value-'explanation'),'[]'::jsonb) into items from jsonb_array_elements(r.content->'worker_items') x;
 select coalesce(jsonb_agg(e.evidence),'[]'::jsonb) into evidence from public.safety_run_evidence e where e.run_id=r.run_id
   and e.evidence_id in (select jsonb_array_elements_text(x->'evidence_ids') from jsonb_array_elements(items) x);
 update public.safety_briefing_publications set status='superseded' where site_id=r.site_id and work_date=r.work_date and status='published';
 insert into public.safety_briefing_publications(site_id,work_date,revision_id,worker_payload,published_by,valid_until)
 values(r.site_id,r.work_date,r.id,jsonb_build_object('worker_items',items,'coverage_gaps',r.content->'coverage_gaps','evidence',evidence),auth.uid(),
   (r.work_date+1)::timestamp at time zone (snap->>'timezone')) returning id into result;
 return result;
end $$;
create function public.withdraw_safety_publication(p_publication_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare s uuid; begin
 select site_id into s from public.safety_briefing_publications where id=p_publication_id;
 if s is null or not private.is_site_supervisor(s) then raise exception 'Supervisor role required' using errcode='42501'; end if;
 perform private.safety_lock();
 update public.safety_briefing_publications set status='withdrawn' where id=p_publication_id and status='published';
end $$;
create function public.acknowledge_safety_publication(p_publication_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare p public.safety_briefing_publications; begin
 perform private.safety_lock();
 select * into p from public.safety_briefing_publications where id=p_publication_id;
 if p.id is null or not private.is_site_member(p.site_id) then raise exception 'Site membership required' using errcode='42501'; end if;
 if p.status<>'published' or p.needs_review or p.valid_until<=now() then raise exception 'Checklist no longer current; reload'; end if;
 insert into public.safety_briefing_reads values(p.id,auth.uid(),now()) on conflict do nothing;
end $$;
create function public.get_safety_workspace(p_site_id uuid,p_work_date date) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb; pub public.safety_briefing_publications; begin
 if not private.is_site_member(p_site_id) then raise exception 'Site membership required' using errcode='42501'; end if;
 select * into pub from public.safety_briefing_publications where site_id=p_site_id and work_date=p_work_date order by published_at desc limit 1;
 result:=jsonb_build_object('enabled',(select enabled from private.safety_settings),'publication',case when pub.id is null then null else
   to_jsonb(pub)||jsonb_build_object('expired',pub.valid_until<=now(),'acknowledged',exists(select 1 from public.safety_briefing_reads where publication_id=pub.id and user_id=auth.uid())) end);
 if private.is_site_supervisor(p_site_id) then result:=result||jsonb_build_object(
   'context',jsonb_build_object('profile',coalesce((select profile from public.site_safety_profiles where site_id=p_site_id),'{}'::jsonb),
     'profile_revision',coalesce((select revision from public.site_safety_profiles where site_id=p_site_id),0),
     'job',coalesce((select job from public.job_plans where site_id=p_site_id and work_date=p_work_date),'{}'::jsonb),
     'job_revision',coalesce((select revision from public.job_plans where site_id=p_site_id and work_date=p_work_date),0)),
   'run',(select to_jsonb(r)-'input_snapshot'-'lease_token'-'diagnostics' from public.safety_briefing_runs r where site_id=p_site_id and work_date=p_work_date order by created_at desc,id desc limit 1),
   'revision',(select to_jsonb(r) from public.safety_briefing_revisions r where site_id=p_site_id and work_date=p_work_date order by revision desc limit 1),
   'evidence',coalesce((select jsonb_agg(e.evidence) from public.safety_run_evidence e where e.run_id=(select run_id from public.safety_briefing_revisions where site_id=p_site_id and work_date=p_work_date order by revision desc limit 1)),'[]'::jsonb)); end if;
 return result;
end $$;

create function public.claim_safety_runs(p_limit integer default 1) returns setof public.safety_briefing_runs
language plpgsql security definer set search_path='' as $$ begin
 if not (select enabled from private.safety_settings) then return; end if;
 update public.safety_briefing_runs set state='failed',error_category='lease_exhausted',finished_at=now()
   where state='running' and leased_until<now() and attempt>=3;
 return query with candidates as (
   select id from public.safety_briefing_runs where ((state='queued' and available_at<=now()) or (state='running' and leased_until<now()))
     and attempt<3 order by available_at for update skip locked limit greatest(1,least(p_limit,2)))
 update public.safety_briefing_runs r set state='running',attempt=attempt+1,lease_token=gen_random_uuid(),leased_until=now()+interval '120 seconds'
 from candidates c where r.id=c.id returning r.*;
end $$;
create function public.bind_safety_hazards(p_run_id uuid,p_lease_token uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.safety_briefing_runs; h jsonb; e jsonb; out jsonb:='[]'; begin
 select * into r from public.safety_briefing_runs where id=p_run_id and state='running' and lease_token=p_lease_token and leased_until>now() for update;
 if not found then raise exception 'Lease lost'; end if;
 for h in select value from jsonb_array_elements(r.input_snapshot->'hazards'->'alerts') loop
   e:=jsonb_build_object('id','alert:'||(h->>'id'),'record_id',h->>'id','kind','observed_hazard','audience','crew',
     'instruction','Current alert: '||(h->>'kind')||' / '||(h->>'level')||'. Follow the live site alert and supervisor directions.',
     'conditions','Current alert at snapshot time; check live alerts before work.','observed_at',h->>'created_at','excerpt',h::text,'url',null,'title','PlanIT alert','conflicts',false);
   insert into public.safety_run_evidence values(r.id,e->>'id',e) on conflict do nothing; out:=out||jsonb_build_array(e);
 end loop;
 return jsonb_build_object('evidence',out,'hazards',r.input_snapshot->'hazards','coverage_gaps',private.safety_gaps(r.input_snapshot));
end $$;
create function public.finish_safety_run(p_run_id uuid,p_lease_token uuid,p_content jsonb default null,p_error text default null,p_diagnostics jsonb default '{}') returns boolean
language plpgsql security definer set search_path='' as $$
declare r public.safety_briefing_runs; n int; begin
 perform private.safety_lock();
 select * into r from public.safety_briefing_runs where id=p_run_id and state='running' and lease_token=p_lease_token and leased_until>now() for update;
 if not found then return false; end if;
 if length(p_diagnostics::text)>20000 then raise exception 'Diagnostics too large'; end if;
 if p_error is null then
   perform private.safety_validate(r.id,p_content);
   select coalesce(max(revision),0)+1 into n from public.safety_briefing_revisions where site_id=r.site_id and work_date=r.work_date;
   insert into public.safety_briefing_revisions(run_id,site_id,work_date,revision,content,provenance) values(r.id,r.site_id,r.work_date,n,p_content,'agent');
   update public.safety_briefing_runs set state='succeeded',finished_at=now(),diagnostics=p_diagnostics,error_category=null where id=r.id;
 else
   update public.safety_briefing_runs set state=case when attempt<3 then 'queued' else 'failed' end,
     available_at=now()+make_interval(secs=>30*power(2,r.attempt-1)::int),error_category=left(p_error,80),diagnostics=p_diagnostics,
     finished_at=case when attempt>=3 then now() end where id=r.id;
 end if;
 return true;
end $$;

-- Lock down every new privileged RPC explicitly (including private helpers).
do $$ declare f record; begin
 for f in select p.oid::regprocedure sig,p.pronamespace::regnamespace ns,p.proname name from pg_proc p
   where (p.pronamespace='private'::regnamespace and p.proname like 'safety_%')
     or (p.pronamespace='public'::regnamespace and p.proname in ('save_safety_context','request_safety_briefing','retrieve_safety_evidence','edit_safety_revision','publish_safety_revision','withdraw_safety_publication','acknowledge_safety_publication','get_safety_workspace','claim_safety_runs','bind_safety_hazards','finish_safety_run')) loop
   execute format('revoke all on function %s from public,anon,authenticated',f.sig);
   if f.ns::text='public' then
     if f.name in ('retrieve_safety_evidence','claim_safety_runs','bind_safety_hazards','finish_safety_run') then execute format('grant execute on function %s to service_role',f.sig);
     else execute format('grant execute on function %s to authenticated',f.sig); end if;
   end if;
 end loop;
end $$;
