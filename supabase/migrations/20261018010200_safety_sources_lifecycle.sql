-- Source staging is separate from generation. Text versions are immutable; review changes status only.
alter table public.safety_source_versions add column document_text text not null default '';
create function public.stage_safety_source(p_source jsonb,p_hash text,p_passages jsonb,p_document text) returns uuid
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
   update public.safety_source_versions set last_checked_at=now() where id=vid;
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
create function public.review_safety_source(p_version_id uuid,p_approve boolean,p_notes text,p_conflicts boolean default false) returns void
language plpgsql security definer set search_path='' as $$
declare v public.safety_source_versions; begin
 perform private.safety_lock();
 select * into strict v from public.safety_source_versions where id=p_version_id for update;
 if v.status<>'candidate' or length(coalesce(p_notes,'')) not between 10 and 4000 or p_approve is null then raise exception 'Candidate and substantive review notes required'; end if;
 if p_approve then update public.safety_source_versions set status='superseded' where source_id=v.source_id and status='approved'; end if;
 update public.safety_source_versions set status=case when p_approve then 'approved' else 'rejected' end,reviewed_at=now(),review_notes=p_notes,conflicts=p_conflicts where id=v.id;
 update public.safety_briefing_publications set needs_review=true where status='published' and (
   site_id=(select site_id from public.safety_sources where id=v.source_id) or (select site_id from public.safety_sources where id=v.source_id) is null);
end $$;
revoke all on function public.stage_safety_source(jsonb,text,jsonb,text),public.review_safety_source(uuid,boolean,text,boolean) from public,anon,authenticated;
grant execute on function public.stage_safety_source(jsonb,text,jsonb,text),public.review_safety_source(uuid,boolean,text,boolean) to service_role;

create or replace function private.safety_source_set(p_site uuid,p_date date) returns text language sql stable set search_path='' as $$
 select md5(coalesce(string_agg(v.id::text||':'||v.status||':'||(v.last_checked_at>now()-interval '30 days')::text,',' order by v.id),''))
 from public.safety_source_versions v join public.safety_sources s on s.id=v.source_id
 where v.status in ('approved','candidate') and (s.site_id is null or s.site_id=p_site)
   and (v.effective_on is null or v.effective_on<=p_date) and (v.superseded_on is null or v.superseded_on>p_date);
$$;

-- A source change pending review produces an explicit gap and cannot silently replace approved evidence.
create function private.safety_pending_source(p_site uuid) returns boolean language sql stable set search_path='' as $$
 select exists(select 1 from public.safety_source_versions v join public.safety_sources s on s.id=v.source_id
 where v.status='candidate' and (s.site_id is null or s.site_id=p_site));
$$;
-- Keep the original gap checks and add pending-source review.
alter function private.safety_gaps(jsonb) rename to safety_base_gaps;
create function private.safety_gaps(p jsonb) returns jsonb language sql stable set search_path='' as $$
 select private.safety_base_gaps(p)||case when private.safety_pending_source((p->>'site_id')::uuid)
 then jsonb_build_array('Source change pending review; confirm the current version before relying on legal or company instructions.') else '[]'::jsonb end;
$$;
-- Extra publication/edited-output gate for changing sources, including direct API calls.
alter function private.safety_validate(uuid,jsonb) rename to safety_base_validate;
create function private.safety_validate(p_run uuid,p_content jsonb) returns void language plpgsql security definer set search_path='' as $$
declare s uuid; begin
 perform private.safety_base_validate(p_run,p_content);
 select site_id into s from public.safety_briefing_runs where id=p_run;
 if private.safety_pending_source(s) and exists(select 1 from jsonb_array_elements((p_content->'worker_items')||(p_content->'supervisor_items')) i
   where i->>'type' in ('legal_requirement','company_policy')) then raise exception 'Source review pending'; end if;
end $$;

create function private.safety_hazard_changed() returns trigger language plpgsql security definer set search_path='' as $$
declare sid uuid; changed boolean:=true; begin
 sid:=case when tg_op='DELETE' then old.site_id else new.site_id end;
 if tg_op='UPDATE' then
   if tg_table_name='alerts' then changed:=(old.kind,old.level,old.status,old.payload) is distinct from (new.kind,new.level,new.status,new.payload);
   elsif tg_table_name='lightning_state' then changed:=old.status is distinct from new.status;
   else changed:=(old.type,old.severity,old.status) is distinct from (new.type,new.severity,new.status); end if;
 end if;
 if changed then
   perform private.safety_lock();
   insert into private.safety_site_state values(sid,1) on conflict(site_id) do update set hazard_revision=private.safety_site_state.hazard_revision+1;
   update public.safety_briefing_publications set needs_review=true where site_id=sid and status='published';
 end if;
 return null;
end $$;
create trigger safety_alert_change after insert or update or delete on public.alerts for each row execute function private.safety_hazard_changed();
create trigger safety_lightning_change after insert or update or delete on public.lightning_state for each row execute function private.safety_hazard_changed();
create trigger safety_crew_change after insert or update or delete on public.hazard_reports for each row execute function private.safety_hazard_changed();

create function public.enqueue_due_safety_briefings(p_now timestamptz default now()) returns integer
language plpgsql security definer set search_path='' as $$
declare j record; n int:=0; begin
 if not (select enabled from private.safety_settings) then return 0; end if;
 for j in select p.site_id,p.work_date from public.job_plans p join public.sites s on s.id=p.site_id join public.site_safety_profiles sp on sp.site_id=s.id
   where coalesce((sp.profile->>'enabled')::boolean,false) and p.work_date=(p_now at time zone s.timezone)::date+1
     and extract(hour from p_now at time zone s.timezone)=18 loop
   perform private.safety_enqueue(j.site_id,j.work_date); n:=n+1;
 end loop;
 return n;
end $$;
create function public.refresh_stale_safety_briefings() returns integer
language plpgsql security definer set search_path='' as $$
declare j record; n int:=0; begin
 if not (select enabled from private.safety_settings) then return 0; end if;
 perform private.safety_lock();
 for j in select p.id,p.site_id,p.work_date,r.input_snapshot from public.safety_briefing_publications p
   join public.safety_briefing_revisions v on v.id=p.revision_id join public.safety_briefing_runs r on r.id=v.run_id
   where p.status='published' and p.valid_until>now() loop
   if private.safety_input_key(j.input_snapshot)<>private.safety_input_key(private.safety_snapshot(j.site_id,j.work_date)) then
     update public.safety_briefing_publications set needs_review=true where id=j.id;
     if exists(select 1 from public.site_safety_profiles sp where sp.site_id=j.site_id and (sp.profile->>'enabled')::boolean)
       and not exists(select 1 from public.safety_briefing_runs r where r.site_id=j.site_id and r.work_date=j.work_date and (r.state in ('queued','running') or r.created_at>now()-interval '1 minute')) then
       perform private.safety_enqueue(j.site_id,j.work_date); n:=n+1;
     end if;
   end if;
 end loop;
 return n;
end $$;
select cron.schedule('safety-enqueue-evening','0 * * * *','select public.enqueue_due_safety_briefings()');
select cron.schedule('safety-refresh-inputs','* * * * *','select public.refresh_stale_safety_briefings()');
select cron.schedule('safety-generate-worker','* * * * *',$cron$
 select private.invoke_function('generate-safety-briefings') where (select enabled from private.safety_settings);
$cron$);
select cron.schedule('safety-refresh-sources','0 7 * * 1',$cron$
 select private.invoke_function('refresh-safety-sources') where (select enabled from private.safety_settings);
$cron$);
do $$ declare f record; begin
 for f in select p.oid::regprocedure sig,p.pronamespace::regnamespace ns from pg_proc p where
   (p.pronamespace='private'::regnamespace and p.proname like 'safety_%')
   or (p.pronamespace='public'::regnamespace and p.proname in ('enqueue_due_safety_briefings','refresh_stale_safety_briefings')) loop
   execute format('revoke all on function %s from public,anon,authenticated',f.sig);
   if f.ns::text='public' then execute format('grant execute on function %s to service_role',f.sig); end if;
 end loop;
end $$;
