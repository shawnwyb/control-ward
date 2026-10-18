-- Tighten automatic publication independently of the provider's output checks.
create function private.automatic_safety_text(v jsonb, lo integer, hi integer) returns boolean
language sql immutable set search_path='' as $$
 select coalesce(jsonb_typeof(v)='string' and length(v#>>'{}') between lo and hi,false);
$$;
create function private.validate_automatic_safety_payload(c jsonb, docs jsonb, diag jsonb) returns void
language plpgsql set search_path='' as $$
declare j jsonb; s jsonb; d jsonb; i jsonb; q jsonb; v jsonb; k text; expected text; begin
 if jsonb_typeof(diag) is distinct from 'object' or length(diag::text)>4000 then raise exception 'Invalid diagnostics'; end if;
 for k,v in select * from jsonb_each(diag) loop
  if k in ('turns','tokens','reserved_spend_usd','duration_ms','failed_sources') then
   if jsonb_typeof(v) is distinct from 'number' or (v#>>'{}')::numeric<0 then raise exception 'Invalid diagnostics'; end if;
  elsif k='usage_complete' then
   if jsonb_typeof(v) is distinct from 'boolean' then raise exception 'Invalid diagnostics'; end if;
  elsif k='model' then
   if not private.automatic_safety_text(v,1,100) then raise exception 'Invalid diagnostics'; end if;
  elsif k='verified_sources' then
   if jsonb_typeof(v) is distinct from 'array' or jsonb_array_length(v)>8 then raise exception 'Invalid diagnostics'; end if;
   if exists(select 1 from jsonb_array_elements(v) x where not private.automatic_safety_text(x,1,40)) then raise exception 'Invalid diagnostics'; end if;
  else raise exception 'Unknown diagnostics field'; end if;
 end loop;
 if c is null then return; end if;
 if jsonb_typeof(c) is distinct from 'object' or not c ?& array['summary','jurisdiction','conditions','alerts','items','sources','coverage_gaps']
  or c-array['summary','jurisdiction','conditions','alerts','items','sources','coverage_gaps','search_entry_point']<>'{}'::jsonb
  or not private.automatic_safety_text(c->'summary',1,1000)
  or (c ? 'search_entry_point' and not private.automatic_safety_text(c->'search_entry_point',1,20000))
  or jsonb_typeof(c->'items') is distinct from 'array' or jsonb_array_length(c->'items')>20
  or jsonb_typeof(c->'sources') is distinct from 'array' or jsonb_array_length(c->'sources')>8
  or jsonb_typeof(c->'coverage_gaps') is distinct from 'array' or jsonb_array_length(c->'coverage_gaps')>30
  or jsonb_typeof(docs) is distinct from 'array' or jsonb_array_length(docs)<>jsonb_array_length(c->'sources')
 then raise exception 'Invalid automatic checklist shape'; end if;
 if exists(select 1 from jsonb_array_elements(c->'coverage_gaps') x where not private.automatic_safety_text(x,1,2000)) then raise exception 'Invalid coverage gap'; end if;
 j:=c->'jurisdiction';
 if jsonb_typeof(j) is distinct from 'object' or not j ?& array['state','state_code','county','city','source_url','resolved']
  or j-array['state','state_code','county','city','source_url','resolved']<>'{}'::jsonb
  or jsonb_typeof(j->'resolved') is distinct from 'boolean'
  or not coalesce(j->>'source_url' ~ '^https://geocoding\.geo\.census\.gov/',false)
 then raise exception 'Invalid site jurisdiction'; end if;
 foreach k in array array['state','state_code','county','city'] loop
  if j->k <> 'null'::jsonb and not private.automatic_safety_text(j->k,1,120) then raise exception 'Invalid site jurisdiction'; end if;
 end loop;
 if (select count(distinct x->>'id') from jsonb_array_elements(c->'sources') x)<>jsonb_array_length(c->'sources')
  or (select count(distinct x->>'id') from jsonb_array_elements(docs) x)<>jsonb_array_length(docs)
 then raise exception 'Duplicate source identity'; end if;
 for s in select value from jsonb_array_elements(c->'sources') loop
  if jsonb_typeof(s) is distinct from 'object' or not s ?& array['id','title','url','level','jurisdiction','checked_at']
   or s-array['id','title','url','level','jurisdiction','checked_at']<>'{}'::jsonb
   or not private.automatic_safety_text(s->'id',1,40) or not private.automatic_safety_text(s->'title',1,160)
   or not coalesce(private.automatic_safety_official_url(s->>'url'),false)
   or not private.automatic_safety_text(s->'checked_at',1,40)
  then raise exception 'Official source metadata required'; end if;
  expected:=case s->>'level' when 'federal' then 'United States' when 'state' then j->>'state' when 'county' then j->>'county' when 'city' then j->>'city' end;
  if expected is null or s->>'jurisdiction' is distinct from expected
   or (j->>'resolved'='false' and s->>'level'<>'federal') then raise exception 'Source jurisdiction mismatch'; end if;
  select value into d from jsonb_array_elements(docs) where value->>'id'=s->>'id';
  if d is null or d-'text' is distinct from s or not private.automatic_safety_text(d->'text',20,55000) then raise exception 'Source document missing'; end if;
 end loop;
 if (select count(distinct x->>'id') from jsonb_array_elements(c->'items') x)<>jsonb_array_length(c->'items') then raise exception 'Duplicate item identity'; end if;
 for i in select value from jsonb_array_elements(c->'items') loop
  if jsonb_typeof(i) is distinct from 'object' or not i ?& array['id','kind','title','text','conditions','citations']
   or i-array['id','kind','title','text','conditions','citations']<>'{}'::jsonb
   or not private.automatic_safety_text(i->'id',1,40) or not private.automatic_safety_text(i->'title',1,120)
   or not private.automatic_safety_text(i->'text',20,2000) or not private.automatic_safety_text(i->'conditions',1,1500)
   or not coalesce(i->>'kind' in ('regulation','guidance'),false)
   or jsonb_typeof(i->'citations') is distinct from 'array' or jsonb_array_length(i->'citations') not between 1 and 4
  then raise exception 'Invalid automatic item'; end if;
  for q in select value from jsonb_array_elements(i->'citations') loop
   if jsonb_typeof(q) is distinct from 'object' or not q ?& array['source_id','quote'] or q-array['source_id','quote']<>'{}'::jsonb
    or not private.automatic_safety_text(q->'source_id',1,40) or not private.automatic_safety_text(q->'quote',20,2000)
   then raise exception 'Invalid citation'; end if;
   select value into d from jsonb_array_elements(docs) where value->>'id'=q->>'source_id';
   if d is null or coalesce(strpos(d->>'text',q->>'quote'),0)=0 or strpos(q->>'quote','[... omitted ...]')>0 then raise exception 'Citation does not match official document'; end if;
  end loop;
 end loop;
end $$;
revoke all on function private.automatic_safety_text(jsonb,integer,integer),private.validate_automatic_safety_payload(jsonb,jsonb,jsonb) from public,anon,authenticated;

create or replace function public.finish_automatic_safety_run(p_run_id uuid,p_lease_token uuid,p_content jsonb default null,p_documents jsonb default '[]'::jsonb,p_error text default null,p_diagnostics jsonb default '{}'::jsonb) returns boolean
language plpgsql security definer set search_path='' as $$
declare r public.automatic_safety_runs; item jsonb; citation jsonb; src jsonb; doc jsonb; tz text; current_key text; begin
 perform private.safety_lock();
 select * into r from public.automatic_safety_runs where id=p_run_id and state='running' and lease_token=p_lease_token and leased_until>now() for update;
 if r.id is null then return false; end if;
 perform private.validate_automatic_safety_payload(case when p_error is null then p_content else null end,p_documents,p_diagnostics);
 if p_error is not null then
  update public.automatic_safety_runs set state=case when attempt<3 then 'queued' else 'failed' end,
    available_at=now()+make_interval(secs=>30*attempt),error_category=left(p_error,80),diagnostics=p_diagnostics,
    lease_token=null,leased_until=null,finished_at=case when attempt>=3 then now() end where id=r.id;
  return true;
 end if;
 if not (select enabled and model<>'unconfigured' from private.safety_settings) then
  update public.automatic_safety_runs set state='failed',error_category='disabled',finished_at=now(),lease_token=null,leased_until=null where id=r.id;
  return false;
 end if;
 if jsonb_typeof(p_content) is distinct from 'object' or length(p_content::text)>120000
   or jsonb_typeof(p_content->'items') is distinct from 'array' or jsonb_array_length(p_content->'items')>20
   or jsonb_typeof(p_content->'sources') is distinct from 'array' or jsonb_array_length(p_content->'sources')>8
   or jsonb_typeof(p_content->'coverage_gaps') is distinct from 'array'
   or not (p_content->'coverage_gaps' ? 'Employer coverage and task-specific applicability cannot be inferred from a site''s location. Regulatory excerpts retain their scope; this checklist is not a determination of complete legal coverage.')
   or p_content->'conditions' is distinct from r.input_snapshot#>'{hazards,readings}'
   or p_content->'alerts' is distinct from r.input_snapshot#>'{hazards,alerts}'
   or jsonb_typeof(p_documents) is distinct from 'array' or length(p_documents::text)>500000 then raise exception 'Invalid automatic checklist'; end if;
 for src in select value from jsonb_array_elements(p_content->'sources') loop
  if not coalesce(private.automatic_safety_official_url(src->>'url'),false) then raise exception 'Official source URL required'; end if;
  select value into doc from jsonb_array_elements(p_documents) where value->>'id'=src->>'id' and value->>'url'=src->>'url';
  if doc is null then raise exception 'Source document missing'; end if;
 end loop;
 for item in select value from jsonb_array_elements(p_content->'items') loop
  if item->>'kind' not in ('regulation','guidance') or length(coalesce(item->>'text','')) not between 1 and 2000
   or jsonb_typeof(item->'citations') is distinct from 'array' or jsonb_array_length(item->'citations') not between 1 and 4 then raise exception 'Invalid automatic item'; end if;
  for citation in select value from jsonb_array_elements(item->'citations') loop
   select value into src from jsonb_array_elements(p_content->'sources') where value->>'id'=citation->>'source_id';
   select value into doc from jsonb_array_elements(p_documents) where value->>'id'=citation->>'source_id';
   if src is null or doc is null or length(coalesce(citation->>'quote',''))<20
     or strpos(doc->>'text',citation->>'quote')=0 then raise exception 'Citation does not match official document'; end if;
  end loop;
  if item->>'text' is distinct from item#>>'{citations,0,quote}' then raise exception 'Instruction must retain the quoted source wording'; end if;
 end loop;
 current_key:=private.automatic_safety_key(private.automatic_safety_snapshot(r.site_id,r.work_date));
 if current_key<>r.input_snapshot->>'input_key' then
  update public.automatic_safety_runs set state='failed',error_category='inputs_changed',finished_at=now(),lease_token=null,leased_until=null where id=r.id;
  return false;
 end if;
 select timezone into tz from public.sites where id=r.site_id;
 update public.automatic_safety_checklists set superseded_at=now() where site_id=r.site_id and work_date=r.work_date and superseded_at is null;
 insert into public.automatic_safety_checklists(run_id,site_id,work_date,input_key,content,valid_until)
 values(r.id,r.site_id,r.work_date,current_key,p_content,(r.work_date+1)::timestamp at time zone tz);
 update public.automatic_safety_runs set state='succeeded',finished_at=now(),diagnostics=p_diagnostics,source_documents=p_documents,
  lease_token=null,leased_until=null,error_category=null where id=r.id;
 return true;
end $$;
