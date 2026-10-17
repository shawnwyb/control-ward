# PlanIT Control · Crew hazard reporting

A working Section 5 slice: authenticated crew reports, private photos, spatial duplicate merging, status check-ins, scheduled reminders and expiration, scoring feeds, and a responsive crew interface.

Runs on **real local Supabase**: Postgres + PostGIS, Auth, Storage, Realtime and pg_cron. No cloud account, external API keys, weather service, ML service or map service is required. Initial setup downloads npm packages and Docker images; the running reporting flow makes no external requests.

## Start locally

Requirements: Node 22+, npm, Supabase CLI and a running Docker-compatible engine. These commands operate on this project's local stack, never a linked remote database.

```sh
npm ci
npm run local:start
npm run local:reset
npm run dev
```

Open <http://127.0.0.1:5173>. Local Supabase Studio is at <http://127.0.0.1:54323>.

`local:reset` **recreates this local project's database** and loads the demo fixtures. Use it for a fresh demo, not to preserve local reports. `local:start` and `local:env` generate the ignored `.env.local` using the local stack's development credentials. No hosted keys are needed. Normal later starts need only `npm run local:start` and `npm run dev`.

| Local account             | Site access |
| ------------------------- | ----------- |
| `crew@planit.local`       | North Plant |
| `other@planit.local`      | South Plant |
| `supervisor@planit.local` | Both plants |
| `outsider@planit.local`   | None        |

All demo accounts use `CrewDemo123!`. Sites, identities and hazards are fictional. The demo account hints are enabled only by `VITE_LOCAL_DEMO=true` in the generated local environment. Never load demo identities into a production project or expose the local stack publicly.

The pin picker uses a **local coordinate grid**, keyboard arrows, typed coordinates, or browser geolocation. It is not a street/satellite basemap. Grid dimensions are approximate; duplicate matching and risk-radius queries use PostGIS geography distances in meters.

## Why the data model works

- A **report** is the current state of one site-owned hazard; an **observation** is an immutable record of a submission, confirmation or resolution. Merging preserves location/severity history for ML.
- Every mutation authenticates site membership. RLS limits reads; direct client writes are revoked. Privileged RPCs validate membership explicitly and use a fixed empty `search_path`.
- A per-request transaction lock makes retries idempotent. A per-site transaction lock serializes duplicate searches, report updates and expiration. Matching submissions can never both insert solely because they raced. Hash collisions cause extra waiting, not incorrect matching.
- A request UUID belongs to one user and one input payload. A retry returns the original response; changed input requires a new UUID. The UI preserves IDs during network retries within the current page session. A browser reload starts a new submission.
- Photos use reservations and immutable private object paths. Upload precedes submission; attachment and observation commit together in Postgres. The database checks the uploaded object exists. Abandoned uploads are cleaned through the Storage API, followed by metadata pruning.
- Expired reports stop contributing to metrics immediately. A five-minute pg_cron job persists resolution and creates in-app check-in reminders. Report history remains available.

The full behavior, including **provisional scoring formulas**, duplicate time-window semantics, report radius and notification ownership, is in [the integration contract](docs/crew-contract.md).

## Verify

```sh
npm test                     # Real Auth, REST, PostGIS, Storage, concurrent RPCs, Realtime, pg_cron
npx playwright install chromium
npm run test:ui              # Real browser flows, photo upload, lost-response retry, mobile layout
npm run build                # TypeScript and production bundle
npm run db:lint              # Application schemas only; excludes vendor PostGIS functions
npm run format:check
npm audit
```

Tests create isolated users/sites and remove their fixtures afterward. Backend tests exercise independent database connections through simultaneous HTTP requests. Browser tests include a response lost **after the RPC committed**, then verify retrying does not add a confirmation. Desktop/mobile screenshots and failure traces go into ignored `test-results/`.

Additional commands:

```sh
npm run types                # Regenerate committed database TypeScript types after schema changes
npm run local:cleanup        # Delete up to 100 unattached uploads older than one hour via Storage API
supabase stop                # Stop this project's local services; preserves local data
```

Keep service-role credentials on trusted workers only. The cleanup script derives its credentials from the local CLI and refuses non-loopback URLs. For hosted deployment, schedule an equivalent janitor using server-side credentials. Expiry and in-app reminder generation are already scheduled inside Postgres.

## Monitoring backend (hosted Supabase)

Feeds, rules, alerts, briefings and the lightning countdown run on the linked hosted project with no local Docker: pg_cron calls Edge Functions, which write readings; Postgres derives subscores, alerts and risk. See [the monitoring contract](docs/api-contract.md) for schedules, reading units, rule thresholds, payloads and operations. `npm run test:functions`, `npm run verify:monitoring` and `npm run verify:rules` check it. Heat thresholds and the WBGT estimate still need validation, and ML scoring is not part of this layer.

## Teammate handoff

See [RPC examples and consumer queries](docs/crew-api.md).

| Interface                                               | Consumer                                              |
| ------------------------------------------------------- | ----------------------------------------------------- |
| `submit_hazard_report`                                  | Crew reporting form                                   |
| `checkin_hazard_report`                                 | Crew “still there” / “gone” controls                  |
| `reserve_hazard_photo` + private `hazard-photos` bucket | Crew photo upload                                     |
| `crew_hazard_feed`                                      | Dashboard, heatmap, open hazards in briefing          |
| `crew_observation_feed`                                 | Spatial history / repeated affected areas for ML      |
| `get_site_crew_metrics`                                 | Risk-score and wildlife-subscore owners               |
| `hazard_events` + claim/ack RPCs                        | Alert / briefing workers; independent leased delivery |
| `hazard_checkin_tasks`                                  | Assigned crew's in-app reminder inbox                 |

The minimal shared `sites` and `site_memberships` schema must be reconciled with your team's site registry before combining migrations. Authenticated consumers are site-scoped. Trusted service-role workers can read all sites and calculate metrics.

This slice does not implement weather ingestion, the overall risk score, Python ML, supervisor dashboard, briefing generation, or outbound SMS/push delivery. It supplies their data interfaces. “Local crews” currently means assigned site members; GPS-based recipient selection is a separate policy decision.

For larger deployments, replace the simple site-wide serialization with a measured locking strategy, paginate long feeds/history, and define confirmation abuse controls and retention. Notification consumers already have independent leases and acknowledgements; outbound providers still need idempotency. Current mutations are designed for Postgres's default READ COMMITTED isolation and the documented hackathon workload.
