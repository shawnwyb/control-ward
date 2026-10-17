-- Scheduling: pg_cron calls Edge Functions through pg_net with a shared secret held in Vault.
-- Vault entries (never committed): 'functions_base_url' and 'cron_secret'. The service-role key is not stored in the database.
create extension if not exists pg_net with schema extensions;

create function private.invoke_function(p_name text) returns bigint
language plpgsql security definer set search_path='' as $$
declare v_base text; v_secret text;
begin
  select decrypted_secret into v_base from vault.decrypted_secrets where name='functions_base_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name='cron_secret';
  if v_base is null or v_secret is null then
    raise warning 'Vault secrets functions_base_url and cron_secret are required to call %',p_name;
    return null;
  end if;
  return net.http_post(url:=v_base||'/'||p_name,
    headers:=jsonb_build_object('Content-Type','application/json','X-Cron-Secret',v_secret),
    body:='{}'::jsonb,timeout_milliseconds:=120000);
end; $$;
revoke all on function private.invoke_function(text) from public,anon,authenticated;

-- Staggered so the feeds do not all hit the database at once. ingest-lightning is scheduled once a real source is enabled.
select cron.schedule('invoke-ingest-openmeteo','2-59/15 * * * *',$$select private.invoke_function('ingest-openmeteo')$$);
select cron.schedule('invoke-ingest-nws','7-59/15 * * * *',$$select private.invoke_function('ingest-nws')$$);
select cron.schedule('invoke-ingest-gauges','12-59/15 * * * *',$$select private.invoke_function('ingest-gauges')$$);
select cron.schedule('invoke-ingest-wildfire','1,31 * * * *',$$select private.invoke_function('ingest-wildfire')$$);

-- Readings are only useful for a few days; keep the free-plan database small.
create function public.prune_monitoring_data() returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_readings integer; v_strikes integer;
begin
  delete from public.readings where observed_at<now()-interval '5 days';
  get diagnostics v_readings=row_count;
  delete from public.lightning_strikes where struck_at<now()-interval '7 days';
  get diagnostics v_strikes=row_count;
  return jsonb_build_object('readings',v_readings,'strikes',v_strikes);
end; $$;
revoke all on function public.prune_monitoring_data() from public,anon,authenticated;
grant execute on function public.prune_monitoring_data() to service_role;
select cron.schedule('prune-monitoring-data','17 4 * * *','select public.prune_monitoring_data();');

-- Tomorrow's risk also carries over conditions that persist overnight (an active fire, saturated ground).
create or replace function public.compute_site_risk(p_site_id uuid,p_tomorrow_worst numeric default null,p_tomorrow_driver text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_crew numeric; v_worst numeric:=0; v_driver text; v_result jsonb:='[]'::jsonb;
  v_ml numeric; v_base numeric; v_h text; v_risk numeric; v_top text; v_fire numeric:=0; v_soil numeric:=0;
  v_carry numeric; v_fc numeric;
begin
  select crew_risk_term into v_crew from private.crew_metrics(p_site_id);
  select greatest(weather,lightning,flood,heat,wildfire,soil,wildlife),top_driver,wildfire,soil
  into v_worst,v_driver,v_fire,v_soil from public.site_subscores where site_id=p_site_id;
  v_worst:=coalesce(v_worst,0); v_fire:=coalesce(v_fire,0); v_soil:=coalesce(v_soil,0);
  v_carry:=greatest(v_fire,v_soil);
  v_fc:=greatest(coalesce(p_tomorrow_worst,0),v_carry);
  foreach v_h in array array['now','tomorrow'] loop
    select score into v_ml from public.ml_scores where site_id=p_site_id and horizon=v_h;
    if v_h='now' then
      v_base:=greatest(coalesce(v_ml,0),v_worst);
      v_top:=case when coalesce(v_ml,0)>v_worst then 'ML hazard index '||v_ml else v_driver end;
    else
      v_base:=greatest(coalesce(v_ml,0),v_fc);
      v_top:=case when coalesce(v_ml,0)>v_fc then 'ML hazard index '||v_ml
        when v_fc=0 then null
        when coalesce(p_tomorrow_worst,0)>=v_carry then p_tomorrow_driver
        when v_fire>=v_soil then 'Driven by the ongoing wildfire nearby' else 'Driven by saturated soil' end;
    end if;
    v_risk:=round(least(10,v_base+coalesce(v_crew,0)),1);
    insert into public.site_risk(site_id,horizon,risk,base,crew_term,top_driver,computed_at)
    values(p_site_id,v_h,v_risk,round(v_base,1),coalesce(v_crew,0),v_top,now())
    on conflict(site_id,horizon) do update set risk=excluded.risk,base=excluded.base,crew_term=excluded.crew_term,
      top_driver=excluded.top_driver,computed_at=now();
    v_result:=v_result||jsonb_build_object('horizon',v_h,'risk',v_risk);
  end loop;
  return jsonb_build_object('site_id',p_site_id,'risk',v_result);
end; $$;
