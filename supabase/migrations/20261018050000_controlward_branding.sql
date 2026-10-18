-- Update generated evidence labels for the ControlWard name. Existing evidence history is unchanged.
create or replace function private.safety_hazard_evidence(p jsonb) returns jsonb language plpgsql stable set search_path='' as $$
declare result jsonb:='[]'::jsonb; h jsonb; e jsonb; basis text; begin
 for h in select value from jsonb_array_elements(p->'hazards'->'alerts') loop
   e:=jsonb_build_object('id','alert:'||(h->>'id'),'record_id',h->>'id','kind','observed_hazard','audience','crew',
    'instruction','Current alert: '||(h->>'kind')||' / '||(h->>'level')||'. Follow the live site alert and supervisor directions.',
    'conditions','Current alert at snapshot time; check live alerts before work.','observed_at',h->>'created_at','excerpt',h::text,'url',null,'title','ControlWard alert','conflicts',false);
   result:=result||jsonb_build_array(e);
 end loop;
 for h in select value from jsonb_array_elements(p->'hazards'->'readings') loop
   basis:=case when h->>'forecast_for'='-infinity' then 'Observation' else 'Forecast' end;
   e:=jsonb_build_object('id','reading:'||(h->>'id'),'record_id',h->>'id','kind','observed_hazard','audience','crew',
    'instruction',basis||': '||(h->>'hazard')||' '||(h->>'value')||' '||(h->>'unit')||', recorded '||(h->>'observed_at')||
      case when basis='Forecast' then ', valid for '||(h->>'forecast_for') else '' end||'. Verify current conditions before work.',
    'conditions','Snapshot evidence only. Forecasts are predictions. Estimated WBGT and GLM limitations remain; these values are not legal thresholds.',
    'observed_at',h->>'observed_at','forecast_for',h->>'forecast_for','unit',h->>'unit','value',h->'value','time_basis',basis,
    'excerpt',h::text,'url',null,'title','ControlWard '||basis,'conflicts',false);
   result:=result||jsonb_build_array(e);
 end loop;
 for h in select value from jsonb_array_elements(p->'hazards'->'crew') loop
   e:=jsonb_build_object('id','crew:'||(h->>'id'),'record_id',h->>'id','kind','observed_hazard','audience','crew',
    'instruction','Crew-reported hazard: '||(h->>'type')||', severity '||(h->>'severity')||', last confirmed '||(h->>'last_confirmed_at')||'. Check the live hazard feed and supervisor directions.',
    'conditions','Crew observation at snapshot time; may change or expire.','observed_at',h->>'last_confirmed_at',
    'excerpt',jsonb_build_object('id',h->'id','type',h->'type','severity',h->'severity','last_confirmed_at',h->'last_confirmed_at')::text,
    'url',null,'title','ControlWard crew report','conflicts',false);
   result:=result||jsonb_build_array(e);
 end loop;
 return result;
end $$;
