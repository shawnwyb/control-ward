-- Only these authenticated entry points mutate reports. Table writes remain revoked.
create function private.require_member(p_site_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null or not private.is_site_member(p_site_id) then
    raise exception 'Site membership required' using errcode='42501';
  end if;
end; $$;

create function private.replay_request(p_request_id uuid,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_request private.hazard_requests;
begin
  if p_request_id is null then raise exception 'Request ID required' using errcode='22023'; end if;
  -- Request lock precedes site lock everywhere. Hash collisions only cause extra serialization.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(auth.uid()::text||p_request_id::text,0));
  select * into v_request from private.hazard_requests where user_id=auth.uid() and request_id=p_request_id;
  if found then
    if v_request.payload<>p_payload then raise exception 'Request ID already used with different input' using errcode='22023'; end if;
    return v_request.response;
  end if;
  return null;
end; $$;

create function private.lock_hazard_site(p_site_id uuid) returns void
language sql volatile set search_path='' as $$
  -- Site-wide serialization also coordinates check-ins and expiration. Deliberately simple for this workload.
  select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('hazard-site:'||p_site_id::text,0));
$$;

create function private.report_result(p_report_id uuid,p_outcome text) returns jsonb
language sql stable set search_path='' as $$
  select jsonb_build_object('outcome',p_outcome,'report',to_jsonb(f)) from public.crew_hazard_feed f where id=p_report_id;
$$;

create function private.record_observation(p_report public.hazard_reports,p_request_id uuid,p_action public.hazard_action,
  p_location extensions.geography,p_severity smallint) returns uuid
language plpgsql set search_path='' as $$
declare v_id uuid;
begin
  insert into public.hazard_observations(report_id,actor_id,request_id,action,location,severity)
  values(p_report.id,auth.uid(),p_request_id,p_action,p_location,p_severity) returning id into v_id;
  insert into public.hazard_events(report_id,observation_id,action) values(p_report.id,v_id,p_action);
  update public.hazard_checkin_tasks set completed_at=now() where report_id=p_report.id and completed_at is null;
  return v_id;
end; $$;

create function public.reserve_hazard_photo(p_photo_id uuid,p_site_id uuid,p_content_type text)
returns public.hazard_photos language plpgsql security definer set search_path='' as $$
declare v_photo public.hazard_photos;
begin
  perform private.require_member(p_site_id);
  if p_photo_id is null or p_content_type is null or p_content_type not in ('image/jpeg','image/png','image/webp') then
    raise exception 'A photo ID and JPEG, PNG or WebP content type are required' using errcode='22023';
  end if;
  insert into public.hazard_photos(id,site_id,owner_id,object_path,content_type)
  values(p_photo_id,p_site_id,auth.uid(),p_site_id::text||'/'||auth.uid()::text||'/'||p_photo_id::text,p_content_type)
  on conflict(id) do nothing;
  select * into v_photo from public.hazard_photos where id=p_photo_id;
  if v_photo.owner_id<>auth.uid() or v_photo.site_id<>p_site_id or v_photo.content_type<>p_content_type then
    raise exception 'Photo reservation conflict' using errcode='42501';
  end if;
  if v_photo.observation_id is not null or v_photo.created_at<=now()-interval '1 hour' then
    raise exception 'Photo reservation is attached or expired' using errcode='22023';
  end if;
  return v_photo;
end; $$;

create function public.submit_hazard_report(p_request_id uuid,p_site_id uuid,p_type public.hazard_type,
  p_severity integer,p_lat double precision,p_lon double precision,p_photo_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_payload jsonb; v_response jsonb; v_point extensions.geography(Point,4326);
  v_report public.hazard_reports; v_photo public.hazard_photos; v_observation uuid; v_outcome text;
begin
  perform private.require_member(p_site_id);
  if p_type is null or p_severity is null or p_severity not between 1 and 3
    or p_lat is null or not(p_lat between -90 and 90) or p_lon is null or not(p_lon between -180 and 180) then
    raise exception 'Valid type, severity 1–3, latitude and longitude required' using errcode='22023';
  end if;
  v_payload:=jsonb_build_object('action','submit','site_id',p_site_id,'type',p_type,'severity',p_severity,
    'lat',p_lat,'lon',p_lon,'photo_id',p_photo_id);
  v_response:=private.replay_request(p_request_id,v_payload);
  if v_response is not null then return v_response; end if;
  perform private.lock_hazard_site(p_site_id);
  v_point:=extensions.st_setsrid(extensions.st_makepoint(p_lon,p_lat),4326)::extensions.geography;
  if p_photo_id is not null then
    select * into v_photo from public.hazard_photos where id=p_photo_id for update;
    if not found or v_photo.site_id<>p_site_id or v_photo.owner_id<>auth.uid() or v_photo.observation_id is not null
      or v_photo.created_at<=now()-interval '1 hour' then
      raise exception 'Valid, unused photo reservation required' using errcode='22023';
    end if;
    if not exists(select 1 from storage.objects where bucket_id='hazard-photos' and name=v_photo.object_path
      and metadata->>'mimetype'=v_photo.content_type) then
      raise exception 'Upload the reserved photo before submitting' using errcode='22023';
    end if;
  end if;
  select * into v_report from public.hazard_reports
    where site_id=p_site_id and type=p_type and status='open' and last_confirmed_at>now()-interval '24 hours'
      and extensions.st_dwithin(location,v_point,100)
    order by extensions.st_distance(location,v_point),created_at,id limit 1 for update;
  if found then
    update public.hazard_reports set confirmations=confirmations+1,severity=greatest(severity,p_severity),last_confirmed_at=now()
      where id=v_report.id returning * into v_report;
    v_outcome:='merged';
  else
    insert into public.hazard_reports(site_id,reporter_id,type,severity,location)
      values(p_site_id,auth.uid(),p_type,p_severity,v_point) returning * into v_report;
    v_outcome:='created';
  end if;
  v_observation:=private.record_observation(v_report,p_request_id,'submitted',v_point,p_severity::smallint);
  if p_photo_id is not null then update public.hazard_photos set observation_id=v_observation where id=p_photo_id; end if;
  v_response:=private.report_result(v_report.id,v_outcome);
  insert into private.hazard_requests(user_id,request_id,payload,response) values(auth.uid(),p_request_id,v_payload,v_response);
  return v_response;
end; $$;

create function public.checkin_hazard_report(p_request_id uuid,p_report_id uuid,p_still_there boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_report public.hazard_reports; v_payload jsonb; v_response jsonb; v_outcome text;
begin
  select * into v_report from public.hazard_reports where id=p_report_id;
  perform private.require_member(v_report.site_id);
  if p_still_there is null then raise exception 'Check-in response required' using errcode='22023'; end if;
  v_payload:=jsonb_build_object('action','checkin','report_id',p_report_id,'still_there',p_still_there);
  v_response:=private.replay_request(p_request_id,v_payload);
  if v_response is not null then return v_response; end if;
  perform private.lock_hazard_site(v_report.site_id);
  select * into v_report from public.hazard_reports where id=p_report_id for update;
  if v_report.status<>'open' or v_report.last_confirmed_at<=now()-interval '48 hours' then
    raise exception 'Hazard is resolved or expired; submit a new report' using errcode='22023';
  end if;
  if p_still_there then
    update public.hazard_reports set confirmations=confirmations+1,last_confirmed_at=now()
      where id=p_report_id returning * into v_report;
    v_outcome:='confirmed';
  else
    update public.hazard_reports set status='resolved',resolved_at=now(),resolution_reason='crew'
      where id=p_report_id returning * into v_report;
    v_outcome:='resolved';
  end if;
  perform private.record_observation(v_report,p_request_id,v_outcome::public.hazard_action,v_report.location,v_report.severity);
  v_response:=private.report_result(v_report.id,v_outcome);
  insert into private.hazard_requests(user_id,request_id,payload,response) values(auth.uid(),p_request_id,v_payload,v_response);
  return v_response;
end; $$;

-- Helpers are not exposed by PostgREST and cannot be called by client roles.
revoke all on all functions in schema private from public,anon,authenticated;
grant execute on function private.is_site_member(uuid) to authenticated;
revoke all on function public.reserve_hazard_photo(uuid,uuid,text),
  public.submit_hazard_report(uuid,uuid,public.hazard_type,integer,double precision,double precision,uuid),
  public.checkin_hazard_report(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.reserve_hazard_photo(uuid,uuid,text),
  public.submit_hazard_report(uuid,uuid,public.hazard_type,integer,double precision,double precision,uuid),
  public.checkin_hazard_report(uuid,uuid,boolean) to authenticated;
