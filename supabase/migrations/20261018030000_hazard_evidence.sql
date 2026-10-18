-- Backing evidence and verified news articles for elevated Hazard Index scores and main drivers.
-- Populated by models/hazard-index/fetch_evidence.py using Google Gemini with Google Search Grounding.

create table if not exists public.hazard_evidence (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id) on delete cascade,
  horizon text not null check (horizon in ('now','tomorrow')),
  driver text not null check (driver in ('flood','fire','storm','heat')),
  hazard_score numeric(3,1) not null check (hazard_score between 0 and 10),
  summary text not null,
  articles jsonb not null default '[]'::jsonb,
  model_version text not null,
  queried_at timestamptz not null default now(),
  unique (site_id, horizon, driver)
);

create index if not exists hazard_evidence_site on public.hazard_evidence(site_id, horizon);

alter table public.hazard_evidence enable row level security;

create policy hazard_evidence_read on public.hazard_evidence
  for select to authenticated using (private.is_site_member(site_id));

create or replace function public.upsert_hazard_evidence(p_batch jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_count integer;
begin
  if p_batch is null or jsonb_typeof(p_batch) <> 'array' or jsonb_array_length(p_batch) > 1000 then
    raise exception 'Batch must be an array of at most 1000 evidence items' using errcode='22023';
  end if;
  insert into public.hazard_evidence(site_id, horizon, driver, hazard_score, summary, articles, model_version, queried_at)
  select (e->>'site_id')::uuid, e->>'horizon', e->>'driver',
         (e->>'hazard_score')::numeric, e->>'summary',
         coalesce(e->'articles', '[]'::jsonb), e->>'model_version', now()
  from jsonb_array_elements(p_batch) e
  on conflict(site_id, horizon, driver) do update set
    hazard_score = excluded.hazard_score,
    summary = excluded.summary,
    articles = excluded.articles,
    model_version = excluded.model_version,
    queried_at = now();
  get diagnostics v_count = row_count;
  return jsonb_build_object('upserted', v_count);
end; $$;

revoke all on function public.upsert_hazard_evidence(jsonb) from public, anon;
grant execute on function public.upsert_hazard_evidence(jsonb) to authenticated, service_role;
grant select on public.hazard_evidence to authenticated, service_role;
