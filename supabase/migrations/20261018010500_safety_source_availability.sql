-- Failed refreshes become explicit gaps immediately; no silent "no requirements" result.
alter table public.safety_source_versions add column available boolean not null default true;
create function public.mark_safety_source_unavailable(p_source_key text) returns void
language plpgsql security definer set search_path='' as $$
declare sid uuid; owner_site uuid; begin
 perform private.safety_lock();
 select id,site_id into sid,owner_site from public.safety_sources where source_key=p_source_key;
 if sid is null then return; end if;
 update public.safety_source_versions set available=false where source_id=sid and status='approved';
 update public.safety_briefing_publications set needs_review=true where status='published' and (owner_site is null or site_id=owner_site);
end $$;
revoke all on function public.mark_safety_source_unavailable(text) from public,anon,authenticated;
grant execute on function public.mark_safety_source_unavailable(text) to service_role;
create or replace function private.safety_source_set(p_site uuid,p_date date) returns text language sql stable set search_path='' as $$
 select md5(coalesce(string_agg(v.id::text||':'||v.status||':'||v.available::text||':'||(v.last_checked_at>now()-interval '30 days')::text,',' order by v.id),''))
 from public.safety_source_versions v join public.safety_sources s on s.id=v.source_id
 where v.status in ('approved','candidate') and (s.site_id is null or s.site_id=p_site)
   and (v.effective_on is null or v.effective_on<=p_date) and (v.superseded_on is null or v.superseded_on>p_date);
$$;
create or replace function public.stage_safety_source(p_source jsonb,p_hash text,p_passages jsonb,p_document text) returns uuid
language plpgsql security definer set search_path='' as $$
declare sid uuid; vid uuid; p jsonb; begin
 perform private.safety_lock();
 if p_source is null or p_hash !~ '^[0-9a-f]{64}$' or length(p_document)>1500000
   or jsonb_typeof(p_passages) is distinct from 'array' or jsonb_array_length(p_passages) not between 1 and 20
   or p_source->>'category' not in ('official','company_policy') then raise exception 'Invalid source'; end if;
 if p_source->>'category'='official' and p_source->>'url' not in (
   'https://www.osha.gov/stateplans','https://www.osha.gov/laws-regs/regulations/standardnumber/1910/1910.269',
   'https://www.osha.gov/laws-regs/regulations/standardnumber/1926/1926.950') then raise exception 'URL not allowlisted'; end if;
 if coalesce((p_source->>'fictional')::boolean,false) and exists(select 1 from public.sites where id=(p_source->>'site_id')::uuid and eia_plant_id is not null) then raise exception 'Fictional procedure forbidden at real site'; end if;
 insert into public.safety_sources(source_key,site_id,category,title,issuing_body,canonical_url,audience)
 values(p_source->>'key',(p_source->>'site_id')::uuid,p_source->>'category',p_source->>'title',p_source->>'issuing_body',p_source->>'url',p_source->>'audience')
 on conflict(source_key) do nothing returning id into sid;
 if sid is null then
   select id into sid from public.safety_sources where source_key=p_source->>'key' and site_id is not distinct from (p_source->>'site_id')::uuid
     and category=p_source->>'category' and canonical_url is not distinct from p_source->>'url' and audience=p_source->>'audience';
   if sid is null then raise exception 'Source identity/audience changed; use a new key'; end if;
 end if;
 select id into vid from public.safety_source_versions where source_id=sid and content_hash=p_hash;
 if vid is not null then
   update public.safety_source_versions set last_checked_at=now(),available=true where id=vid;
   return vid;
 end if;
 insert into public.safety_source_versions(source_id,content_hash,jurisdiction,task_tags,effective_on,superseded_on,fictional,document_text)
 values(sid,p_hash,p_source->>'jurisdiction',array(select jsonb_array_elements_text(p_source->'task_tags')),
   (p_source->>'effective_on')::date,(p_source->>'superseded_on')::date,coalesce((p_source->>'fictional')::boolean,false),p_document) returning id into vid;
 for p in select value from jsonb_array_elements(p_passages) loop
   if p->>'excerpt' is null or strpos(p_document,p->>'excerpt')=0 then raise exception 'Passage must match fetched document'; end if;
   insert into public.safety_passages(version_id,anchor,excerpt,instruction,conditions)
   values(vid,p->>'anchor',p->>'excerpt',p->>'instruction',p->>'conditions');
 end loop;
 update public.safety_briefing_publications set needs_review=true where status='published' and ((p_source->>'site_id') is null or site_id=(p_source->>'site_id')::uuid);
 return vid;
end $$;
create or replace function public.retrieve_safety_evidence(p_run_id uuid,p_lease_token uuid,p_tool text,p_query text default '',p_passage_id uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.safety_briefing_runs; result jsonb; e jsonb; begin
 select * into r from public.safety_briefing_runs where id=p_run_id and state='running' and lease_token=p_lease_token and leased_until>now() for update;
 if not found then raise exception 'Lease lost'; end if;
 if p_tool not in ('search_regulations','search_site_documents','read_source_passage') or length(p_query)>500 then raise exception 'Invalid tool'; end if;
 select coalesce(jsonb_agg(x.e),'[]'::jsonb) into result from (
   select jsonb_build_object('id',p.id::text,'passage_id',p.id,'version_id',v.id,'source_id',s.id,
     'kind',case when s.category='official' then 'legal_requirement' else 'company_policy' end,
     'title',s.title,'authority',s.issuing_body,'url',s.canonical_url,'anchor',p.anchor,'excerpt',p.excerpt,
     'instruction',p.instruction,'conditions',p.conditions,'audience',s.audience,'effective_on',v.effective_on,
     'superseded_on',v.superseded_on,'last_checked_at',v.last_checked_at,'fictional',v.fictional,'conflicts',v.conflicts) e
   from public.safety_passages p join public.safety_source_versions v on v.id=p.version_id join public.safety_sources s on s.id=v.source_id
   where v.status='approved' and (s.site_id is null or s.site_id=r.site_id)
     and v.jurisdiction=coalesce(r.input_snapshot->'profile'->>'state','unknown')
     and (r.input_snapshot->'job'->>'task')=any(v.task_tags)
     and (v.effective_on is null or v.effective_on<=r.work_date) and (v.superseded_on is null or v.superseded_on>r.work_date)
     and v.available and v.last_checked_at>now()-interval '30 days'
     and (not v.fictional or exists(select 1 from public.sites ss where ss.id=r.site_id and ss.eia_plant_id is null))
     and (s.category<>'official' or private.safety_supported(r.input_snapshot))
     and ((p_tool='search_regulations' and s.category='official') or (p_tool='search_site_documents' and s.site_id=r.site_id)
       or (p_tool='read_source_passage' and p.id=p_passage_id and exists(select 1 from public.safety_run_evidence re where re.run_id=r.id and re.evidence_id=p.id::text)))
   order by ts_rank_cd(p.search_vector,plainto_tsquery('english',coalesce(p_query,''))) desc,p.id limit 8) x;
 for e in select value from jsonb_array_elements(result) loop
   insert into public.safety_run_evidence values(r.id,e->>'id',e) on conflict do nothing;
 end loop;
 return result;
end $$;

create or replace function private.safety_base_gaps(p jsonb) returns jsonb language plpgsql stable set search_path='' as $$
declare g jsonb := '[]'::jsonb; begin
 if not private.safety_supported(p) then g:=g||jsonb_build_array('Coverage unresolved: confirm FL, private employer, operations/maintenance and electrical_maintenance task. Construction and other scope are unsupported.'); end if;
 if coalesce(p->'job'->>'energized','unknown')='unknown' then g:=g||jsonb_build_array('Confirm energized status and applicable energy controls with the employee in charge.'); end if;
 if not exists(select 1 from public.safety_source_versions v join public.safety_sources s on s.id=v.source_id
   where s.site_id=(p->>'site_id')::uuid and v.status='approved' and 'electrical_maintenance'=any(v.task_tags)
   and v.jurisdiction='FL' and (v.effective_on is null or v.effective_on<=(p->>'work_date')::date)
   and (v.superseded_on is null or v.superseded_on>(p->>'work_date')::date) and v.available and v.last_checked_at>now()-interval '30 days') then
   g:=g||jsonb_build_array('Missing current approved site procedure; obtain and review the applicable employer procedure.'); end if;
 if not exists(select 1 from public.safety_source_versions v join public.safety_sources s on s.id=v.source_id where s.category='official'
   and v.status='approved' and v.jurisdiction='FL' and 'electrical_maintenance'=any(v.task_tags) and v.available and v.last_checked_at>now()-interval '30 days'
   and (v.effective_on is null or v.effective_on<=(p->>'work_date')::date) and (v.superseded_on is null or v.superseded_on>(p->>'work_date')::date)) then
   g:=g||jsonb_build_array('Official evidence unavailable or overdue for review; this is not evidence of no requirements.'); end if;
 if not exists(select 1 from jsonb_array_elements(p->'hazards'->'readings') r where (r->>'observed_at')::timestamptz>now()-interval '2 hours') then
   g:=g||jsonb_build_array('Hazard feed missing or stale; verify current conditions and forecasts before work.'); end if;
 if exists(select 1 from public.safety_source_versions v join public.safety_sources s on s.id=v.source_id where v.status='approved'
   and v.conflicts and (s.site_id is null or s.site_id=(p->>'site_id')::uuid)) then
   g:=g||jsonb_build_array('Conflicting sources require supervisor resolution; do not choose a rule automatically.'); end if;
 return g||jsonb_build_array('Limited pilot corpus: supervisor must assess other applicable requirements and task-specific controls. Estimated weather and GLM lightning do not establish legal compliance.');
end $$;
