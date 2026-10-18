-- Show stale draft inputs before the supervisor attempts a mutation.
create or replace function public.get_safety_workspace(p_site_id uuid,p_work_date date) returns jsonb
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
 if result ? 'revision' and result->'revision' is distinct from 'null'::jsonb then
   select input_snapshot into prev from public.safety_briefing_runs where id=(result->'revision'->>'run_id')::uuid;
   result:=result||jsonb_build_object('revision_stale',private.safety_input_key(prev)<>private.safety_input_key(snap));
 end if;
 return result||jsonb_build_object('freshness',jsonb_build_object('captured_at',now(),'feed_stale',stale,'needs_review',changed));
end $$;
