-- Preserve revision ordering when timestamps tie; keep supervisor-only official evidence private.
drop policy safety_sources_read on public.safety_sources;
create policy safety_sources_read on public.safety_sources for select to authenticated using (
  (site_id is null and ((audience='crew' and exists(select 1 from public.site_memberships where user_id=auth.uid()))
    or exists(select 1 from public.site_memberships where user_id=auth.uid() and role='supervisor')))
  or (audience='crew' and private.is_site_member(site_id)) or private.is_site_supervisor(site_id));
create or replace function public.get_safety_workspace(p_site_id uuid,p_work_date date) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb; pub public.safety_briefing_publications; begin
 if not private.is_site_member(p_site_id) then raise exception 'Site membership required' using errcode='42501'; end if;
 select * into pub from public.safety_briefing_publications where site_id=p_site_id and work_date=p_work_date order by (select revision from public.safety_briefing_revisions r where r.id=revision_id) desc limit 1;
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
