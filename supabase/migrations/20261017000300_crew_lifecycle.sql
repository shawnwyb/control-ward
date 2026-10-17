create function public.get_site_crew_metrics(p_site_id uuid)
returns table(crew_risk_term numeric,wildlife_subscore numeric,open_report_count bigint)
language plpgsql stable security invoker set search_path='' as $$
begin
  if not private.is_site_member(p_site_id) then raise exception 'Site membership required' using errcode='42501'; end if;
  return query
  select round(least(2::numeric,coalesce(sum(weight),0)),2),
    round(least(10::numeric,coalesce(sum(10*weight) filter(where type='wildlife'),0)),1),count(*)
  from (
    select h.type,(h.severity::numeric/3)*greatest(0::numeric,
      1-extract(epoch from (now()-h.last_confirmed_at))/172800) as weight
    from public.hazard_reports h join public.sites s on s.id=h.site_id
    where h.site_id=p_site_id and h.status='open' and h.last_confirmed_at>now()-interval '48 hours'
      and extensions.st_dwithin(h.location,s.location,s.report_radius_m)
  ) weighted;
end; $$;
revoke all on function public.get_site_crew_metrics(uuid) from public,anon;
grant execute on function public.get_site_crew_metrics(uuid) to authenticated;

create function public.run_hazard_maintenance() returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_candidate record; v_report public.hazard_reports; v_expired integer:=0; v_reminders integer:=0; v_count integer;
begin
  -- Same lock order as client mutations: site, then report. Recheck after acquiring the lock.
  for v_candidate in select id,site_id from public.hazard_reports
    where status='open' and last_confirmed_at<=now()-interval '12 hours'
    order by site_id,id limit 1000
  loop
    perform private.lock_hazard_site(v_candidate.site_id);
    select * into v_report from public.hazard_reports where id=v_candidate.id for update;
    if v_report.status<>'open' then continue; end if;
    if v_report.last_confirmed_at<=now()-interval '48 hours' then
      update public.hazard_reports set status='resolved',resolved_at=now(),resolution_reason='expired'
        where id=v_report.id returning * into v_report;
      perform private.record_observation(v_report,null,'expired',v_report.location,v_report.severity);
      v_expired:=v_expired+1;
    elsif v_report.last_confirmed_at<=now()-interval '12 hours' then
      insert into public.hazard_checkin_tasks(report_id,user_id,confirmation_at,reminder_number)
      select v_report.id,m.user_id,v_report.last_confirmed_at,
        least(3,floor(extract(epoch from(now()-v_report.last_confirmed_at))/43200)::integer)
      from public.site_memberships m where m.site_id=v_report.site_id
      on conflict(report_id,user_id,confirmation_at,reminder_number) do nothing;
      get diagnostics v_count=row_count;
      v_reminders:=v_reminders+v_count;
    end if;
  end loop;
  return jsonb_build_object('expired',v_expired,'reminders_created',v_reminders);
end; $$;
revoke all on function public.run_hazard_maintenance() from public,anon,authenticated;
grant execute on function public.run_hazard_maintenance() to service_role;

-- No network credentials needed: pg_cron runs inside Postgres.
select cron.schedule('crew-hazard-maintenance','*/5 * * * *','select public.run_hazard_maintenance();');

-- Storage objects must be deleted through the Storage API first, never via SQL.
create function public.prune_hazard_photo_reservations(p_photo_ids uuid[]) returns integer
language plpgsql security definer set search_path='' as $$
declare v_count integer;
begin
  delete from public.hazard_photos p where p.id=any(p_photo_ids) and p.observation_id is null
    and p.created_at<now()-interval '1 hour'
    and not exists(select 1 from storage.objects o where o.bucket_id='hazard-photos' and o.name=p.object_path);
  get diagnostics v_count=row_count;
  return v_count;
end; $$;
revoke all on function public.prune_hazard_photo_reservations(uuid[]) from public,anon,authenticated;
grant execute on function public.prune_hazard_photo_reservations(uuid[]) to service_role;

-- Explicit worker permissions rather than relying on project default grants.
grant select on public.hazard_photos,public.hazard_reports,public.hazard_observations,public.hazard_events,
  public.sites,public.site_memberships,public.hazard_checkin_tasks to service_role;

comment on function public.get_site_crew_metrics(uuid) is
  'Demo scoring contract: own-site reports within configured radius; severity/3 and linear 48h decay. Crew cap 2; wildlife 10x wildlife weights, cap 10.';
