-- Crew assignment: a supervisor lists, adds and removes crew at the sites they supervise.
--
-- site_memberships can only be read by its own user and clients cannot write to it,
-- so these functions are the only way to manage a roster from the app. Each one
-- checks the caller's role on that site, and only ever adds or removes `crew`:
-- no one can be promoted, demoted, or locked out through them.

create function public.list_site_crew(p_site_id uuid)
returns table(user_id uuid, email text, role text)
language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null or not private.is_site_supervisor(p_site_id) then
    raise exception 'Supervisor role required' using errcode='42501';
  end if;
  return query
    select m.user_id, u.email::text, m.role
    from public.site_memberships m
    join auth.users u on u.id = m.user_id
    where m.site_id = p_site_id
    order by (m.role = 'supervisor') desc, lower(u.email::text);
end; $$;

-- Adds an existing account to the site as crew. An existing member is left as they are
-- (this call never changes a role), so it is safe to repeat.
create function public.assign_site_member(p_site_id uuid, p_email text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_user uuid; v_email text; v_role text;
begin
  if auth.uid() is null or not private.is_site_supervisor(p_site_id) then
    raise exception 'Supervisor role required' using errcode='42501';
  end if;
  if p_email is null or btrim(p_email) = '' then
    raise exception 'Enter the email address of the person to add.' using errcode='22023';
  end if;
  select u.id, u.email::text into v_user, v_email
  from auth.users u where lower(u.email::text) = lower(btrim(p_email));
  if v_user is null then
    raise exception 'No account uses that email address.' using errcode='22023';
  end if;
  insert into public.site_memberships(site_id, user_id, role)
  values (p_site_id, v_user, 'crew')
  on conflict (site_id, user_id) do nothing
  returning role into v_role;
  if v_role is null then
    select m.role into v_role from public.site_memberships m
    where m.site_id = p_site_id and m.user_id = v_user;
    return jsonb_build_object('ok', true, 'outcome', 'already_member',
      'user_id', v_user, 'email', v_email, 'role', v_role);
  end if;
  return jsonb_build_object('ok', true, 'outcome', 'assigned',
    'user_id', v_user, 'email', v_email, 'role', v_role);
end; $$;

-- Removes a crew member from the site. Supervisors cannot be removed here.
-- Their past reports stay; their shared location for this site is deleted.
create function public.unassign_site_member(p_site_id uuid, p_user_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_role text;
begin
  if auth.uid() is null or not private.is_site_supervisor(p_site_id) then
    raise exception 'Supervisor role required' using errcode='42501';
  end if;
  select m.role into v_role from public.site_memberships m
  where m.site_id = p_site_id and m.user_id = p_user_id;
  if v_role is null then
    return jsonb_build_object('ok', true, 'removed', false);
  end if;
  if v_role <> 'crew' then
    raise exception 'Supervisors cannot be removed here.' using errcode='42501';
  end if;
  delete from public.site_memberships
  where site_id = p_site_id and user_id = p_user_id and role = 'crew';
  delete from public.crew_locations where site_id = p_site_id and user_id = p_user_id;
  return jsonb_build_object('ok', true, 'removed', true);
end; $$;

revoke all on function public.list_site_crew(uuid), public.assign_site_member(uuid, text),
  public.unassign_site_member(uuid, uuid) from public, anon, authenticated;
grant execute on function public.list_site_crew(uuid), public.assign_site_member(uuid, text),
  public.unassign_site_member(uuid, uuid) to authenticated;
