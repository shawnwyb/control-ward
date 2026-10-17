-- Forward validation hardening and explicit types for SQL lint.
create or replace function private.safety_base_gaps(p jsonb) returns jsonb language plpgsql stable set search_path='' as $$
declare g jsonb := '[]'::jsonb; begin
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

create or replace function private.safety_hazard_evidence(p jsonb) returns jsonb language plpgsql stable set search_path='' as $$
declare result jsonb:='[]'::jsonb; h jsonb; e jsonb; basis text; begin
 for h in select value from jsonb_array_elements(p->'hazards'->'alerts') loop
   e:=jsonb_build_object('id','alert:'||(h->>'id'),'record_id',h->>'id','kind','observed_hazard','audience','crew',
    'instruction','Current alert: '||(h->>'kind')||' / '||(h->>'level')||'. Follow the live site alert and supervisor directions.',
    'conditions','Current alert at snapshot time; check live alerts before work.','observed_at',h->>'created_at','excerpt',h::text,'url',null,'title','PlanIT alert','conflicts',false);
   result:=result||jsonb_build_array(e);
 end loop;
 for h in select value from jsonb_array_elements(p->'hazards'->'readings') loop
   basis:=case when h->>'forecast_for'='-infinity' then 'Observation' else 'Forecast' end;
   e:=jsonb_build_object('id','reading:'||(h->>'id'),'record_id',h->>'id','kind','observed_hazard','audience','crew',
    'instruction',basis||': '||(h->>'hazard')||' '||(h->>'value')||' '||(h->>'unit')||', recorded '||(h->>'observed_at')||
      case when basis='Forecast' then ', valid for '||(h->>'forecast_for') else '' end||'. Verify current conditions before work.',
    'conditions','Snapshot evidence only. Forecasts are predictions. Estimated WBGT and GLM limitations remain; these values are not legal thresholds.',
    'observed_at',h->>'observed_at','forecast_for',h->>'forecast_for','unit',h->>'unit','value',h->'value','time_basis',basis,
    'excerpt',h::text,'url',null,'title','PlanIT '||basis,'conflicts',false);
   result:=result||jsonb_build_array(e);
 end loop;
 for h in select value from jsonb_array_elements(p->'hazards'->'crew') loop
   e:=jsonb_build_object('id','crew:'||(h->>'id'),'record_id',h->>'id','kind','observed_hazard','audience','crew',
    'instruction','Crew-reported hazard: '||(h->>'type')||', severity '||(h->>'severity')||', last confirmed '||(h->>'last_confirmed_at')||'. Check the live hazard feed and supervisor directions.',
    'conditions','Crew observation at snapshot time; may change or expire.','observed_at',h->>'last_confirmed_at',
    'excerpt',jsonb_build_object('id',h->'id','type',h->'type','severity',h->'severity','last_confirmed_at',h->'last_confirmed_at')::text,
    'url',null,'title','PlanIT crew report','conflicts',false);
   result:=result||jsonb_build_array(e);
 end loop;
 return result;
end $$;

-- Reject unknown fields instead of allowing private metadata inside a worker item.
alter function private.safety_validate(uuid,jsonb) rename to safety_scoped_validate;
create function private.safety_validate(p_run uuid,p_content jsonb) returns void language plpgsql security definer set search_path='' as $$
declare item jsonb; begin
 perform private.safety_scoped_validate(p_run,p_content);
 if exists(select 1 from jsonb_object_keys(p_content) k where k not in ('supervisor_items','worker_items','coverage_gaps','admin_notes'))
   or length(p_content->>'admin_notes')>6000 or jsonb_array_length(p_content->'coverage_gaps')>40
   or exists(select 1 from jsonb_array_elements(p_content->'coverage_gaps') g where jsonb_typeof(g)<>'string' or length(g::text)>2002) then raise exception 'Invalid briefing fields'; end if;
 for item in select value from jsonb_array_elements((p_content->'worker_items')||(p_content->'supervisor_items')) loop
   if exists(select 1 from jsonb_object_keys(item) k where k not in ('type','task','text','explanation','evidence_ids','applicability','conditions'))
     or length(item->>'explanation')>2000 then raise exception 'Invalid item fields'; end if;
 end loop;
end $$;
revoke all on function private.safety_validate(uuid,jsonb),private.safety_scoped_validate(uuid,jsonb) from public,anon,authenticated;

-- Disable queued claims at a site immediately when its profile is disabled.
create or replace function public.claim_safety_runs(p_limit integer default 1) returns setof public.safety_briefing_runs
language plpgsql security definer set search_path='' as $$ begin
 if not (select enabled from private.safety_settings) then return; end if;
 update public.safety_briefing_runs set state='failed',error_category='lease_exhausted',finished_at=now()
   where state='running' and leased_until<now() and attempt>=3;
 return query with candidates as (
   select r.id from public.safety_briefing_runs r where ((r.state='queued' and r.available_at<=now()) or (r.state='running' and r.leased_until<now()))
     and r.attempt<3 and exists(select 1 from public.site_safety_profiles sp where sp.site_id=r.site_id and (sp.profile->>'enabled')::boolean)
     order by r.available_at for update skip locked limit greatest(1,least(p_limit,2)))
 update public.safety_briefing_runs r set state='running',attempt=attempt+1,lease_token=gen_random_uuid(),leased_until=now()+interval '120 seconds'
 from candidates c where r.id=c.id returning r.*;
end $$;
