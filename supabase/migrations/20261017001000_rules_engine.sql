-- Rules engine: readings -> subscores (0-10) -> alerts and risk. Also the evening briefing and demo scenarios.
-- Reading conventions (hazard, unit) are documented in docs/api-contract.md. No ML is involved here:
-- ml_scores stays optional and counts as 0 when absent.

-- Crew term without the caller membership check, so pg_cron and service workers can score every site.
create function private.crew_metrics(p_site_id uuid)
returns table(crew_risk_term numeric,wildlife_subscore numeric,open_report_count bigint)
language sql stable security definer set search_path='' as $$
  select round(least(2::numeric,coalesce(sum(weight),0)),2),
    round(least(10::numeric,coalesce(sum(10*weight) filter(where type='wildlife'),0)),1),count(*)
  from (
    select h.type,(h.severity::numeric/3)*greatest(0::numeric,
      1-extract(epoch from (now()-h.last_confirmed_at))/172800) as weight
    from public.hazard_reports h join public.sites s on s.id=h.site_id
    where h.site_id=p_site_id and h.status='open' and h.last_confirmed_at>now()-interval '48 hours'
      and extensions.st_dwithin(h.location,s.location,s.report_radius_m)
  ) weighted;
$$;
revoke all on function private.crew_metrics(uuid) from public,anon,authenticated;

create function private.latest_reading(p_site uuid,p_hazard public.hazard_kind,p_unit text,
  p_max_age interval default interval '3 hours') returns double precision
language sql stable security definer set search_path='' as $$
  select value from public.readings
  where site_id=p_site and hazard=p_hazard and unit=p_unit and forecast_for='-infinity'
    and observed_at>now()-p_max_age
  order by observed_at desc limit 1;
$$;

-- Newest forecast per target hour, then the maximum inside the window.
create function private.forecast_max(p_site uuid,p_hazard public.hazard_kind,p_unit text,
  p_from timestamptz,p_to timestamptz) returns double precision
language sql stable security definer set search_path='' as $$
  select max(value) from (
    select distinct on (forecast_for) value from public.readings
    where site_id=p_site and hazard=p_hazard and unit=p_unit and forecast_for>=p_from and forecast_for<p_to
    order by forecast_for,observed_at desc) t;
$$;
revoke all on function private.latest_reading(uuid,public.hazard_kind,text,interval),
  private.forecast_max(uuid,public.hazard_kind,text,timestamptz,timestamptz) from public,anon,authenticated;

-- Scoring tables. Heat tiers (F): 82 caution, 85 rest breaks, 88 danger, 90 stop heavy work.
-- These WBGT tiers follow the US military heat categories and are NOT yet verified against TB MED 507.
create function private.heat_tier(p_wbgt double precision) returns integer
language sql immutable set search_path='' as $$
  select case when p_wbgt>=90 then 4 when p_wbgt>=88 then 3 when p_wbgt>=85 then 2 when p_wbgt>=82 then 1 else 0 end;
$$;
create function private.heat_score(p_wbgt double precision,p_hi double precision) returns numeric
language sql immutable set search_path='' as $$
  select greatest(
    case private.heat_tier(p_wbgt) when 4 then 10 when 3 then 7.5 when 2 then 5 when 1 then 3 else 0 end,
    case when p_hi>=125 then 9 when p_hi>=103 then 6 when p_hi>=90 then 3 else 0 end)::numeric;
$$;
-- Static attributes (flood zone, river distance) scale the flood subscore; they never raise it alone.
create function private.flood_score(p_rain_mm double precision,p_stage double precision,p_flood_stage double precision,
  p_warning double precision,p_zone text,p_river_m integer) returns numeric
language sql immutable set search_path='' as $$
  select least(10,greatest(
      case when p_rain_mm>=100 then 9 when p_rain_mm>=50 then 6 when p_rain_mm>=25 then 4 when p_rain_mm>=10 then 2 else 0 end,
      case when p_stage is null or p_flood_stage is null or p_flood_stage<=0 then 0
        when p_stage>=p_flood_stage then 9 when p_stage>=0.8*p_flood_stage then 6 else 0 end,
      case when coalesce(p_warning,0)>=1 then 8 else 0 end)
    * case when p_zone in ('A','AE','AH','AO','AR','A99','V','VE') then 1.3 else 1 end
    * case when p_river_m is null then 1 when p_river_m<=5000 then 1.2 when p_river_m>25000 then 0.8 else 1 end)::numeric;
$$;
create function private.wildfire_score(p_miles double precision) returns numeric
language sql immutable set search_path='' as $$
  select case when p_miles is null then 0 when p_miles<5 then 10 when p_miles<10 then 8 when p_miles<25 then 6
    when p_miles<50 then 3 when p_miles<100 then 1 else 0 end::numeric;
$$;
create function private.soil_score(p_frac double precision) returns numeric
language sql immutable set search_path='' as $$
  select case when p_frac>=0.45 then 8 when p_frac>=0.40 then 6 when p_frac>=0.35 then 4 when p_frac>=0.30 then 2 else 0 end::numeric;
$$;
create function private.weather_score(p_severity double precision,p_gust double precision) returns numeric
language sql immutable set search_path='' as $$
  select greatest(least(coalesce(p_severity,0)*2,8),
    case when p_gust>=58 then 9 when p_gust>=40 then 6 when p_gust>=30 then 3 else 0 end)::numeric;
$$;

-- One alert row per (kind, site) while active; level and payload update in place, cleared when the condition ends.
create function private.set_alert(p_site uuid,p_kind text,p_level text,p_payload jsonb,p_active boolean) returns void
language plpgsql security definer set search_path='' as $$
begin
  if p_active then
    insert into public.alerts(site_id,kind,level,payload,dedup_key)
    values(p_site,p_kind,p_level,p_payload,p_kind||':'||p_site)
    on conflict(dedup_key) where status='active' do update
      set level=excluded.level,payload=excluded.payload
      where (public.alerts.level,public.alerts.payload) is distinct from (excluded.level,excluded.payload);
  else
    update public.alerts set status='cleared',cleared_at=now()
    where dedup_key=p_kind||':'||p_site and status='active';
  end if;
end; $$;
revoke all on function private.set_alert(uuid,text,text,jsonb,boolean) from public,anon,authenticated;

drop function public.compute_site_risk(uuid);
-- Risk = min(10, base + crew), base = max(ML index if any, worst subscore). Tomorrow uses forecast-derived inputs.
create function public.compute_site_risk(p_site_id uuid,p_tomorrow_worst numeric default null,p_tomorrow_driver text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_crew numeric; v_worst numeric:=0; v_driver text; v_result jsonb:='[]'::jsonb;
  v_ml numeric; v_base numeric; v_h text; v_risk numeric; v_top text;
begin
  select crew_risk_term into v_crew from private.crew_metrics(p_site_id);
  select greatest(weather,lightning,flood,heat,wildfire,soil,wildlife),top_driver into v_worst,v_driver
  from public.site_subscores where site_id=p_site_id;
  v_worst:=coalesce(v_worst,0);
  foreach v_h in array array['now','tomorrow'] loop
    select score into v_ml from public.ml_scores where site_id=p_site_id and horizon=v_h;
    if v_h='now' then v_base:=greatest(coalesce(v_ml,0),v_worst); v_top:=case when coalesce(v_ml,0)>v_worst then 'ML hazard index '||v_ml else v_driver end;
    else v_base:=greatest(coalesce(v_ml,0),coalesce(p_tomorrow_worst,v_worst));
      v_top:=case when coalesce(v_ml,0)>coalesce(p_tomorrow_worst,v_worst) then 'ML hazard index '||v_ml
        else coalesce(p_tomorrow_driver,v_driver) end;
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

create function public.evaluate_site(p_site_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  s public.sites; v_wbgt double precision; v_hi double precision; v_rain_o double precision; v_rain_24 double precision;
  v_stage double precision; v_fstage double precision; v_warn double precision; v_soil double precision;
  v_fire double precision; v_fires double precision; v_sev double precision; v_gust double precision;
  v_heat numeric; v_flood numeric; v_fire_s numeric; v_soil_s numeric; v_wx numeric; v_lt numeric:=0; v_wild numeric;
  v_state text; v_recent integer; v_tier integer; v_drivers jsonb:='[]'::jsonb; v_top text;
  v_from timestamptz; v_to timestamptz; f_wbgt double precision; f_hi double precision; f_rain double precision; f_gust double precision;
  f_heat numeric; f_flood numeric; f_wx numeric; f_worst numeric; f_driver text; v_riverside boolean; v_result jsonb;
begin
  select * into s from public.sites where id=p_site_id;
  if not found then raise exception 'Unknown site' using errcode='22023'; end if;

  v_wbgt:=private.latest_reading(p_site_id,'heat','wbgt_f');
  v_hi:=private.latest_reading(p_site_id,'heat','heat_index_f');
  v_rain_o:=private.latest_reading(p_site_id,'flood','precip_mm_overnight',interval '18 hours');
  v_rain_24:=private.latest_reading(p_site_id,'flood','precip_mm_24h',interval '6 hours');
  v_stage:=private.latest_reading(p_site_id,'flood','gauge_stage_ft');
  v_fstage:=private.latest_reading(p_site_id,'flood','gauge_flood_stage_ft',interval '3 days');
  v_warn:=private.latest_reading(p_site_id,'flood','nws_flood_warning');
  v_soil:=private.latest_reading(p_site_id,'soil','soil_moisture_frac',interval '6 hours');
  v_fire:=private.latest_reading(p_site_id,'wildfire','nearest_fire_mi',interval '6 hours');
  v_fires:=private.latest_reading(p_site_id,'wildfire','fires_within_25mi',interval '6 hours');
  v_sev:=private.latest_reading(p_site_id,'weather','nws_alert_severity');
  v_gust:=private.latest_reading(p_site_id,'weather','wind_gust_mph');

  v_heat:=private.heat_score(v_wbgt,v_hi);
  v_flood:=private.flood_score(greatest(v_rain_o,v_rain_24),v_stage,v_fstage,v_warn,s.fema_flood_zone,s.river_distance_m);
  v_fire_s:=private.wildfire_score(v_fire);
  v_soil_s:=private.soil_score(v_soil);
  v_wx:=private.weather_score(v_sev,v_gust);
  select wildlife_subscore into v_wild from private.crew_metrics(p_site_id);
  select status into v_state from public.lightning_state where site_id=p_site_id;
  select count(*) into v_recent from public.lightning_strikes n
    where n.struck_at>now()-interval '60 minutes' and extensions.st_dwithin(n.location,s.location,40233.6);
  v_lt:=case when v_state='stop_work' then 10 when v_recent>0 then 4 else 0 end;

  -- Heat alert: WBGT tiers, with heat index as fallback when no WBGT reading exists.
  v_tier:=private.heat_tier(v_wbgt);
  if v_wbgt is not null and v_tier>0 then
    perform private.set_alert(p_site_id,'heat',case v_tier when 4 then 'stop_work' when 1 then 'info' else 'warning' end,
      jsonb_build_object('wbgt_f',v_wbgt,'tier',case v_tier when 4 then 'stop heavy work' when 3 then 'danger, limit heavy work'
        when 2 then 'scheduled rest breaks' else 'caution' end),true);
  elsif v_wbgt is null and v_hi>=103 then
    perform private.set_alert(p_site_id,'heat',case when v_hi>=125 then 'stop_work' else 'warning' end,
      jsonb_build_object('heat_index_f',v_hi,'tier','heat index fallback'),true);
  else
    perform private.set_alert(p_site_id,'heat','info','{}'::jsonb,false);
  end if;

  -- Flood alert: riverside site plus heavy overnight rain, or a gauge above flood stage, or an NWS flood warning.
  v_riverside:=coalesce(s.river_distance_m<=5000,false) or coalesce(s.fema_flood_zone in ('A','AE','AH','AO','AR','A99','V','VE'),false)
    or coalesce(v_stage>=0.8*nullif(v_fstage,0),false) or coalesce(v_warn,0)>=1;
  if (v_riverside and coalesce(v_rain_o,0)>=25) or coalesce(v_stage>=v_fstage and v_fstage>0,false) or coalesce(v_warn,0)>=1 then
    perform private.set_alert(p_site_id,'flood','warning',jsonb_build_object('rain_overnight_mm',v_rain_o,'gauge_stage_ft',v_stage,
      'flood_zone',s.fema_flood_zone,'river_distance_m',s.river_distance_m,'nws_flood_warning',coalesce(v_warn,0)>=1),true);
  else perform private.set_alert(p_site_id,'flood','warning','{}'::jsonb,false); end if;

  if v_fire<25 then
    perform private.set_alert(p_site_id,'wildfire',case when v_fire<5 then 'stop_work' else 'warning' end,
      jsonb_build_object('nearest_fire_mi',v_fire,'fires_within_25mi',v_fires,'smoke_note','Smoke likely; check air quality before heavy work.'),true);
  else perform private.set_alert(p_site_id,'wildfire','warning','{}'::jsonb,false); end if;

  if coalesce(v_sev,0)>=3 or coalesce(v_gust,0)>=40 then
    perform private.set_alert(p_site_id,'other','warning',jsonb_build_object('nws_alert_severity',v_sev,'wind_gust_mph',v_gust),true);
  else perform private.set_alert(p_site_id,'other','warning','{}'::jsonb,false); end if;

  -- Top drivers in plain words: the two largest subscores that are above zero.
  v_drivers:=jsonb_build_array(
    jsonb_build_object('s',v_lt,'t',case when v_state='stop_work' then 'lightning stop-work' else 'lightning within 25 mi' end),
    jsonb_build_object('s',v_heat,'t',case when v_wbgt is not null then 'WBGT '||round(v_wbgt)||'°F' else 'heat index '||round(coalesce(v_hi,0))||'°F' end),
    jsonb_build_object('s',v_flood,'t',case when coalesce(v_warn,0)>=1 then 'NWS flood warning' when v_stage>=v_fstage and v_fstage>0 then 'river above flood stage'
      else 'heavy rain ('||round(greatest(coalesce(v_rain_o,0),coalesce(v_rain_24,0)))||' mm)' end),
    jsonb_build_object('s',v_fire_s,'t','wildfire '||round(coalesce(v_fire,0))||' mi away'),
    jsonb_build_object('s',v_soil_s,'t','saturated soil'),
    jsonb_build_object('s',v_wx,'t',case when coalesce(v_sev,0)>=3 then 'NWS severe weather alert' else 'gusts '||round(coalesce(v_gust,0))||' mph' end),
    jsonb_build_object('s',coalesce(v_wild,0),'t','recent wildlife sighting'));
  select 'Driven by '||string_agg(e->>'t',' and ' order by (e->>'s')::numeric desc) into v_top
  from (select e from jsonb_array_elements(v_drivers) e where (e->>'s')::numeric>0
        order by (e->>'s')::numeric desc limit 2) x;

  insert into public.site_subscores(site_id,weather,lightning,flood,heat,wildfire,soil,wildlife,top_driver,computed_at)
  values(p_site_id,least(10,v_wx),v_lt,least(10,v_flood),least(10,v_heat),least(10,v_fire_s),least(10,v_soil_s),
    least(10,coalesce(v_wild,0)),v_top,now())
  on conflict(site_id) do update set weather=excluded.weather,lightning=excluded.lightning,flood=excluded.flood,
    heat=excluded.heat,wildfire=excluded.wildfire,soil=excluded.soil,wildlife=excluded.wildlife,
    top_driver=excluded.top_driver,computed_at=now();

  -- Tomorrow (site-local calendar day) from forecast rows.
  v_from:=((now() at time zone s.timezone)::date+1)::timestamp at time zone s.timezone;
  v_to:=v_from+interval '1 day';
  f_wbgt:=private.forecast_max(p_site_id,'heat','wbgt_f',v_from,v_to);
  f_hi:=private.forecast_max(p_site_id,'heat','heat_index_f',v_from,v_to);
  f_rain:=private.forecast_max(p_site_id,'flood','precip_mm_24h',v_from,v_to);
  f_gust:=private.forecast_max(p_site_id,'weather','wind_gust_mph',v_from,v_to);
  f_heat:=private.heat_score(f_wbgt,f_hi);
  f_flood:=private.flood_score(f_rain,null,null,0,s.fema_flood_zone,s.river_distance_m);
  f_wx:=private.weather_score(0,f_gust);
  f_worst:=greatest(f_heat,f_flood,f_wx);
  f_driver:=case when f_worst=0 then null
    when f_worst=f_heat then 'Driven by forecast '||case when f_wbgt is not null then 'WBGT '||round(f_wbgt)||'°F' else 'heat index '||round(f_hi)||'°F' end
    when f_worst=f_flood then 'Driven by forecast rain ('||round(f_rain)||' mm)'
    else 'Driven by forecast gusts '||round(f_gust)||' mph' end;

  v_result:=public.compute_site_risk(p_site_id,case when f_wbgt is null and f_hi is null and f_rain is null and f_gust is null then null else f_worst end,f_driver);
  return jsonb_build_object('site_id',p_site_id,'top_driver',v_top,'risk',v_result->'risk');
end; $$;

create function public.evaluate_all_sites() returns jsonb
language plpgsql security definer set search_path='' as $$
declare s record; v_ok integer:=0; v_failed integer:=0;
begin
  for s in select id from public.sites loop
    begin perform public.evaluate_site(s.id); v_ok:=v_ok+1;
    exception when others then v_failed:=v_failed+1; raise warning 'evaluate_site % failed: %',s.id,sqlerrm; end;
  end loop;
  return jsonb_build_object('evaluated',v_ok,'failed',v_failed);
end; $$;

-- Evening briefing: built for every site whose local clock is in the 18:00 hour; one per site and local date.
create function private.build_briefing(p_site_id uuid,p_overwrite boolean) returns uuid
language plpgsql security definer set search_path='' as $$
declare s public.sites; v_date date; v_from timestamptz; v_to timestamptz; v_hazards jsonb:='[]'::jsonb;
  v_risk public.site_risk; v_open jsonb; v_fire double precision; v_id uuid; v_content jsonb;
  f_wbgt double precision; f_hi double precision; f_temp double precision; f_gust double precision; f_pop double precision; f_rain double precision;
begin
  select * into s from public.sites where id=p_site_id;
  v_date:=(now() at time zone s.timezone)::date+1;
  v_from:=v_date::timestamp at time zone s.timezone; v_to:=v_from+interval '1 day';
  f_wbgt:=private.forecast_max(p_site_id,'heat','wbgt_f',v_from,v_to);
  f_hi:=private.forecast_max(p_site_id,'heat','heat_index_f',v_from,v_to);
  f_temp:=private.forecast_max(p_site_id,'weather','temp_f',v_from,v_to);
  f_gust:=private.forecast_max(p_site_id,'weather','wind_gust_mph',v_from,v_to);
  f_pop:=private.forecast_max(p_site_id,'weather','precip_prob_pct',v_from,v_to);
  f_rain:=private.forecast_max(p_site_id,'flood','precip_mm_24h',v_from,v_to);
  if f_wbgt is not null then v_hazards:=v_hazards||jsonb_build_object('hazard','heat','metric','WBGT','forecast',f_wbgt,'unit','F',
    'level',case private.heat_tier(f_wbgt) when 4 then 'stop heavy work' when 3 then 'danger' when 2 then 'rest breaks' when 1 then 'caution' else 'normal' end); end if;
  if f_hi is not null then v_hazards:=v_hazards||jsonb_build_object('hazard','heat','metric','heat index','forecast',f_hi,'unit','F',
    'level',case when f_hi>=125 then 'extreme danger' when f_hi>=103 then 'danger' when f_hi>=90 then 'caution' else 'normal' end); end if;
  if f_temp is not null then v_hazards:=v_hazards||jsonb_build_object('hazard','weather','metric','high temperature','forecast',f_temp,'unit','F','level','info'); end if;
  if f_gust is not null then v_hazards:=v_hazards||jsonb_build_object('hazard','weather','metric','wind gust','forecast',f_gust,'unit','mph',
    'level',case when f_gust>=58 then 'danger' when f_gust>=40 then 'caution' else 'normal' end); end if;
  if f_pop is not null then v_hazards:=v_hazards||jsonb_build_object('hazard','lightning','metric','thunderstorm chance','forecast',f_pop,'unit','%',
    'level',case when f_pop>=60 then 'caution' else 'normal' end); end if;
  if f_rain is not null then v_hazards:=v_hazards||jsonb_build_object('hazard','flood','metric','rainfall','forecast',f_rain,'unit','mm',
    'level',case when f_rain>=50 then 'danger' when f_rain>=25 then 'caution' else 'normal' end); end if;

  select * into v_risk from public.site_risk where site_id=p_site_id and horizon='tomorrow';
  select coalesce(jsonb_agg(jsonb_build_object('id',f.id,'type',f.type,'severity',f.severity,'latitude',f.latitude,
    'longitude',f.longitude,'last_confirmed_at',f.last_confirmed_at) order by f.severity desc,f.last_confirmed_at desc),'[]'::jsonb)
  into v_open from public.crew_hazard_feed f where f.site_id=p_site_id and f.is_active;
  v_fire:=private.latest_reading(p_site_id,'wildfire','nearest_fire_mi',interval '6 hours');

  v_content:=jsonb_build_object('tz',s.timezone,'hazards',v_hazards,'predicted_risk',v_risk.risk,'top_driver',v_risk.top_driver,
    'open_crew_hazards',v_open,
    'smoke_note',case when v_fire<25 then 'Active fire '||round(v_fire)||' mi away; expect smoke and check air quality.' else null end);
  insert into public.briefings(site_id,for_date,content,generated_at) values(p_site_id,v_date,v_content,now())
  on conflict(site_id,for_date) do update set content=excluded.content,generated_at=now() where p_overwrite
  returning id into v_id;
  return v_id;
end; $$;

create function public.generate_due_briefings() returns jsonb
language plpgsql security definer set search_path='' as $$
declare s record; v_ids uuid[]:='{}'; v_id uuid;
begin
  for s in select id from public.sites where extract(hour from now() at time zone timezone)=18 loop
    v_id:=private.build_briefing(s.id,false);
    if v_id is not null then v_ids:=v_ids||v_id; end if;
  end loop;
  return jsonb_build_object('sites',coalesce(array_length(v_ids,1),0),'briefing_ids',to_jsonb(v_ids));
end; $$;

-- Demo scenarios write source='demo' rows through the same evaluation path as live feeds.
create or replace function public.demo_inject(p_scenario text,p_site_id uuid,p_params jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_site public.sites; v_miles double precision; v_result jsonb; v_val double precision;
begin
  if auth.uid() is null or not private.is_site_supervisor(p_site_id) then
    raise exception 'Supervisor role required' using errcode='42501';
  end if;
  select * into v_site from public.sites where id=p_site_id;
  if p_scenario in ('lightning_strike','extra_strike') then
    v_miles:=coalesce((p_params->>'distance_mi')::double precision,6);
    if v_miles<0 or v_miles>50 then raise exception 'distance_mi must be between 0 and 50' using errcode='22023'; end if;
    v_result:=private.ingest_strikes_impl(jsonb_build_array(jsonb_build_object(
      'lat',v_site.latitude+(v_miles*1609.344)/111194.9,'lon',v_site.longitude,'struck_at',clock_timestamp(),'source','demo')));
  elsif p_scenario='heavy_rain' then
    v_val:=coalesce((p_params->>'mm')::double precision,45);
    insert into public.readings(site_id,hazard,value,unit,observed_at,source) values
      (p_site_id,'flood',v_val,'precip_mm_overnight',clock_timestamp(),'demo'),
      (p_site_id,'flood',v_val+10,'precip_mm_24h',clock_timestamp(),'demo'),
      (p_site_id,'soil',0.46,'soil_moisture_frac',clock_timestamp(),'demo');
    v_result:=public.evaluate_site(p_site_id);
  elsif p_scenario='heat_wave' then
    v_val:=coalesce((p_params->>'wbgt_f')::double precision,91);
    insert into public.readings(site_id,hazard,value,unit,observed_at,source) values
      (p_site_id,'heat',v_val,'wbgt_f',clock_timestamp(),'demo'),
      (p_site_id,'heat',v_val+21,'heat_index_f',clock_timestamp(),'demo');
    v_result:=public.evaluate_site(p_site_id);
  elsif p_scenario='wildfire' then
    v_val:=coalesce((p_params->>'distance_mi')::double precision,12);
    insert into public.readings(site_id,hazard,value,unit,observed_at,source) values
      (p_site_id,'wildfire',v_val,'nearest_fire_mi',clock_timestamp(),'demo'),
      (p_site_id,'wildfire',1,'fires_within_25mi',clock_timestamp(),'demo');
    v_result:=public.evaluate_site(p_site_id);
  elsif p_scenario='wildlife' then
    -- Goes through the real reporting RPC so merging, history and scoring all apply.
    perform public.submit_hazard_report(gen_random_uuid(),p_site_id,'wildlife',3,v_site.latitude+0.0005,v_site.longitude,null);
    v_result:=public.evaluate_site(p_site_id);
  else
    raise exception 'Unknown scenario %',p_scenario using errcode='22023';
  end if;
  return jsonb_build_object('ok',true,'injected',1,'result',v_result);
end; $$;

create or replace function public.demo_reset(p_site_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_strikes integer; v_readings integer;
begin
  if auth.uid() is null or not private.is_site_supervisor(p_site_id) then
    raise exception 'Supervisor role required' using errcode='42501';
  end if;
  delete from public.lightning_strikes where source='demo';
  get diagnostics v_strikes=row_count;
  delete from public.readings where source='demo' and site_id=p_site_id;
  get diagnostics v_readings=row_count;
  update public.lightning_state set status='clear',updated_at=now() where site_id=p_site_id;
  update public.alerts set status='cleared',cleared_at=now() where site_id=p_site_id and status='active' and dedup_key like 'lightning:%';
  perform public.evaluate_site(p_site_id);
  return jsonb_build_object('ok',true,'deleted_rows',v_strikes+v_readings);
end; $$;

create function public.demo_generate_briefing(p_site_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
  if auth.uid() is null or not private.is_site_supervisor(p_site_id) then
    raise exception 'Supervisor role required' using errcode='42501';
  end if;
  perform public.evaluate_site(p_site_id);
  v_id:=private.build_briefing(p_site_id,true);
  return jsonb_build_object('ok',true,'briefing_id',v_id);
end; $$;

revoke all on function public.compute_site_risk(uuid,numeric,text),public.evaluate_site(uuid),public.evaluate_all_sites(),
  public.generate_due_briefings(),public.demo_inject(text,uuid,jsonb),public.demo_reset(uuid),public.demo_generate_briefing(uuid),
  private.build_briefing(uuid,boolean) from public,anon,authenticated;
grant execute on function public.compute_site_risk(uuid,numeric,text),public.evaluate_site(uuid),public.evaluate_all_sites(),
  public.generate_due_briefings() to service_role;
grant execute on function public.demo_inject(text,uuid,jsonb),public.demo_reset(uuid),public.demo_generate_briefing(uuid) to authenticated;

select cron.schedule('evaluate-all-sites','*/5 * * * *','select public.evaluate_all_sites();');
select cron.schedule('generate-due-briefings','0 * * * *','select public.generate_due_briefings();');
