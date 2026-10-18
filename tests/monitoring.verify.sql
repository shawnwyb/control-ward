-- Rolled-back assertions for the lightning state machine, readings upsert and risk formula.
-- Run: npm run verify:monitoring (expects an error reading "ALL CHECKS PASSED").
do $$
declare s constant uuid:='99999999-9999-4999-8999-999999999999'; r jsonb; n integer; st text; d integer; log text:='';
begin
  insert into public.sites(id,name,latitude,longitude,timezone) values(s,'verify',29.652,-82.325,'America/New_York');
  set local role service_role;
  r:=public.ingest_strikes(jsonb_build_array(
    jsonb_build_object('lat',29.652+6*1609.344/111194.9,'lon',-82.325,'struck_at',now(),'source','verify'),
    jsonb_build_object('lat',29.652+40*1609.344/111194.9,'lon',-82.325,'struck_at',now(),'source','verify')));
  assert (r->>'strikes')::int=2, 'both strikes stored: '||r::text;
  assert (r->'sites_in_range') @> jsonb_build_array(jsonb_build_object('site_id',s)), 'fixture site in range: '||r::text;
  select status,last_strike_distance_m into st,d from public.lightning_state where site_id=s;
  assert st='stop_work', 'stop_work set';
  log:=log||'distance_m='||d||'; ';
  assert d between 9500 and 9800, 'distance about 6 mi: '||d;
  -- duplicate batch is ignored
  r:=public.ingest_strikes(jsonb_build_array(jsonb_build_object('lat',29.652+6*1609.344/111194.9,'lon',-82.325,'struck_at',(select struck_at from public.lightning_strikes where source='verify' order by id limit 1),'source','verify')));
  assert (r->>'strikes')::int=0, 'duplicate ignored';
  -- new strike resets, still one active alert
  r:=public.ingest_strikes(jsonb_build_array(jsonb_build_object('lat',29.652+3*1609.344/111194.9,'lon',-82.325,'struck_at',now()+interval '1 minute','source','verify')));
  select count(*) into n from public.alerts where site_id=s and status='active';
  assert n=1, 'one active alert, got '||n;
  assert (select last_strike_at from public.lightning_state where site_id=s)>now(), 'last_strike_at moved forward';
  -- age past 30 min then sweep
  update public.lightning_state set last_strike_at=now()-interval '31 minutes' where site_id=s;
  r:=public.sweep_lightning();
  assert (select status from public.lightning_state where site_id=s)='clear', 'cleared after 30 min';
  assert (select status from public.alerts where site_id=s order by created_at desc limit 1)='cleared', 'alert cleared';
  -- stale strike does not trigger
  r:=public.ingest_strikes(jsonb_build_array(jsonb_build_object('lat',29.652,'lon',-82.325,'struck_at',now()-interval '40 minutes','source','verify')));
  assert (select status from public.lightning_state where site_id=s)='clear', 'old strike ignored';
  -- readings upsert
  r:=public.ingest_readings('[{"site_id":"99999999-9999-4999-8999-999999999999","hazard":"heat","value":88.4,"unit":"F_wbgt","observed_at":"2026-10-17T12:00:00Z"}]'::jsonb);
  assert (r->>'inserted')::int=1, 'reading inserted';
  r:=public.ingest_readings('[{"site_id":"99999999-9999-4999-8999-999999999999","hazard":"heat","value":89.0,"unit":"F_wbgt","observed_at":"2026-10-17T12:00:00Z"}]'::jsonb);
  assert (r->>'updated')::int=1, 'reading updated';
  -- risk
  insert into public.site_subscores(site_id,heat) values(s,7.5);
  perform public.upsert_ml_scores('[{"site_id":"99999999-9999-4999-8999-999999999999","horizon":"now","score":9.0,"model_version":"t"}]'::jsonb);
  perform public.compute_site_risk(s);
  assert (select risk from public.site_risk where site_id=s and horizon='now')=9.0, 'ml dominates base';
  -- several models: one row each (without `model`, the model_version prefix decides); the highest fresh score wins
  perform public.upsert_ml_scores('[{"site_id":"99999999-9999-4999-8999-999999999999","horizon":"now","score":5.0,"model_version":"stram-x"},
    {"site_id":"99999999-9999-4999-8999-999999999999","horizon":"now","score":9.4,"model_version":"v2","model":"hazard_index"}]'::jsonb);
  perform public.upsert_ml_scores('[{"site_id":"99999999-9999-4999-8999-999999999999","horizon":"now","score":9.5,"model_version":"v3","model":"hazard_index"}]'::jsonb);
  select count(*) into n from public.ml_scores where site_id=s and horizon='now';
  assert n=3, 'one row per model (t, mud, hazard_index), got '||n;
  assert exists(select 1 from public.ml_scores where site_id=s and model='mud' and score=5.0), 'stram prefix maps to mud';
  perform public.compute_site_risk(s);
  assert (select risk from public.site_risk where site_id=s and horizon='now')=9.5, 'highest model wins';
  assert (select top_driver from public.site_risk where site_id=s and horizon='now')='ML hazard index 9.5', 'driver names the model';
  -- stale rows stop counting: older than 36 h for now, 48 h for tomorrow
  update public.ml_scores set computed_at=now()-interval '37 hours' where site_id=s and horizon='now' and model<>'mud';
  perform public.upsert_ml_scores('[{"site_id":"99999999-9999-4999-8999-999999999999","horizon":"tomorrow","score":8.0,"model_version":"v3","model":"hazard_index"}]'::jsonb);
  update public.ml_scores set computed_at=now()-interval '40 hours' where site_id=s and horizon='tomorrow';
  perform public.compute_site_risk(s);
  assert (select risk from public.site_risk where site_id=s and horizon='now')=7.5, 'stale now scores ignored, heat subscore wins';
  assert (select risk from public.site_risk where site_id=s and horizon='tomorrow')=8.0, 'a 40 h old tomorrow score still counts';
  update public.ml_scores set computed_at=now()-interval '49 hours' where site_id=s and horizon='tomorrow';
  perform public.compute_site_risk(s);
  assert (select risk from public.site_risk where site_id=s and horizon='tomorrow')=0, 'stale tomorrow score ignored';
  update public.ml_scores set computed_at=now() where site_id=s and horizon='now' and model='mud';
  update public.site_subscores set heat=0 where site_id=s;
  perform public.compute_site_risk(s);
  assert (select top_driver from public.site_risk where site_id=s and horizon='now')='ML mud trafficability 5.0', 'mud label';
  raise exception 'ALL CHECKS PASSED (%)',log;
end $$;
