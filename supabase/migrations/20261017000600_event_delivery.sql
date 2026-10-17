-- Identity IDs are allocated before commit: a simple `id > cursor` poll can miss
-- an earlier ID committed later. Track delivery independently for each consumer.
create table private.hazard_event_deliveries (
  consumer text not null,
  event_id bigint not null references public.hazard_events(id),
  lease_token uuid,
  leased_until timestamptz not null default '-infinity',
  delivered_at timestamptz,
  attempts integer not null default 0,
  primary key(consumer,event_id)
);
create index deliveries_pending on private.hazard_event_deliveries(consumer,event_id) where delivered_at is null;

create function public.claim_hazard_events(p_consumer text,p_limit integer default 100,p_lease_seconds integer default 60)
returns table(event_id bigint,report_id uuid,observation_id uuid,action public.hazard_action,created_at timestamptz,lease_token uuid)
language plpgsql security definer set search_path='' as $$
begin
  if p_consumer is null or p_consumer!~'^[a-z][a-z0-9_-]{0,63}$' or p_limit is null or p_limit not between 1 and 1000
    or p_lease_seconds is null or p_lease_seconds not between 1 and 3600 then
    raise exception 'Valid consumer name, batch size 1–1000 and lease duration 1–3600 seconds required' using errcode='22023';
  end if;
  insert into private.hazard_event_deliveries(consumer,event_id)
  select p_consumer,e.id from public.hazard_events e
  where not exists(select 1 from private.hazard_event_deliveries d where d.consumer=p_consumer and d.event_id=e.id)
  order by e.id limit p_limit on conflict do nothing;

  return query
  with candidates as (
    select d.event_id from private.hazard_event_deliveries d
    where d.consumer=p_consumer and d.delivered_at is null and d.leased_until<=clock_timestamp()
    order by d.event_id limit p_limit for update skip locked
  ), claimed as (
    update private.hazard_event_deliveries d set lease_token=gen_random_uuid(),
      leased_until=clock_timestamp()+make_interval(secs=>p_lease_seconds),attempts=attempts+1
    from candidates c where d.consumer=p_consumer and d.event_id=c.event_id
    returning d.event_id,d.lease_token
  )
  select e.id,e.report_id,e.observation_id,e.action,e.created_at,c.lease_token
  from claimed c join public.hazard_events e on e.id=c.event_id order by e.id;
end; $$;

create function public.ack_hazard_event(p_consumer text,p_event_id bigint,p_lease_token uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare v_count integer;
begin
  update private.hazard_event_deliveries set delivered_at=clock_timestamp()
  where consumer=p_consumer and event_id=p_event_id and lease_token=p_lease_token
    and leased_until>clock_timestamp() and delivered_at is null;
  get diagnostics v_count=row_count;
  return v_count=1;
end; $$;
revoke all on function public.claim_hazard_events(text,integer,integer),public.ack_hazard_event(text,bigint,uuid)
  from public,anon,authenticated;
grant execute on function public.claim_hazard_events(text,integer,integer),public.ack_hazard_event(text,bigint,uuid) to service_role;
