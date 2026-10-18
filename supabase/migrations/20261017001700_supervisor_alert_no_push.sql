-- A supervisor alert is shown in the app only. 20261017001600 also queued a browser push for it,
-- which duplicated the alert on phones and desktops. Automatic safety alerts, forecast warnings and
-- briefings still send pushes; only this one stops.
create or replace function public.send_push(p_site_id uuid,p_title text,p_body text,p_target jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_alert uuid; v_users uuid[];
begin
  if not private.is_site_supervisor(p_site_id) then raise exception 'Supervisor role required' using errcode='42501'; end if;
  perform private.validate_target(p_target);
  if coalesce(p_target->>'mode','all')<>'all' then
    select coalesce(array_agg(t.user_id),'{}') into v_users from private.target_members(p_site_id,p_target) t;
  end if;
  insert into public.alerts(site_id,kind,level,payload,dedup_key,target_user_ids)
  values(p_site_id,'supervisor','warning',
    jsonb_build_object('title',btrim(p_title),'body',btrim(p_body),'sent_by',auth.uid()),
    'supervisor:'||gen_random_uuid(),v_users)
  returning id into v_alert;
  return jsonb_build_object('ok',true,'id',v_alert,'alert_id',v_alert);
end; $$;
