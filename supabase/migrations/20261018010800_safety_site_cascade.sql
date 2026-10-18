-- A site's cascading child deletions must not recreate state for the deleted site.
create or replace function private.safety_hazard_changed() returns trigger
language plpgsql security definer set search_path='' as $$
declare sid uuid; changed boolean:=true; begin
 sid:=case when tg_op='DELETE' then old.site_id else new.site_id end;
 if tg_op='DELETE' and not exists(select 1 from public.sites where id=sid) then
   return null;
 end if;
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
