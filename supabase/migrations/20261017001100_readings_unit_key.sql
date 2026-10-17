-- A reading is identified by its unit as well: one hazard has several measurements (WBGT and heat index, rain totals).
alter table public.readings drop constraint readings_site_id_hazard_observed_at_forecast_for_source_key;
alter table public.readings add constraint readings_identity_key unique(site_id,hazard,unit,observed_at,forecast_for,source);

create or replace function public.ingest_readings(p_batch jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_inserted integer; v_total integer;
begin
  if p_batch is null or jsonb_typeof(p_batch)<>'array' or jsonb_array_length(p_batch)>10000 then
    raise exception 'Batch must be an array of at most 10000 readings' using errcode='22023';
  end if;
  with rows as (
    -- Last value wins when one batch repeats the same identity.
    select distinct on (site_id,hazard,unit,observed_at,forecast_for,source) *
    from (select (e->>'site_id')::uuid as site_id,(e->>'hazard')::public.hazard_kind as hazard,(e->>'value')::double precision as value,
        e->>'unit' as unit,(e->>'observed_at')::timestamptz as observed_at,
        coalesce((e->>'forecast_for')::timestamptz,'-infinity') as forecast_for,coalesce(e->>'source','live') as source,ord
      from jsonb_array_elements(p_batch) with ordinality as t(e,ord)) x
    order by site_id,hazard,unit,observed_at,forecast_for,source,ord desc),
  up as (
    insert into public.readings(site_id,hazard,value,unit,observed_at,forecast_for,source)
    select site_id,hazard,value,unit,observed_at,forecast_for,source from rows
    on conflict(site_id,hazard,unit,observed_at,forecast_for,source) do update set value=excluded.value
    returning (xmax=0) as inserted)
  select count(*) filter(where inserted),count(*) into v_inserted,v_total from up;
  return jsonb_build_object('inserted',v_inserted,'updated',v_total-v_inserted);
end; $$;
revoke all on function public.ingest_readings(jsonb) from public,anon,authenticated;
grant execute on function public.ingest_readings(jsonb) to service_role;
