-- Authenticated callers remain scoped by RLS; trusted backend workers can score any site.
create or replace function public.get_site_crew_metrics(p_site_id uuid)
returns table(crew_risk_term numeric,wildlife_subscore numeric,open_report_count bigint)
language plpgsql stable security invoker set search_path='' as $$
begin
  if current_user<>'service_role' then
    if not private.is_site_member(p_site_id) then raise exception 'Site membership required' using errcode='42501'; end if;
  end if;
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
grant execute on function public.get_site_crew_metrics(uuid) to service_role;
grant select on public.crew_hazard_feed to service_role;

create view public.crew_observation_feed with(security_invoker=true) as
select o.id,o.report_id,h.site_id,h.type,o.action,o.actor_id,o.severity,o.created_at,
  extensions.st_y(o.location::extensions.geometry) as latitude,
  extensions.st_x(o.location::extensions.geometry) as longitude
from public.hazard_observations o join public.hazard_reports h on h.id=o.report_id;
grant select on public.crew_observation_feed to authenticated,service_role;
