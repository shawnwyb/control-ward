-- Reserve before a paid call, then reconcile against provider-reported usage.
-- One in-flight reservation per attempt prevents concurrent calls bypassing limits.
alter table private.safety_codeact_attempts add column pending_tokens integer not null default 0;
create or replace function public.reserve_codeact_model_call(p_run_id uuid,p_lease_token uuid,p_prompt_bytes integer,p_max_calls integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.automatic_safety_runs; begin
 select * into r from public.automatic_safety_runs where id=p_run_id and lease_token=p_lease_token and state='running' and leased_until>now() and execution_mode='codeact';
 if r.id is null or not (select enabled from private.safety_settings) then raise exception 'Inactive CodeAct lease'; end if;
 if p_prompt_bytes not between 1 and 45000 or p_max_calls not between 1 and 8 then raise exception 'Invalid budget'; end if;
 insert into private.safety_codeact_attempts(run_id,lease_token) values(r.id,r.lease_token) on conflict do nothing;
 update private.safety_codeact_attempts set model_calls=model_calls+1,reserved_tokens=reserved_tokens+p_prompt_bytes+4096,pending_tokens=p_prompt_bytes+4096
 where run_id=r.id and lease_token=r.lease_token and pending_tokens=0 and model_calls<p_max_calls and reserved_tokens+p_prompt_bytes+4096<=50000;
 if not found then raise exception 'CodeAct resource limit'; end if;
 return r.input_snapshot;
end $$;
create function public.settle_codeact_model_call(p_run_id uuid,p_lease_token uuid,p_tokens integer) returns void
language plpgsql security definer set search_path='' as $$ begin
 if p_tokens is null or p_tokens not between 0 and 50000 then raise exception 'Invalid usage'; end if;
 update private.safety_codeact_attempts a set reserved_tokens=reserved_tokens-pending_tokens+p_tokens,pending_tokens=0
 where run_id=p_run_id and lease_token=p_lease_token and pending_tokens>0 and reserved_tokens-pending_tokens+p_tokens<=50000
 and exists(select 1 from public.automatic_safety_runs r where r.id=a.run_id and r.lease_token=a.lease_token and r.state='running' and r.leased_until>now());
 if not found then raise exception 'CodeAct resource limit'; end if;
end $$;
revoke all on function public.settle_codeact_model_call(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.settle_codeact_model_call(uuid,uuid,integer) to service_role;
