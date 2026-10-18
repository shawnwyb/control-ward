-- ml_scores holds one row per site, horizon and model, so several ML models can feed live risk at the same time
-- (docs/ML_SCORES_BRIEF.md): `mud` (rutting forecast, models/mud-trafficability) and `hazard_index`
-- (models/hazard-index). compute_site_risk uses the highest fresh model score: rows older than 36 h (now) or
-- 48 h (tomorrow) are ignored, not deleted. top_driver names the winning model.

alter table public.ml_scores add column model text;
update public.ml_scores set model=case lower(split_part(model_version,'-',1))
  when 'stram' then 'mud' when 'hazidx' then 'hazard_index' else lower(split_part(model_version,'-',1)) end;
alter table public.ml_scores alter column model set not null,
  add constraint ml_scores_model_check check (model ~ '^[a-z][a-z0-9_]{0,31}$');
alter table public.ml_scores drop constraint ml_scores_pkey, add primary key (site_id,horizon,model);

-- `model` is optional in the payload. Without it the model_version prefix decides (stram -> mud,
-- hazidx -> hazard_index, otherwise the prefix itself), so callers that predate this migration keep their rows.
create or replace function public.upsert_ml_scores(p_batch jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_count integer;
begin
  if p_batch is null or jsonb_typeof(p_batch)<>'array' or jsonb_array_length(p_batch)>1000 then
    raise exception 'Batch must be an array of at most 1000 scores' using errcode='22023';
  end if;
  insert into public.ml_scores(site_id,horizon,model,score,model_version,computed_at)
  select (e->>'site_id')::uuid,e->>'horizon',
    coalesce(nullif(e->>'model',''),case lower(split_part(e->>'model_version','-',1)) when 'stram' then 'mud'
      when 'hazidx' then 'hazard_index' else lower(split_part(e->>'model_version','-',1)) end),
    (e->>'score')::numeric,e->>'model_version',now()
  from jsonb_array_elements(p_batch) e
  on conflict(site_id,horizon,model) do update set score=excluded.score,model_version=excluded.model_version,computed_at=now();
  get diagnostics v_count=row_count;
  return jsonb_build_object('upserted',v_count);
end; $$;

-- Same as 20261017001200_scheduling.sql except the ML lines: the highest fresh model score wins, and the driver names it.
create or replace function public.compute_site_risk(p_site_id uuid,p_tomorrow_worst numeric default null,p_tomorrow_driver text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_crew numeric; v_worst numeric:=0; v_driver text; v_result jsonb:='[]'::jsonb;
  v_ml numeric; v_ml_model text; v_ml_label text; v_base numeric; v_h text; v_risk numeric; v_top text;
  v_fire numeric:=0; v_soil numeric:=0; v_carry numeric; v_fc numeric;
begin
  select crew_risk_term into v_crew from private.crew_metrics(p_site_id);
  select greatest(weather,lightning,flood,heat,wildfire,soil,wildlife),top_driver,wildfire,soil
  into v_worst,v_driver,v_fire,v_soil from public.site_subscores where site_id=p_site_id;
  v_worst:=coalesce(v_worst,0); v_fire:=coalesce(v_fire,0); v_soil:=coalesce(v_soil,0);
  v_carry:=greatest(v_fire,v_soil);
  v_fc:=greatest(coalesce(p_tomorrow_worst,0),v_carry);
  foreach v_h in array array['now','tomorrow'] loop
    v_ml:=null; v_ml_model:=null;
    select score,model into v_ml,v_ml_model from public.ml_scores
    where site_id=p_site_id and horizon=v_h
      and computed_at>now()-case v_h when 'now' then interval '36 hours' else interval '48 hours' end
    order by score desc,computed_at desc limit 1;
    v_ml_label:=case v_ml_model when 'mud' then 'ML mud trafficability ' when 'hazard_index' then 'ML hazard index '
      else 'ML '||v_ml_model||' ' end||v_ml;
    if v_h='now' then
      v_base:=greatest(coalesce(v_ml,0),v_worst);
      v_top:=case when coalesce(v_ml,0)>v_worst then v_ml_label else v_driver end;
    else
      v_base:=greatest(coalesce(v_ml,0),v_fc);
      v_top:=case when coalesce(v_ml,0)>v_fc then v_ml_label
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
