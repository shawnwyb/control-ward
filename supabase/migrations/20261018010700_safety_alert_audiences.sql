-- Targeted supervisor messages must not enter a checklist published to the whole crew.
create or replace function private.safety_snapshot(p_site uuid,p_date date) returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('site_id',s.id,'site_name',s.name,'timezone',s.timezone,'work_date',p_date,
    'profile',coalesce(p.profile,'{}'::jsonb),'profile_revision',coalesce(p.revision,0),
    'job',coalesce(j.job,'{}'::jsonb),'job_revision',coalesce(j.revision,0),'source_set',private.safety_source_set(s.id,p_date),
    'hazard_revision',coalesce(h.hazard_revision,0),'prompt_version',cfg.prompt_version,'model',cfg.model,
    'captured_at',now(), 'hazards',jsonb_build_object(
      'alerts',coalesce((select jsonb_agg(to_jsonb(a) order by a.id) from public.alerts a where a.site_id=s.id and status='active' and a.target_user_ids is null),'[]'::jsonb),
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
