# Automatic safety checklist operations

For a fresh clone, start with the [local development guide](local-development.md). It gives the real frontend, isolated CodeAct executor and prediction model commands in order. This document covers architecture, configuration, verification and production operation.

## User flow

Sign in, select an assigned worksite, and open **Next-day briefing** (supervisor) or **Tomorrow's briefing** (worker) in the sidebar. On phones, use **Menu** for navigation and the site selector. The Task safety checklist panel automatically shows the site's jurisdiction, heat/weather readings, cited instructions, source links and coverage gaps. Read it and select **Acknowledge this checklist**. A replacement requires a new acknowledgement. No profile form, planned work, source approval, Generate or Publish action is required.

Today's date is selected in the site's timezone. After 18:00 local time, tomorrow's checklist can also be available through the date field. Refresh only reloads the current result. Generation continues without a browser open.

## Fictional UI demo

```sh
npm ci
npm run dev:design
```

Sign in as `supervisor@planit.local` or `crew@planit.local` with password `CrewDemo123!`, select North and open the role's briefing page for its safety checklist. A fictional checklist appears automatically. These design identities and source quotes are fixtures, not real database accounts or legal evidence.

URL query cases include `?safety=stale`, `retry`, `revised`, `missing`, `failed` and `disabled`. The `revised` case replaces the checklist after its first acknowledgement so you can verify that a new receipt is required. Design mode does not use the real database.

## Isolated local verification

```sh
npm run safety:local:start
npm run safety:types
npm run safety:dev
npm run test:functions
npm run test:safety:db
npm run test:safety:ui
npm run test:safety:regression
PLAYWRIGHT_MODE=design npm run test:ui
npm run build
npm run format:check
```

Docker and Supabase CLI are required. The isolated `planit-safety-agent` stack uses API 55321, database 55322 and Studio 55323. It applies migrations without resetting the shared stack or hosted data and writes ignored `.env.safety`. If another checkout owns the temporary links, use a different `SAFETY_LOCAL_DIR` consistently for these commands. Stop it with `npm run safety:local:stop`.

Database fixtures roll back or clean their records and reject remote database hostnames. Function fixtures use fake providers; browser fixtures use fictional source text. Also run the existing monitoring, rules and crew-assignment SQL verification and schema lint against the local stack. These checks do not establish paid-provider quality or complete regulatory coverage.

## One-time server setup

This is deployment configuration, not an admin step for each checklist. Copy [safety.env.example](../supabase/functions/safety.env.example) to an ignored server environment file:

| Variable                       | Purpose                                                         |
| ------------------------------ | --------------------------------------------------------------- |
| `SAFETY_AGENT_ENABLED`         | `true` enables the Edge worker                                  |
| `GEMINI_API_KEY`               | Server-only Gemini credential                                   |
| `SAFETY_MODEL`                 | Explicit supported model with Google Search grounding           |
| `SAFETY_RESERVED_USD_PER_TURN` | Conservative maximum model/thinking/search reservation per turn |
| `SAFETY_MAX_SPEND_USD`         | Per-run reservation ceiling; default `0.50`                     |
| `CRON_SECRET`                  | Must match the database Vault secret                            |

Use the provider's [model catalog](https://ai.google.dev/gemini-api/docs/models), [Google Search documentation](https://ai.google.dev/gemini-api/docs/google-search) and [pricing](https://ai.google.dev/gemini-api/docs/pricing) when configuring the model and reservation. Include paid search queries, prompt, output and thinking usage. Reconcile actual provider billing and configure account spending controls. There is no daily project spending cap in this worker.

For a local provider check:

```sh
node scripts/safety/local-stack.mjs serve /absolute/path/safety.env
```

Set matching database configuration through an authorized server connection:

```sql
update private.safety_settings
set model = '<same model ID as SAFETY_MODEL>', enabled = true;
```

Invoke `/functions/v1/generate-safety-briefings` with `X-Cron-Secret`, or let the configured schedule run. It automatically queues eligible sites, claims one, researches the site and publishes validated content. Inspect `automatic_safety_runs` for state, error category, diagnostics and private source documents; inspect `automatic_safety_checklists` for generated content. The model must match the snapshot configuration.

Check that the site resolves to its actual jurisdiction, source links load, selected quotes retain their scope, units/times match the readings and unavailable sources produce explicit gaps. A worker HTTP 200 or `saved=true` can represent an empty, limited-information checklist. Inspect item/source counts and the response's bounded `research` health fields before treating generation as ready. OSHA may return HTTP 403; independently fetched CDC/NIOSH workplace heat guidance provides a fallback while blocked sources remain explicit gaps. Provider failures retry automatically. A successful fake-provider test does not substitute for this live check. No supervisor publication action follows it.

## Real database with a local frontend

A hosted frontend is unnecessary. After backend deployment, set ignored `.env.local` to the real project's `VITE_SUPABASE_URL`, public `VITE_SUPABASE_ANON_KEY` and, if needed, `VITE_VAPID_PUBLIC_KEY`. Set `VITE_LOCAL_DEMO=false`. Run `npm run dev` and sign in with real assigned accounts. Never put service-role, provider or cron credentials in a `VITE_` variable. `dev:design` and `safety:dev` intentionally target different environments.

Opening the real database before deployment does not enable the agent. Both the additive schema and scheduled Edge worker must exist, and the server switches/model must be configured. Public browser credentials alone cannot deploy functions or configure server secrets.

## Deployment and recovery

1. Back up the target and inspect its migration ledger. Apply missing migrations in repository order; never reset hosted data or replay changed historical files. Automatic checklists add migrations `20261018011000` and `20261018011100` after the existing safety migrations and `20261018010900` briefing change.
2. Deploy `generate-safety-briefings` and configure the server variables above. The endpoint uses `X-Cron-Secret`; platform JWT verification is disabled for this cron endpoint. Browsers still use authenticated SQL RPCs.
3. Verify Vault `functions_base_url` and `cron_secret`. Check `safety-enqueue-automatic` and `safety-generate-worker`, each scheduled every minute. The old `safety-enqueue-evening`, `safety-refresh-inputs` and `safety-refresh-sources` schedules are retired by migration. Missing Vault values skip the external invocation with a warning.
4. Enable matching database and Edge configuration. Every assigned EIA registry site becomes eligible automatically; there is no per-site profile switch. Verify one real generated checklist and then monitor the queue, source gaps, latency, replacement receipts and provider billing.
5. Deploy/use the current frontend. Both roles receive the same automatic panel. Existing alerts, weather briefings and stop-work behavior remain independent.

To stop new generation/publication, set `private.safety_settings.enabled=false` and Edge `SAFETY_AGENT_ENABLED=false`. History and existing urgent alerts remain. Disabling generation does not withdraw previously generated checklists immediately; they retain their normal freshness/expiry behavior. For rollback, disable generation and revert frontend/worker deployment while retaining additive tables and historical citations.

The earlier curated-source ingestion and draft-review interfaces are historical compatibility tools. They are not prerequisites for automatic research, generation or publication and are not used by the current UI.

## CodeAct research executor

The opt-in executor adapts the **action representation and execution-feedback loop** from Xingyao Wang, Yangyi Chen, Lifan Yuan, Yizhe Zhang, Yunzhu Li, Hao Peng and Heng Ji, _Executable Code Actions Elicit Better LLM Agents_ (ICML 2024; [arXiv:2402.01030v4](https://arxiv.org/abs/2402.01030v4)). The model generates executable Python that calls research tools, composes results using variables/loops/conditionals, observes execution output or errors, and chooses another action or a final proposal. A JSON envelope transports the Python action; research is performed by the executed code, not by a predetermined tool sequence.

This project uses Gemini with a restricted Docker interpreter and application-specific tools. It does **not** reproduce CodeActInstruct fine-tuning, the paper's model, full general-purpose action space, benchmarks, or reported performance gains. Functional verification establishes execution, feedback and grounding behavior; it does not establish superior checklist quality or legal completeness. Cite the paper for the architecture, not as evidence that this deployment achieves its benchmark results.

```text
Minute enqueue -> run execution_mode
                    | pipeline -> existing scheduled Edge worker
                    | codeact  -> Node worker
                                   |
                        model broker (Supabase secrets + lease/budget)
                                   |
                        model generates Python action
                                   v
                        persistent isolated Python container
                                   |
                     read-only tools -> host validates every call
                       | context: Census + recorded site conditions
                       | search: grounded official-source discovery
                       | read: independently fetched official documents
                       | check: quote/number/length validation
                                   |
                        stdout/error -> model -> next action
                                   |
                        finish proposal, max five actions
                                   v
                     existing SQL validation + input freshness check
                                   |
                        current checklist -> worker receipt
```

Files: `scripts/safety/codeact/agent.mjs` owns the bounded loop/tools; `sandbox.mjs` starts and destroys the per-run container; `interpreter.py` maintains Python variables and bridges tool calls; `worker.mjs` claims leases and submits publication. `supabase/functions/codeact-safety-model` holds the provider credential and reserves model-call budgets in SQL. Migrations `20261018040000` and `20261018040100` add mode separation, service-only caches and private per-lease action traces. Existing publication validation, membership access and per-version acknowledgement remain authoritative.

Generated Python receives no provider/service credentials, host socket, writable host mount or network. The host exposes only scoped research tools, checks arguments and budgets on every call (including loop iterations), and owns publication. The disposable container runs without root/capabilities, with a read-only filesystem and bounded memory/CPU/processes/output. Docker is a process-isolation boundary, not a proof against every possible kernel/runtime vulnerability; use a dedicated worker host without unrelated sensitive workloads. Never mount Docker's socket inside the Python container.

Bounds: 120 seconds per run, five code actions, seven decision opportunities, 16 tool calls, eight total provider calls including search, and a conservative 50,000-token input/output reservation (up to 8,192 output tokens for each code/proposal response). The broker also applies `SAFETY_RESERVED_USD_PER_TURN` and `SAFETY_MAX_SPEND_USD` before each call. Completed token reservations reconcile against provider-reported usage; failed or unreported calls retain their reservation. Only one provider call can be in flight per attempt. The model receives remaining action/tool budgets and a final-proposal instruction at the decision limit. Independently fetched full text and exact relevant excerpts are available to Python; excerpts are not generated summaries. Errors and validation failures become observations within those limits. Private `safety_codeact_attempts` stores executable actions and bounded tool/execution observations, not hidden reasoning. Failed/incomplete runs do not publish fabricated evidence; existing bounded retry/lease behavior applies.

Caching is explicit: Census results are cached **30 days by coordinates** only when resolved; official document text is cached **two hours by URL**, preserving its original `checked_at`. Failed fetches never refresh a cache entry. Search discovery covers all known jurisdiction levels once per research run; repeated discovery calls reuse that run's candidate list. Changing worksite coordinates selects a new jurisdiction key; weather changes reuse still-valid regulation documents while generating a new checklist. Existing checklist input fingerprints and two-hour queue deduplication are separate from these evidence caches. This is time-based freshness, not continuous detection of regulatory changes. Earlier regulatory changes can remain unseen until document-cache expiry and the next run.

### Start against the real database

Deploy migrations `20261018040000` and `20261018040100` after the existing migrations and deploy `codeact-safety-model`. Keep the existing server secrets; no new Gemini key is required. The broker accepts only the server service-role credential and a live CodeAct lease, never browser credentials. On the **trusted worker host**, provide an ignored file such as `.env.codeact` containing `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (no `VITE_` prefix). Do not commit it or copy it into generated code's container.

```sh
docker pull python:3.12-slim
node --env-file=.env.codeact --experimental-strip-types scripts/safety/codeact/worker.mjs
```

Node 22+ and Docker are required. Run that command under your hosting platform's supervisor/restart policy; keep one worker initially. It can share the trusted machine that runs model jobs. The Python container is disposable execution isolation, not an additional public server. Host dependencies are pinned by `package-lock.json`; deploy an immutable Python image digest for reproducibility. The locally verified image is `python:3.12-slim@sha256:a6e34c598f2467ed0e9a8d349809fcd8b5c603269512df273a0bb1784edc11b1`.

Once the worker is healthy, change server configuration, not a worksite admin form:

```sql
update private.safety_settings set execution_mode = 'codeact';
-- Transfer only unclaimed jobs; leave in-flight leases alone.
update public.automatic_safety_runs set execution_mode = 'codeact'
where execution_mode = 'pipeline' and state = 'queued' and attempt = 0;
```

The minute enqueue selects that mode for future jobs. The Edge pipeline cannot claim CodeAct jobs. To revert, set `execution_mode='pipeline'` and move queued CodeAct jobs back to pipeline; let running leases finish or expire before moving them. Do not switch the queue to CodeAct without a continuously running executor. Migration intentionally keeps `pipeline` as the default so deploying schema/frontend cannot strand generation. `--once` runs at most one claimed job, and `SAFETY_CODEACT_RUN_ID` can restrict a verification run to a specific queued CodeAct job.

### Concise checklist presentation

Python submits candidate items to `check_proposal`, which returns a validated proposal reference. The model can finish using that reference, preserving the original quote text without copying it into another response. Inline proposals still pass the same validation.

New CodeAct proposals are limited to five actions, 80-character titles, 600-character exact quotes and 240-character scope notes. The worker sees action titles, up to three condition summaries, current/stale status and an acknowledgement. Expand **Scope & sources** for each action's complete scope and verbatim evidence; expand coverage notes for missing information. Supervisors have **Research details** with source timestamps and retry status. Older longer versions retain their remaining instructions under **additional instructions**. Search attribution, when supplied, stays displayed. Acknowledgement records receipt, not completed work, training or applicability.
