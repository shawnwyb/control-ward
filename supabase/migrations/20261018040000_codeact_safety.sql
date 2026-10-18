-- Opt-in CodeAct executor. The existing Edge pipeline stays active until a worker is hosted.
alter table private.safety_settings add column execution_mode text not null default 'pipeline' check (execution_mode in ('pipeline','codeact'));
alter table public.automatic_safety_runs add column execution_mode text not null default 'pipeline' check (execution_mode in ('pipeline','codeact'));
create function private.set_safety_execution_mode() returns trigger language plpgsql set search_path='' as $$ begin
 if new.execution_mode='pipeline' then
  new.execution_mode:=(select execution_mode from private.safety_settings);
 end if;
 return new;
end $$;
create trigger automatic_safety_execution_mode before insert on public.automatic_safety_runs for each row execute function private.set_safety_execution_mode();
revoke all on function private.set_safety_execution_mode() from public,anon,authenticated;

create or replace function public.claim_automatic_safety_runs() returns setof public.automatic_safety_runs
language plpgsql security definer set search_path='' as $$ begin
 if not (select enabled and model<>'unconfigured' from private.safety_settings) then return; end if;
 update public.automatic_safety_runs set state='failed',error_category='lease_exhausted',finished_at=now()
 where execution_mode='pipeline' and state='running' and leased_until<now() and attempt>=3;
 return query with candidate as (
  select id from public.automatic_safety_runs where execution_mode='pipeline' and attempt<3 and ((state='queued' and available_at<=now()) or (state='running' and leased_until<now()))
  order by available_at,id for update skip locked limit 1)
 update public.automatic_safety_runs r set state='running',attempt=r.attempt+1,lease_token=gen_random_uuid(),leased_until=now()+interval '150 seconds'
 from candidate c where c.id=r.id returning r.*;
end $$;
create function public.claim_codeact_safety_runs(p_run_id uuid default null) returns setof public.automatic_safety_runs
language plpgsql security definer set search_path='' as $$ begin
 if not (select enabled and model<>'unconfigured' from private.safety_settings) then return; end if;
 update public.automatic_safety_runs set state='failed',error_category='lease_exhausted',finished_at=now()
 where execution_mode='codeact' and state='running' and leased_until<now() and attempt>=3;
 return query with candidate as (
  select id from public.automatic_safety_runs where execution_mode='codeact' and (p_run_id is null or id=p_run_id)
   and attempt<3 and ((state='queued' and available_at<=now()) or (state='running' and leased_until<now()))
  order by available_at,id for update skip locked limit 1)
 update public.automatic_safety_runs r set state='running',attempt=r.attempt+1,lease_token=gen_random_uuid(),leased_until=now()+interval '150 seconds'
 from candidate c where c.id=r.id returning r.*;
end $$;

-- Audit is private: executable actions, bounded tool observations and execution errors,
-- never hidden reasoning. Each retry has its own lease and budget.
create table private.safety_codeact_attempts (
 run_id uuid references public.automatic_safety_runs on delete cascade,
 lease_token uuid, model_calls integer not null default 0,
 reserved_tokens integer not null default 0, trace jsonb not null default '[]',
 primary key(run_id,lease_token)
);
create function public.reserve_codeact_model_call(p_run_id uuid,p_lease_token uuid,p_prompt_bytes integer,p_max_calls integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.automatic_safety_runs; begin
 select * into r from public.automatic_safety_runs where id=p_run_id and lease_token=p_lease_token and state='running' and leased_until>now() and execution_mode='codeact';
 if r.id is null or not (select enabled from private.safety_settings) then raise exception 'Inactive CodeAct lease'; end if;
 if p_prompt_bytes not between 1 and 45000 or p_max_calls not between 1 and 8 then raise exception 'Invalid budget'; end if;
 insert into private.safety_codeact_attempts(run_id,lease_token) values(r.id,r.lease_token) on conflict do nothing;
 update private.safety_codeact_attempts set model_calls=model_calls+1,reserved_tokens=reserved_tokens+p_prompt_bytes+4096
 where run_id=r.id and lease_token=r.lease_token and model_calls<p_max_calls and reserved_tokens+p_prompt_bytes+4096<=50000;
 if not found then raise exception 'CodeAct resource limit'; end if;
 return r.input_snapshot;
end $$;
create function public.save_codeact_trace(p_run_id uuid,p_lease_token uuid,p_trace jsonb) returns void
language plpgsql security definer set search_path='' as $$ begin
 if jsonb_typeof(p_trace) is distinct from 'array' or length(p_trace::text)>160000 or jsonb_array_length(p_trace)>60 then raise exception 'Invalid trace'; end if;
 update private.safety_codeact_attempts set trace=p_trace where run_id=p_run_id and lease_token=p_lease_token;
end $$;

-- Evidence cache is separate from the two-hour checklist deduplication window.
-- Cached document checked_at is retained; failures never create/refresh entries.
create table private.safety_codeact_cache(key text primary key,value jsonb not null,expires_at timestamptz not null);
create function public.get_codeact_cache(p_key text) returns jsonb language sql security definer set search_path='' as $$
 select value from private.safety_codeact_cache where key=p_key and expires_at>now();
$$;
create function public.put_codeact_cache(p_key text,p_value jsonb,p_ttl_seconds integer) returns void
language plpgsql security definer set search_path='' as $$ begin
 if length(p_key)>100 or length(p_value::text)>100000 or p_ttl_seconds not between 1 and 2592000 then raise exception 'Invalid cache entry'; end if;
 delete from private.safety_codeact_cache where expires_at<now();
 insert into private.safety_codeact_cache values(p_key,p_value,now()+make_interval(secs=>p_ttl_seconds))
 on conflict(key) do update set value=excluded.value,expires_at=excluded.expires_at;
end $$;
revoke all on private.safety_codeact_attempts,private.safety_codeact_cache from public,anon,authenticated;
revoke all on function public.claim_codeact_safety_runs(uuid),public.reserve_codeact_model_call(uuid,uuid,integer,integer),public.save_codeact_trace(uuid,uuid,jsonb),public.get_codeact_cache(text),public.put_codeact_cache(text,jsonb,integer) from public,anon,authenticated;
grant execute on function public.claim_codeact_safety_runs(uuid),public.reserve_codeact_model_call(uuid,uuid,integer,integer),public.save_codeact_trace(uuid,uuid,jsonb),public.get_codeact_cache(text),public.put_codeact_cache(text,jsonb,integer) to service_role;
