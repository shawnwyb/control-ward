-- Expose freshness without leaking supervisor context; preserve observations, forecasts and units as evidence.
create function private.safety_hazard_evidence(p jsonb) returns jsonb language plpgsql immutable set search_path='' as $$
declare result jsonb:='[]'; h jsonb; e jsonb; basis text; begin
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
create or replace function public.bind_safety_hazards(p_run_id uuid,p_lease_token uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.safety_briefing_runs; e jsonb; out jsonb; begin
 select * into r from public.safety_briefing_runs where id=p_run_id and state='running' and lease_token=p_lease_token and leased_until>now() for update;
 if not found then raise exception 'Lease lost'; end if;
 out:=private.safety_hazard_evidence(r.input_snapshot);
 for e in select value from jsonb_array_elements(out) loop
   insert into public.safety_run_evidence values(r.id,e->>'id',e) on conflict do nothing;
 end loop;
 return jsonb_build_object('evidence',out,'hazards',r.input_snapshot->'hazards','coverage_gaps',private.safety_gaps(r.input_snapshot));
end $$;

alter function public.get_safety_workspace(uuid,date) rename to safety_base_workspace;
revoke all on function public.safety_base_workspace(uuid,date) from public,anon,authenticated,service_role;
-- Internal helper in private schema avoids exposing a second public endpoint.
alter function public.safety_base_workspace(uuid,date) set schema private;
create function public.get_safety_workspace(p_site_id uuid,p_work_date date) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb; snap jsonb; stale boolean; changed boolean:=false; prev jsonb; begin
 result:=private.safety_base_workspace(p_site_id,p_work_date);
 snap:=private.safety_snapshot(p_site_id,p_work_date);
 stale:=not exists(select 1 from jsonb_array_elements(snap->'hazards'->'readings') h where (h->>'observed_at')::timestamptz>now()-interval '2 hours');
 if result->'publication' is distinct from 'null'::jsonb then
   select r.input_snapshot into prev from public.safety_briefing_publications p join public.safety_briefing_revisions v on v.id=p.revision_id
    join public.safety_briefing_runs r on r.id=v.run_id where p.id=(result->'publication'->>'id')::uuid;
   changed:=private.safety_input_key(prev)<>private.safety_input_key(snap) or
     (stale and exists(select 1 from jsonb_array_elements(prev->'hazards'->'readings') h where (h->>'observed_at')::timestamptz>(prev->>'captured_at')::timestamptz-interval '2 hours'));
   result:=jsonb_set(result,'{publication,needs_review}',to_jsonb(coalesce((result->'publication'->>'needs_review')::boolean,false) or changed));
 end if;
 return result||jsonb_build_object('freshness',jsonb_build_object('captured_at',now(),'feed_stale',stale,'needs_review',changed));
end $$;
revoke all on function public.get_safety_workspace(uuid,date) from public,anon;
grant execute on function public.get_safety_workspace(uuid,date) to authenticated;

-- Ack uses the same freshness projection as reads, including source expiry between cron ticks.
create or replace function public.acknowledge_safety_publication(p_publication_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare p public.safety_briefing_publications; w jsonb; begin
 perform private.safety_lock();
 select * into p from public.safety_briefing_publications where id=p_publication_id;
 if p.id is null or not private.is_site_member(p.site_id) then raise exception 'Site membership required' using errcode='42501'; end if;
 w:=public.get_safety_workspace(p.site_id,p.work_date);
 if p.status<>'published' or p.needs_review or p.valid_until<=now() or coalesce((w->'freshness'->>'needs_review')::boolean,false) then raise exception 'Checklist no longer current; reload'; end if;
 insert into public.safety_briefing_reads values(p.id,auth.uid(),now()) on conflict do nothing;
end $$;
create or replace function private.safety_validate(p_run uuid,p_content jsonb) returns void language plpgsql security definer set search_path='' as $$
declare s uuid; gaps jsonb; begin
 perform private.safety_base_validate(p_run,p_content);
 select site_id,private.safety_gaps(input_snapshot) into s,gaps from public.safety_briefing_runs where id=p_run;
 if (private.safety_pending_source(s) or exists(select 1 from jsonb_array_elements_text(gaps) g where g like 'Conflicting sources%'))
   and exists(select 1 from jsonb_array_elements((p_content->'worker_items')||(p_content->'supervisor_items')) i
   where i->>'type' in ('legal_requirement','company_policy')) then raise exception 'Source review pending or conflicting'; end if;
end $$;
revoke all on function private.safety_hazard_evidence(jsonb) from public,anon,authenticated;
