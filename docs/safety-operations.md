# Automatic safety checklist operations

## User flow

Open an assigned worksite as either a supervisor or worker. The Task safety checklist panel automatically shows the site's jurisdiction, heat/weather readings, cited instructions, source links and coverage gaps. Read it and select **Acknowledge this checklist**. A replacement requires a new acknowledgement. No profile form, planned work, source approval, Generate or Publish action is required.

Today's date is selected in the site's timezone. After 18:00 local time, tomorrow's checklist can also be available through the date field. Refresh only reloads the current result. Generation continues without a browser open.

## Fictional UI demo

```sh
npm ci
npm run dev:design
```

Sign in as `supervisor@planit.local` or `crew@planit.local` with password `CrewDemo123!`, select North and open its safety checklist. A fictional checklist appears automatically. These design identities and source quotes are fixtures, not real database accounts or legal evidence.

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
