-- Worker RPCs (service_role) used by Edge Functions, plus client RPCs for alerts, location and demo scenarios.

-- Lightning rules: any strike within 10 mi of a site sets stop_work and restarts the 30:00 clear timer.
-- The state row is the lock: concurrent batches serialize on the site's row and last_strike_at only moves forward.
create function private.ingest_strikes_impl(p_batch jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  v_ids bigint[]; v_inserted integer:=0; v_sites jsonb; v_exposed integer;
  c_radius_m constant double precision:=16093.44; -- 10 miles
begin
  if p_batch is null or jsonb_typeof(p_batch)<>'array' or jsonb_array_length(p_batch)>5000 then
    raise exception 'Batch must be an array of at most 5000 strikes' using errcode='22023';
  end if;
  with ins as (
    insert into public.lightning_strikes(latitude,longitude,struck_at,source)
    select (e->>'lat')::double precision,(e->>'lon')::double precision,(e->>'struck_at')::timestamptz,
      coalesce(e->>'source','live')
    from jsonb_array_elements(p_batch) e
    on conflict do nothing returning id)
  select coalesce(array_agg(id),'{}') into v_ids from ins;
  v_inserted:=coalesce(array_length(v_ids,1),0);

  with hits as (
    select s.id as site_id,max(n.struck_at) as last_at,
      min(extensions.st_distance(n.location,s.location)) as dist
    from public.lightning_strikes n join public.sites s on extensions.st_dwithin(n.location,s.location,c_radius_m)
    where n.id=any(v_ids) and n.struck_at>now()-interval '30 minutes' and n.struck_at<=now()+interval '5 minutes'
    group by s.id),
  upserted as (
    insert into public.lightning_state(site_id,status,last_strike_at,last_strike_distance_m,updated_at)
    select site_id,'stop_work',last_at,round(dist)::integer,now() from hits
    on conflict(site_id) do update set status='stop_work',
      last_strike_distance_m=case when excluded.last_strike_at>=coalesce(public.lightning_state.last_strike_at,'-infinity')
        then excluded.last_strike_distance_m else public.lightning_state.last_strike_distance_m end,
      last_strike_at=greatest(coalesce(public.lightning_state.last_strike_at,'-infinity'),excluded.last_strike_at),
      updated_at=now()
    returning site_id,last_strike_at,last_strike_distance_m),
  alerted as (
    insert into public.alerts(site_id,kind,level,payload,dedup_key)
    select site_id,'lightning','stop_work',
      jsonb_build_object('last_strike_at',last_strike_at,'distance_mi',round(last_strike_distance_m/1609.344,1),
        'clear_at',last_strike_at+interval '30 minutes'),
      'lightning:'||site_id
    from upserted
    on conflict(dedup_key) where status='active' do update set payload=excluded.payload
    returning site_id)
  select coalesce(jsonb_agg(jsonb_build_object('site_id',u.site_id,'distance_mi',round(u.last_strike_distance_m/1609.344,1),
    'last_strike_at',u.last_strike_at,'countdown_reset',true)),'[]'::jsonb)
  into v_sites from upserted u join alerted a on a.site_id=u.site_id;

  select count(distinct c.user_id) into v_exposed
  from public.crew_locations c join public.lightning_strikes n on extensions.st_dwithin(n.location,c.location,c_radius_m)
  where n.id=any(v_ids) and n.struck_at>now()-interval '30 minutes' and c.updated_at>now()-interval '5 minutes';

  return jsonb_build_object('strikes',v_inserted,'sites_in_range',v_sites,'crew_exposed',v_exposed);
end; $$;

create function public.ingest_strikes(p_batch jsonb) returns jsonb
language sql security definer set search_path='' as $$ select private.ingest_strikes_impl(p_batch); $$;

-- 30 minutes without a strike inside 10 mi clears the site. Never depends on weather verification.
create function public.sweep_lightning() returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_cleared integer;
begin
  with cleared as (
    update public.lightning_state set status='clear',updated_at=now()
    where status='stop_work' and last_strike_at<=now()-interval '30 minutes' returning site_id)
  update public.alerts a set status='cleared',cleared_at=now()
  from cleared c where a.dedup_key='lightning:'||c.site_id and a.status='active';
  get diagnostics v_cleared=row_count;
  return jsonb_build_object('cleared',v_cleared);
end; $$;
select cron.schedule('lightning-sweep','* * * * *','select public.sweep_lightning();');

create function public.ingest_readings(p_batch jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_inserted integer; v_total integer;
begin
  if p_batch is null or jsonb_typeof(p_batch)<>'array' or jsonb_array_length(p_batch)>10000 then
    raise exception 'Batch must be an array of at most 10000 readings' using errcode='22023';
  end if;
  with up as (
    insert into public.readings(site_id,hazard,value,unit,observed_at,forecast_for,source)
    select (e->>'site_id')::uuid,(e->>'hazard')::public.hazard_kind,(e->>'value')::double precision,e->>'unit',
      (e->>'observed_at')::timestamptz,coalesce((e->>'forecast_for')::timestamptz,'-infinity'),coalesce(e->>'source','live')
    from jsonb_array_elements(p_batch) e
    on conflict(site_id,hazard,observed_at,forecast_for,source) do update set value=excluded.value,unit=excluded.unit
    returning (xmax=0) as inserted)
  select count(*) filter(where inserted),count(*) into v_inserted,v_total from up;
  return jsonb_build_object('inserted',v_inserted,'updated',v_total-v_inserted);
end; $$;

create function public.upsert_ml_scores(p_batch jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_count integer;
begin
  if p_batch is null or jsonb_typeof(p_batch)<>'array' or jsonb_array_length(p_batch)>1000 then
    raise exception 'Batch must be an array of at most 1000 scores' using errcode='22023';
  end if;
  insert into public.ml_scores(site_id,horizon,score,model_version,computed_at)
  select (e->>'site_id')::uuid,e->>'horizon',(e->>'score')::numeric,e->>'model_version',now()
  from jsonb_array_elements(p_batch) e
  on conflict(site_id,horizon) do update set score=excluded.score,model_version=excluded.model_version,computed_at=now();
  get diagnostics v_count=row_count;
  return jsonb_build_object('upserted',v_count);
end; $$;

-- Risk = min(10, base + crew), base = max(ML index, worst subscore). Invoker rights so service_role reaches the metrics RPC.
create function public.compute_site_risk(p_site_id uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare v_crew numeric; v_worst numeric:=0; v_worst_name text; v_result jsonb:='[]'::jsonb;
  v_ml numeric; v_base numeric; v_driver text; v_horizon text;
begin
  select crew_risk_term into v_crew from public.get_site_crew_metrics(p_site_id);
  select kv.key,kv.value::numeric into v_worst_name,v_worst
  from public.site_subscores sc,lateral jsonb_each_text(to_jsonb(sc)-'site_id'-'top_driver'-'computed_at') kv
  where sc.site_id=p_site_id order by kv.value::numeric desc limit 1;
  v_worst:=coalesce(v_worst,0);
  foreach v_horizon in array array['now','tomorrow'] loop
    select score into v_ml from public.ml_scores where site_id=p_site_id and horizon=v_horizon;
    v_base:=greatest(coalesce(v_ml,0),v_worst);
    v_driver:=case when coalesce(v_ml,0)>v_worst then 'ML hazard index '||v_ml
      when v_worst>0 then v_worst_name||' subscore '||v_worst else null end;
    insert into public.site_risk(site_id,horizon,risk,base,crew_term,top_driver,computed_at)
    values(p_site_id,v_horizon,round(least(10,v_base+coalesce(v_crew,0)),1),round(v_base,1),coalesce(v_crew,0),v_driver,now())
    on conflict(site_id,horizon) do update set risk=excluded.risk,base=excluded.base,crew_term=excluded.crew_term,
      top_driver=excluded.top_driver,computed_at=now();
    v_result:=v_result||jsonb_build_object('horizon',v_horizon,'risk',round(least(10,v_base+coalesce(v_crew,0)),1));
  end loop;
  return jsonb_build_object('site_id',p_site_id,'risk',v_result);
end; $$;

-- Client RPCs
create function public.update_crew_location(p_site_id uuid,p_lat double precision,p_lon double precision,p_accuracy_m real default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_alerts jsonb;
begin
  perform private.require_member(p_site_id);
  if p_lat is null or not(p_lat between -90 and 90) or p_lon is null or not(p_lon between -180 and 180)
    or (p_accuracy_m is not null and p_accuracy_m<0) then
    raise exception 'Valid coordinates required' using errcode='22023';
  end if;
  insert into public.crew_locations(user_id,site_id,location,accuracy_m,updated_at)
  values(auth.uid(),p_site_id,extensions.st_setsrid(extensions.st_makepoint(p_lon,p_lat),4326)::extensions.geography,p_accuracy_m,now())
  on conflict(user_id) do update set site_id=excluded.site_id,location=excluded.location,
    accuracy_m=excluded.accuracy_m,updated_at=now();
  select coalesce(jsonb_agg(jsonb_build_object('alert_id',a.id,'kind',a.kind,'level',a.level,
    'distance_mi',a.payload->'distance_mi')),'[]'::jsonb)
  into v_alerts from public.alerts a where a.site_id=p_site_id and a.status='active';
  return jsonb_build_object('ok',true,'exposed_alerts',v_alerts);
end; $$;

create function public.acknowledge_alert(p_request_id uuid,p_alert_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_site uuid; v_at timestamptz;
begin
  if p_request_id is null then raise exception 'Request ID required' using errcode='22023'; end if;
  select site_id into v_site from public.alerts where id=p_alert_id;
  if v_site is null then raise exception 'Unknown alert' using errcode='22023'; end if;
  perform private.require_member(v_site);
  -- Naturally idempotent: a retry keeps the first acknowledgement time.
  insert into public.alert_acks(alert_id,user_id) values(p_alert_id,auth.uid()) on conflict do nothing;
  select acknowledged_at into v_at from public.alert_acks where alert_id=p_alert_id and user_id=auth.uid();
  return jsonb_build_object('ok',true,'acknowledged_at',v_at);
end; $$;

create function public.mark_briefing_read(p_briefing_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_site uuid;
begin
  select site_id into v_site from public.briefings where id=p_briefing_id;
  if v_site is null then raise exception 'Unknown briefing' using errcode='22023'; end if;
  perform private.require_member(v_site);
  insert into public.briefing_reads(briefing_id,user_id) values(p_briefing_id,auth.uid()) on conflict do nothing;
  return jsonb_build_object('ok',true);
end; $$;

-- Demo scenarios write source='demo' rows through the same path as live feeds so real rules and alerts fire.
create function public.demo_inject(p_scenario text,p_site_id uuid,p_params jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_site public.sites; v_miles double precision; v_result jsonb;
begin
  if auth.uid() is null or not private.is_site_supervisor(p_site_id) then
    raise exception 'Supervisor role required' using errcode='42501';
  end if;
  select * into v_site from public.sites where id=p_site_id;
  if p_scenario not in ('lightning_strike','extra_strike') then
    raise exception 'Scenario % is not implemented yet',p_scenario using errcode='22023';
  end if;
  v_miles:=coalesce((p_params->>'distance_mi')::double precision,6);
  if v_miles<0 or v_miles>50 then raise exception 'distance_mi must be between 0 and 50' using errcode='22023'; end if;
  v_result:=private.ingest_strikes_impl(jsonb_build_array(jsonb_build_object(
    'lat',v_site.latitude+(v_miles*1609.344)/111194.9,'lon',v_site.longitude,
    'struck_at',clock_timestamp(),'source','demo')));
  return jsonb_build_object('ok',true,'injected',1,'result',v_result);
end; $$;

create function public.demo_reset(p_site_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_strikes integer;
begin
  if auth.uid() is null or not private.is_site_supervisor(p_site_id) then
    raise exception 'Supervisor role required' using errcode='42501';
  end if;
  delete from public.lightning_strikes where source='demo';
  get diagnostics v_strikes=row_count;
  delete from public.readings where source='demo' and site_id=p_site_id;
  update public.lightning_state set status='clear',updated_at=now() where site_id=p_site_id;
  update public.alerts set status='cleared',cleared_at=now() where site_id=p_site_id and status='active' and dedup_key like 'lightning:%';
  return jsonb_build_object('ok',true,'deleted_rows',v_strikes);
end; $$;

revoke all on function private.ingest_strikes_impl(jsonb),public.ingest_strikes(jsonb),public.sweep_lightning(),
  public.ingest_readings(jsonb),public.upsert_ml_scores(jsonb),public.compute_site_risk(uuid),
  public.update_crew_location(uuid,double precision,double precision,real),public.acknowledge_alert(uuid,uuid),
  public.mark_briefing_read(uuid),public.demo_inject(text,uuid,jsonb),public.demo_reset(uuid) from public,anon,authenticated;
grant execute on function public.ingest_strikes(jsonb),public.sweep_lightning(),public.ingest_readings(jsonb),
  public.upsert_ml_scores(jsonb),public.compute_site_risk(uuid) to service_role;
grant execute on function public.update_crew_location(uuid,double precision,double precision,real),
  public.acknowledge_alert(uuid,uuid),public.mark_briefing_read(uuid),public.demo_inject(text,uuid,jsonb),
  public.demo_reset(uuid) to authenticated;
