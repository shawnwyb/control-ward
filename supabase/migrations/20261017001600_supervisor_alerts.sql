-- Supervisor messages become alerts, so crew see them in the same place as automatic safety alerts.
-- Run after 20261017001400_push_and_briefing_review.sql (send_push, alert_to_outbox) and 001500.
-- The browser push still goes out as before; the alert is the part that is always shown in the app.

alter table public.alerts drop constraint alerts_kind_check;
alter table public.alerts add constraint alerts_kind_check
  check (kind in ('lightning','flood','heat','wildfire','other','supervisor'));

-- null = everyone on the site. Otherwise only these people (and the site's supervisors) can read the alert.
alter table public.alerts add column target_user_ids uuid[];

drop policy alerts_read on public.alerts;
create policy alerts_read on public.alerts for select to authenticated using (
  private.is_site_member(site_id)
  and (target_user_ids is null
    or (select auth.uid())=any(target_user_ids)
    or private.is_site_supervisor(site_id)));

-- A supervisor alert already has its own push from send_push, so the alert trigger must not queue a second one.
create or replace function private.alert_to_outbox() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_site text; v_msg text;
begin
  if new.kind='supervisor' then return new; end if;
  if new.status<>'active' or new.level='info' then return new; end if;
  if tg_op='UPDATE' and new.level is not distinct from old.level and old.status='active' then return new; end if;
  select name into v_site from public.sites where id=new.site_id;
  v_msg:=case new.kind
    when 'lightning' then 'Lightning nearby. Stop work and move to shelter.'
    when 'heat' then 'Heat stress is high. Follow rest and water breaks.'
    when 'flood' then 'Flood risk. Avoid low ground and washouts.'
    when 'wildfire' then 'Wildfire nearby. Check smoke and evacuation routes.'
    else 'Severe weather alert. Open the app for details.' end;
  insert into public.push_outbox(site_id,kind,title,body,dedup_key)
  values(new.site_id,'alert',
    case new.level when 'stop_work' then 'STOP WORK · ' else 'Warning · ' end||v_site,
    v_msg,'alert:'||new.id||':'||new.level)
  on conflict(dedup_key) do nothing;
  return new;
end; $$;

-- Same signature and result as before, plus the alert. Existing callers keep working.
create or replace function public.send_push(p_site_id uuid,p_title text,p_body text,p_target jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_alert uuid; v_users uuid[];
begin
  if not private.is_site_supervisor(p_site_id) then raise exception 'Supervisor role required' using errcode='42501'; end if;
  perform private.validate_target(p_target);
  insert into public.push_outbox(site_id,kind,title,body,target,created_by)
  values(p_site_id,'manual',btrim(p_title),btrim(p_body),p_target,auth.uid()) returning id into v_id;
  if coalesce(p_target->>'mode','all')<>'all' then
    select coalesce(array_agg(t.user_id),'{}') into v_users from private.target_members(p_site_id,p_target) t;
  end if;
  insert into public.alerts(site_id,kind,level,payload,dedup_key,target_user_ids)
  values(p_site_id,'supervisor','warning',
    jsonb_build_object('title',btrim(p_title),'body',btrim(p_body),'sent_by',auth.uid()),
    'supervisor:'||v_id,v_users)
  returning id into v_alert;
  return jsonb_build_object('ok',true,'id',v_id,'alert_id',v_alert);
end; $$;

-- Supervisor alerts have no automatic end, so a supervisor clears them once they no longer apply.
create function public.clear_supervisor_alert(p_alert_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_site uuid;
begin
  select site_id into v_site from public.alerts where id=p_alert_id and kind='supervisor';
  if v_site is null then raise exception 'Unknown alert' using errcode='22023'; end if;
  if not private.is_site_supervisor(v_site) then raise exception 'Supervisor role required' using errcode='42501'; end if;
  update public.alerts set status='cleared',cleared_at=now() where id=p_alert_id and status='active';
  return jsonb_build_object('ok',true);
end; $$;
revoke all on function public.clear_supervisor_alert(uuid) from public,anon;
grant execute on function public.clear_supervisor_alert(uuid) to authenticated;
