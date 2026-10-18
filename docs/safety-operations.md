# Task safety checklist setup

Generation defaults off in the database, Edge worker and site profiles. Enabling the pilot requires an explicitly confirmed site profile, approved sources, server-side provider configuration and supervisor review. See the [contract](safety-contract.md) for coverage and access rules and the [API](safety-api.md) for browser integration.

## Design demo

```sh
npm ci
npm run dev:design
```

Sign in as `supervisor@planit.local` / `CrewDemo123!`, choose **North Plant · Demo**, and use **Task safety checklist** to save work, generate, inspect evidence, edit notes, save a reviewed revision and publish. Sign out and sign in as `crew@planit.local` in the same tab to acknowledge the publication. Reload resets mock state. Instructions are fictional company policy.

Use `?safety=published`, `stale`, `revised`, `missing`, `pending`, `retry` or `failed` for UI scenarios. Pending/retry/failed apply after a request. `?latency=1500` slows requests; `?fail` rejects writes. The missing scenario shows missing-context/procedure gaps; database and host fixtures cover unsupported scope.

## Isolated local stack

Docker and the Supabase CLI are required. Project `planit-safety-agent` uses API 55321, database 55322 and Studio 55323, separately from the existing local stack. The helper does not reset the shared database or copy environment files. `SAFETY_LOCAL_DIR` overrides its generated temporary workdir. `.env.safety` contains generated local public browser configuration only.

```sh
npm run safety:local:start
npm run test:safety:db
npm run test:safety:regression
npm run safety:types
npm run safety:dev
npm run safety:local:stop
```

Database fixtures use local demo identities, serialize fixture groups and clean up or roll back their records. They do not require a database reset. `SAFETY_TEST_DB_URL` can override the local database URL; remote hostnames are rejected. The regression command runs existing backend and browser checks against this stack through `SUPABASE_WORKDIR` and Vite safety mode. The types command regenerates `src/database.types.ts` from the migrated local schema.

## Sources and review

The curated manifest is [corpus.ts](../supabase/functions/_shared/safety-agent/corpus.ts). It includes [OSHA State Plans](https://www.osha.gov/stateplans), [1910.269](https://www.osha.gov/laws-regs/regulations/standardnumber/1910/1910.269) and [1926.950](https://www.osha.gov/laws-regs/regulations/standardnumber/1926/1926.950). Retain working-alone exceptions and construction cross-references in the conditions. Unknown effective/superseded dates stay null. The corpus is limited briefing material, not complete legal coverage.

Set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in the operator process only:

```sh
npm run safety:ingest
npm run safety:ingest -- --demo
npm run safety:ingest -- /absolute/path/company-manifest.json
```

The first command fetches allowlisted official HTML and stages candidates. The second stages fictional North demo policy, which cannot be used at real registry sites. The third stages company procedures. None approves sources.

Company manifests are arrays shaped like `demoProcedure(...)` in the corpus. Use a unique `key`, actual `site_id`, `category: "company_policy"`, `url: null`, `audience: "crew"` or `"supervisor"`, jurisdiction/task tags and `fictional: false` for real procedures. Use null for unknown dates. `document_file` points to versioned text/Markdown relative to the manifest. Passages contain `anchor`, verbatim `excerpt`, reviewed `instruction` and retained `conditions`. Full text is stored in Postgres under audience RLS. Use a new source key for identity or audience changes.

Review candidates through an authorized operator connection:

```sql
select s.source_key, v.id, v.status, v.available, v.last_checked_at,
       p.anchor, p.excerpt, p.instruction, p.conditions
from public.safety_sources s
join public.safety_source_versions v on v.source_id = s.id
join public.safety_passages p on p.version_id = v.id
where v.status = 'candidate';

select public.review_safety_source(
  '<candidate uuid>', true,
  '<reviewer, coverage checked, retained exceptions and rationale>', false
);
```

The second argument approves or rejects; the last marks conflicts. Check actual text, applicability, dates, audience and canonical instructions before approval. Conflicting evidence cannot supply worker actions until resolved. Do not approve a `changed-source-review` refresh placeholder: curate passages against the official text and stage a corrected candidate. Real procedures require approval for the actual site.

Weekly refresh stages changes without automatic approval. Failed fetches mark approved versions unavailable; versions checked more than 30 days ago are excluded from retrieval. Source changes invalidate draft inputs and flag publications for review, while preserving historical citations. Verify official-source access before enablement: automated OSHA fetches have returned HTTP 403. Failed retrieval must leave a gap until the operator can stage and review an authentic source.

## Provider and local worker

Copy [safety.env.example](../supabase/functions/safety.env.example) to an ignored path such as `/tmp/planit-safety.env`. Configure:

| Variable                       | Value                                                           |
| ------------------------------ | --------------------------------------------------------------- |
| `SAFETY_AGENT_ENABLED`         | `true` to run generation                                        |
| `GEMINI_API_KEY`               | Server-only provider key                                        |
| `SAFETY_MODEL`                 | Explicit supported model ID with function calling               |
| `SAFETY_RESERVED_USD_PER_TURN` | Conservative reservation at the selected model's current prices |
| `SAFETY_MAX_SPEND_USD`         | Run reservation ceiling; default `0.50`                         |
| `CRON_SECRET`                  | Fresh secret matching worker requests                           |

Select the model and reservation using the provider's [model catalog](https://ai.google.dev/gemini-api/docs/models), [pricing](https://ai.google.dev/gemini-api/docs/pricing) and [function-calling documentation](https://ai.google.dev/gemini-api/docs/generate-content/function-calling). Reserve for maximum prompt, output and thinking usage per turn. The host bounds prompt size and total usage, but reserved spend still needs reconciliation with provider billing. Missing or invalid configuration produces bounded retries and an explicit error category. Keep these values out of Vite and browser bundles.

```sh
node scripts/safety/local-stack.mjs serve /tmp/planit-safety.env
```

On the isolated local database, configure the same model:

```sql
update private.safety_settings
set enabled = true, model = '<same model ID as SAFETY_MODEL>';
```

Save an enabled profile/job through the supervisor UI and stage/review sources, then request a draft. Invoke `http://127.0.0.1:55321/functions/v1/generate-safety-briefings` with `X-Cron-Secret`. The worker claims one run, awaits it and stores a validated private draft. Inspect `safety_briefing_runs` through an authorized operator connection for state, sanitized diagnostics, evidence IDs, timing, usage and reserved spend. Partial failures use `usage_complete=false`.

A provider smoke test ends with draft review: verify canonical evidence, gaps, units/dates and budgets before a supervisor decides whether to publish. Fixture tests do not exercise a paid provider.

## Verification

```sh
npm run test:functions
npm run test:safety:db
npm run test:safety:ui
npm run test:safety:regression
PLAYWRIGHT_MODE=design npm run test:ui
npm run build
npm run format:check
```

Install Playwright Chromium if needed. Function fixtures use fake models; browser design tests use fictional policy. Database fixtures cover access, source/citation integrity, concurrency, publication and receipts. Existing backend/browser regressions check integration with weather and crew workflows. Also run the existing monitoring, rules and crew-assignment SQL verification against the intended local or staging database, and lint the migrated schema.

Before live use, a human must verify pilot employer/installation coverage, every canonical instruction and retained exception, official/company source access and review, and draft quality with the configured provider. Automated citation and retrieval checks do not establish legal applicability or model quality. Measure latency, tokens, billing, gaps and supervisor changes during staging.

## Deployment and recovery

1. Confirm pilot ownership, access and coverage. Back up the target database and inspect its migration ledger.
2. Apply migrations `20261018010000`–`20261018010800` after `20261017001600` in staging. The final migration preserves site deletion when alert/lightning rows cascade. Run authorization, queue, browser and source-review checks. Regenerate types if the shared schema changed. Do not reset hosted data or replay edited migrations.
3. Configure server-only secrets and matching database/model settings. Deploy `generate-safety-briefings` and `refresh-safety-sources`. Platform JWT verification is disabled for these endpoints because they authenticate `X-Cron-Secret`; browser mutations use authenticated SQL RPCs.
4. Configure Vault `functions_base_url` and `cron_secret`. Verify `safety-enqueue-evening` hourly, `safety-refresh-inputs` and `safety-generate-worker` each minute, and `safety-refresh-sources` weekly. Missing Vault values cause a warning and skip the external invocation. Existing `generate_due_briefings` remains independent.
5. Stage and human-review official sources and actual company procedures. Enable the global database switch, Edge worker and one confirmed site profile. Run the draft-only provider smoke test and inspect evidence support and budgets.
6. An authorized supervisor reviews and publishes the checklist. Confirm crew visibility, exact-publication receipts, freshness and replacement behavior before expanding the pilot.

Identical input requests deduplicate; explicit regeneration creates a new request. Claims have 120-second fenced leases and three attempts with 30/60-second retry delays. Correct terminal failures before regenerating. Reload stale tabs before editing or publishing. Acknowledging an old publication never acknowledges a replacement.

To stop generation, run `update private.safety_settings set enabled=false;` and set Edge `SAFETY_AGENT_ENABLED=false`. Disable an individual site's profile to stop its claims. In-flight work can finish a private draft under its existing lease. Disabling preserves history and urgent alerts; withdraw current guidance separately through the supervisor UI/RPC. Rollback disables generation and reverts frontend/worker deployment while retaining additive tables and historical citations. Existing weather briefings, alerts, lightning and stop-work rules continue independently.
