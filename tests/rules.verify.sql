-- Rolled-back assertions for the rules engine, briefings and demo scenarios.
-- Run: npm run verify:rules (expects an error reading "ALL RULE CHECKS PASSED").
do $$
declare
  riv constant uuid:='99999999-9999-4999-8999-aaaaaaaaaaa1'; dry constant uuid:='99999999-9999-4999-8999-aaaaaaaaaaa2';
  sup constant uuid:='99999999-9999-4999-8999-bbbbbbbbbbb1'; crew constant uuid:='99999999-9999-4999-8999-bbbbbbbbbbb2';
  r jsonb; n integer; t text; tz text; v numeric; msg text; denied boolean:=false; before_count integer;
begin
  insert into auth.users(id,instance_id,aud,role,email) values
    (sup,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','sup@verify.local'),
    (crew,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','crew@verify.local');
  insert into public.sites(id,name,latitude,longitude,timezone,river_distance_m,fema_flood_zone) values
    (riv,'verify river',29.652,-82.325,'America/New_York',2000,'AE'),
    (dry,'verify dry',35.0,-100.0,'America/Chicago',40000,'X');
  insert into public.site_memberships(site_id,user_id,role) values (riv,sup,'supervisor'),(riv,crew,'crew');

  set local role service_role;
  -- Heat: WBGT 91 -> stop_work alert and subscore 10, then cooler reading clears it.
  perform public.ingest_readings(jsonb_build_array(jsonb_build_object('site_id',riv,'hazard','heat','value',91,'unit','wbgt_f','observed_at',now())));
  perform public.evaluate_site(riv);
  assert (select level from public.alerts where site_id=riv and kind='heat' and status='active')='stop_work', 'heat stop_work';
  assert (select heat from public.site_subscores where site_id=riv)=10, 'heat subscore 10';
  assert (select top_driver from public.site_subscores where site_id=riv) like '%WBGT 91%', 'driver mentions WBGT';
  perform public.ingest_readings(jsonb_build_array(jsonb_build_object('site_id',riv,'hazard','heat','value',86,'unit','wbgt_f','observed_at',now()+interval '1 second')));
  perform public.evaluate_site(riv);
  assert (select level from public.alerts where site_id=riv and kind='heat' and status='active')='warning', 'tier drops to warning in place';
  perform public.ingest_readings(jsonb_build_array(jsonb_build_object('site_id',riv,'hazard','heat','value',75,'unit','wbgt_f','observed_at',now()+interval '2 seconds')));
  perform public.evaluate_site(riv);
  select count(*) into n from public.alerts where site_id=riv and kind='heat' and status='active';
  assert n=0, 'heat alert cleared';

  -- Flood: riverside + 30 mm overnight warns; the dry site does not.
  perform public.ingest_readings(jsonb_build_array(
    jsonb_build_object('site_id',riv,'hazard','flood','value',30,'unit','precip_mm_overnight','observed_at',now()),
    jsonb_build_object('site_id',dry,'hazard','flood','value',30,'unit','precip_mm_overnight','observed_at',now())));
  perform public.evaluate_site(riv); perform public.evaluate_site(dry);
  select count(*) into n from public.alerts where site_id=riv and kind='flood' and status='active';
  assert n=1, 'riverside flood warning';
  select count(*) into n from public.alerts where site_id=dry and kind='flood' and status='active';
  assert n=0, 'dry site no flood alert';
  assert (select flood from public.site_subscores where site_id=riv)>(select flood from public.site_subscores where site_id=dry), 'flood modifiers scale the subscore';

  -- Wildfire and weather
  perform public.ingest_readings(jsonb_build_array(
    jsonb_build_object('site_id',riv,'hazard','wildfire','value',3,'unit','nearest_fire_mi','observed_at',now()),
    jsonb_build_object('site_id',riv,'hazard','weather','value',45,'unit','wind_gust_mph','observed_at',now())));
  perform public.evaluate_site(riv);
  assert (select level from public.alerts where site_id=riv and kind='wildfire' and status='active')='stop_work', 'fire within 5 mi';
  select count(*) into n from public.alerts where site_id=riv and kind='other' and status='active';
  assert n=1, 'gust alert';
  select risk into v from public.site_risk where site_id=riv and horizon='now';
  assert v>=10, 'risk reflects worst subscore: '||v;

  -- The fire is out: a later 999 mi reading replaces it. One batch may hold two units of the same hazard.
  perform public.ingest_readings(jsonb_build_array(
    jsonb_build_object('site_id',riv,'hazard','wildfire','value',999,'unit','nearest_fire_mi','observed_at',now()+interval '3 seconds'),
    jsonb_build_object('site_id',riv,'hazard','wildfire','value',0,'unit','fires_within_25mi','observed_at',now()+interval '3 seconds')));
  perform public.evaluate_site(riv);
  select count(*) into n from public.alerts where site_id=riv and kind='wildfire' and status='active';
  assert n=0, 'wildfire alert clears when the fire is gone';

  -- Tomorrow risk and briefing from forecast rows
  select timezone into tz from public.sites where id=riv;
  perform public.ingest_readings(jsonb_build_array(
    jsonb_build_object('site_id',riv,'hazard','heat','value',89,'unit','wbgt_f','observed_at',now(),
      'forecast_for',(((now() at time zone tz)::date+1)::timestamp+interval '14 hours') at time zone tz),
    jsonb_build_object('site_id',riv,'hazard','weather','value',70,'unit','precip_prob_pct','observed_at',now(),
      'forecast_for',(((now() at time zone tz)::date+1)::timestamp+interval '15 hours') at time zone tz)));
  perform public.evaluate_site(riv);
  select risk,top_driver into v,t from public.site_risk where site_id=riv and horizon='tomorrow';
  assert v>=7.5 and t like '%forecast WBGT 89%', 'tomorrow risk from forecast: '||v||' '||coalesce(t,'null');

  -- Conditions that persist overnight carry into tomorrow's risk.
  perform public.ingest_readings(jsonb_build_array(
    jsonb_build_object('site_id',riv,'hazard','wildfire','value',8,'unit','nearest_fire_mi','observed_at',now()+interval '4 seconds')));
  perform public.evaluate_site(riv);
  select risk,top_driver into v,t from public.site_risk where site_id=riv and horizon='tomorrow';
  assert v>=8 and t like '%wildfire%', 'fire carries into tomorrow: '||v||' '||coalesce(t,'null');
  perform public.ingest_readings(jsonb_build_array(
    jsonb_build_object('site_id',riv,'hazard','wildfire','value',999,'unit','nearest_fire_mi','observed_at',now()+interval '5 seconds')));

  -- Evening briefing picks sites whose local hour is 18, once per local date.
  select name into tz from pg_catalog.pg_timezone_names where name ~ '^(America|Europe|Asia|Australia)/[A-Za-z_]+$'
    and extract(hour from now() at time zone name)=18 limit 1;
  if tz is not null then
    reset role;
    update public.sites set timezone=tz where id=riv;
    set local role service_role;
    perform public.ingest_readings(jsonb_build_array(jsonb_build_object('site_id',riv,'hazard','heat','value',88,'unit','wbgt_f','observed_at',now(),
      'forecast_for',(((now() at time zone tz)::date+1)::timestamp+interval '14 hours') at time zone tz)));
    r:=public.generate_due_briefings();
    assert (r->'briefing_ids') is not null and (select count(*) from public.briefings where site_id=riv)=1, 'briefing created at local 18:00';
    perform public.generate_due_briefings();
    assert (select count(*) from public.briefings where site_id=riv)=1, 'briefing not duplicated';
    assert (select jsonb_array_length(content->'hazards') from public.briefings where site_id=riv)>=1, 'briefing has hazards';
  end if;

  -- Demo scenarios as a supervisor; crew is denied.
  reset role;
  delete from public.readings where site_id=riv;
  set local role authenticated;
  perform set_config('request.jwt.claims',json_build_object('sub',sup,'role','authenticated')::text,true);
  r:=public.demo_inject('heat_wave',riv,'{}'::jsonb);
  assert (r->>'ok')::boolean, 'heat_wave ok';
  assert (select count(*) from public.alerts where site_id=riv and kind='heat' and status='active')=1, 'demo heat alert';
  perform public.demo_inject('heavy_rain',riv,'{"mm":60}'::jsonb);
  perform public.demo_inject('wildfire',riv,'{"distance_mi":12}'::jsonb);
  perform public.demo_inject('wildlife',riv,'{}'::jsonb);
  assert (select wildlife from public.site_subscores where site_id=riv)>0, 'wildlife scenario scores';
  perform public.demo_inject('lightning_strike',riv,'{"distance_mi":6}'::jsonb);
  assert (select status from public.lightning_state where site_id=riv)='stop_work', 'demo lightning stop_work';
  r:=public.demo_generate_briefing(riv);
  assert (r->>'ok')::boolean, 'demo briefing';
  perform public.demo_reset(riv);
  assert (select count(*) from public.readings where site_id=riv and source='demo')=0, 'demo readings removed';
  assert (select count(*) from public.alerts where site_id=riv and status='active' and kind in ('heat','flood','wildfire','lightning'))=0, 'demo alerts cleared';
  begin perform public.demo_inject('bogus',riv,'{}'::jsonb);
  exception when sqlstate '22023' then denied:=true; end;
  assert denied, 'unknown scenario rejected';
  denied:=false;
  perform set_config('request.jwt.claims',json_build_object('sub',crew,'role','authenticated')::text,true);
  begin perform public.demo_inject('heat_wave',riv,'{}'::jsonb);
  exception when sqlstate '42501' then denied:=true; end;
  assert denied, 'crew cannot inject';

  -- Sweep of every real site runs cleanly.
  reset role;
  set local role service_role;
  r:=public.evaluate_all_sites();
  assert (r->>'failed')::int=0, 'evaluate_all_sites: '||r;
  raise exception 'ALL RULE CHECKS PASSED (%)',r;
end $$;
