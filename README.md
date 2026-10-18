# PlanIT Control

A safety platform for utility field crews, built for SwampHacks 2026. It combines weather, heat, lightning, flood, wildfire, soil and crew-reported hazards into one risk score for each power plant site. It raises alerts when conditions turn dangerous and creates a next-day briefing at 6 PM local time for each site.

## Status

| Area                                                                | Status                                                                  |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Crew hazard reporting (photos, duplicate merging, check-ins)        | Built, with a crew UI                                                   |
| Site registry (60 real plants from EIA-860M)                        | Built                                                                   |
| Live feeds (weather, heat, rain, soil, rivers, wildfire, lightning) | Built, scheduled, running on the hosted project                         |
| Rules, alerts, risk score, evening briefing                         | Built                                                                   |
| Demo scenarios for lightning, rain, heat, fire and wildlife         | Built (RPCs only, no panel)                                             |
| Crew app: alerts, lightning countdown, site risk, evening briefing  | Built (read from the monitoring tables; acknowledge and mark-read RPCs) |
| Crew location sharing, supervisor dashboard (PlanIt Dash)           | Not built here. Another developer owns the UI.                          |
| ML hazard index                                                     | Not built. The `ml_scores` table and `upsert_ml_scores` RPC are ready.  |
| SMS and web push                                                    | Not built. Alerts reach clients through Realtime.                       |

## How it works

Everything runs on Supabase (Postgres with PostGIS, Auth, Storage, Realtime, pg_cron, Edge Functions). There is no separate server.

1. pg_cron starts an Edge Function on a schedule.
2. The Edge Function fetches outside data (Open-Meteo, NWS, NOAA, USGS, NIFC, NOAA GOES) and stores it as readings.
3. Postgres applies the rules. It calculates subscores, raises or clears alerts, and computes the risk score for each site.
4. Clients read the tables and views. Realtime sends alert changes to subscribers.

Lightning follows the brief: a strike within 10 miles sets stop work, a new strike restarts a 30 minute countdown, and 30 minutes without a strike clears it.

Read these for details:

- [Monitoring contract](docs/api-contract.md): schedules, reading units, rule thresholds, RPCs and operations.
- [Ingestion data sources](docs/ingestion-data-sources.docx): each outside dataset, its endpoint, what is stored, and caveats.
- [Crew reporting API](docs/crew-api.md) and [crew contract](docs/crew-contract.md): hazard reports, photos and check-ins.

## Setup

Requirements: Node 22 or later, npm and the Supabase CLI. Docker is needed only for the local option.

```sh
npm ci
```

### Option A: hosted project (no Docker)

1. Run `supabase login`.
2. Link your project: `supabase link --project-ref <ref>`.
3. Apply the migrations: `supabase db push --linked`.
4. Load the plants: download an EIA-860M workbook from <https://www.eia.gov/electricity/data/eia860m/>, then run:

   ```sh
   node scripts/load-sites.mjs <workbook.xlsx>
   supabase db query --linked -f supabase/seed-sites.sql
   ```

5. Set the secrets and deploy the functions:

   ```sh
   supabase secrets set CRON_SECRET=<random string> LIGHTNING_SOURCE=glm
   for f in ingest-openmeteo ingest-nws ingest-gauges ingest-wildfire ingest-lightning; do
     supabase functions deploy $f --use-api
   done
   ```

6. Store the same secret and the functions URL in Supabase Vault (SQL editor):

   ```sql
   select vault.create_secret('https://<ref>.supabase.co/functions/v1', 'functions_base_url');
   select vault.create_secret('<the same random string>', 'cron_secret');
   ```

Do not load `supabase/seed.sql` into a hosted project. It creates demo accounts with a published password.

### Connect the frontend to the hosted project

The app reads its Supabase settings from `.env.local` (git-ignored), so nothing secret lives in the repo.

1. Copy `.env.example` to `.env.local`. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` from **Project Settings → API**. Use the **anon** key only, never the service-role key. Leave `VITE_LOCAL_DEMO` out, so the demo accounts box stays hidden.
2. Create a user under **Authentication → Users** (confirmed email, with a password), then give them access to a site. The demo accounts exist only in the local `seed.sql`, and `seed-sites.sql` loads plants without memberships, so a user with no rows sees "No sites assigned":

   ```sql
   insert into public.site_memberships (site_id, user_id, role)
   select id, '<user uuid from Authentication → Users>', 'crew'   -- or 'supervisor'
   from public.sites
   where name = '<plant name>';
   ```

3. Check the connection, then run the app:

   ```sh
   CHECK_EMAIL=you@example.com CHECK_PASSWORD='…' npm run check:connection
   npm run dev
   ```

   `check:connection` is read-only. It confirms the project is reachable and the key is accepted, then signs in and reads sites, the crew feed and the metrics call. Without `CHECK_EMAIL` and `CHECK_PASSWORD` it only checks reachability. It never prints keys.

### Roles and crew management

A person's role is per site: `crew` or `supervisor` (the `role` column of `site_memberships`).

|                                                           | Crew                               | Supervisor |
| --------------------------------------------------------- | ---------------------------------- | ---------- |
| Alerts, acknowledge, briefing, map, report form, feed     | Yes                                | Yes        |
| Stats bar (site risk, open hazards, crew risk, wildlife)  | No (the live-feed indicator stays) | Yes        |
| Supervisor dashboard: plan review, push, **Crew** section | No                                 | Yes        |

Supervisors manage rosters in the app: the dashboard's **Crew** section: type the email of an account that already exists, **Add to site**. To remove someone, choose **Remove**, then **Remove from site**. The app can add and remove only `crew`. It never promotes, demotes or removes a supervisor, so the first supervisor on a site still comes from SQL (see above).

This needs one migration, `supabase/migrations/20261017001500_crew_assignment.sql`, which adds `assign_site_member` and `unassign_site_member`. It must run after `20261017001400_push_and_briefing_review.sql`, which provides `list_site_crew`. Apply it with `supabase db push --linked`, or paste the file into the SQL Editor. Without it, the Crew section says it needs a database update. Then check it:

```sh
npm run verify:crew-assignment   # rolled back; ends with "ALL CREW ASSIGNMENT CHECKS PASSED"
CHECK_EMAIL=… CHECK_PASSWORD='…' npm run check:connection   # as a supervisor, also tests the crew list
```

The crew screens use the same tables and RPCs as before; the monitoring migrations only add columns to `sites`. The crew screen also reads `alerts`, `site_overview`, `briefings`, `alert_acks` and `briefing_reads`, and calls `acknowledge_alert` and `mark_briefing_read`. `check:connection` tests those reads too. Crew location sharing (`update_crew_location`) is not wired up yet.

## Supervisor dashboard, web push and reviewed briefings

The UI follows the signed-in user's role at the selected site (`site_memberships.role`). Supervisors get risk, alerts with the lightning countdown, the crew roster with last known locations (also on the map), a push composer and the next-day plan review. Crew get live alerts, the approved plan, and opt-ins for push and location sharing.

Push targets: everyone on the site, ticked workers, or workers whose last known position is within a radius of an open hazard. Pushes are queued in `push_outbox` and sent by the `send-push` Edge Function. New or escalated alerts and high next-day risk queue pushes automatically. The daily plan is never sent automatically: `generate-briefing-draft` drafts it (forecast ring around the site, nearby sites, Gemini with Google Search for traffic, school and wildlife context), a supervisor edits it, and **Approve and send** pushes it.

Setup on the hosted project:

1. `supabase db push --linked`
2. `npx web-push generate-vapid-keys`, then `supabase secrets set VAPID_PUBLIC_KEY=… VAPID_PRIVATE_KEY=… VAPID_SUBJECT=mailto:you@example.com GEMINI_API_KEY=…`
3. `supabase functions deploy send-push --use-api` and `supabase functions deploy generate-briefing-draft --use-api`
4. Put the public key in `.env.local` as `VITE_VAPID_PUBLIC_KEY`.

Without `GEMINI_API_KEY` the draft falls back to forecast rules. iPhone needs the app added to the Home Screen before it can receive push.

### Option B: local stack (Docker)

```sh
npm run local:start
npm run local:reset
npm run dev
```

Open <http://127.0.0.1:5173>. Studio is at <http://127.0.0.1:54323>. `local:start` and `local:env` write the ignored `.env.local` with the local stack's development credentials. `local:reset` recreates the local database and loads fictional demo data.

Edge Functions are not part of the local start script, so the live feeds run only on the hosted project.

**Design-only mode (no Docker or Supabase):** `npm run dev:design` runs the UI against an in-browser mock backend with seeded demo data. Sign in with any demo account and `CrewDemo123!`. Add `?latency=1500` to slow responses or `?fail` to make writes fail, to design busy and error states. State resets on reload, and the mock is excluded from production builds.

**The app:** the landing page is at `/`. Pages use hash routes such as `#/sites`, `#/alerts` and `#/site` (crew's My site), with the sidebar as navigation. `npm run test:frontend` runs the pure-logic tests (routes, ranking, countdowns, design tokens). The UI tests for the redesign run against the mock backend with `PLAYWRIGHT_MODE=design npx playwright test`.

The site map uses MapLibre GL with the free OpenFreeMap "liberty" basemap (no API key; needs internet). Set `VITE_MAP_STYLE_URL` to use a different MapLibre style. If the basemap can't load, the map falls back to a plain ground with the site ring and hazard markers.

**Weather overlays** (Off / Rain / Wind / Temp, with an hourly scrubber) are off by default and request nothing until you turn one on. Turning one on frames the whole forecast area (about 300 km) and restores your view when you turn it off.

- _Rain, Radar_: live US radar from NOAA nowCOAST (about 2.5 hours, new frame every ~4 minutes). No key. US only.
- _Rain, Forecast / Wind / Temp_: the next 12 hours from [Open-Meteo](https://open-meteo.com/), drawn by the app as colour fields and animated wind streaks. No key. One request per site fetches a 9×7 grid (63 points) and is cached in the browser for an hour. The free API is **non-commercial only** (10,000 calls/day) and the data is CC BY 4.0, so keep the "Weather data by Open-Meteo.com" credit. A commercial launch needs an Open-Meteo plan.
- With reduced motion on, wind shows as still arrows instead of moving streaks.

| Local account             | Site access |
| ------------------------- | ----------- |
| `crew@planit.local`       | North Plant |
| `other@planit.local`      | South Plant |
| `supervisor@planit.local` | Both plants |
| `outsider@planit.local`   | None        |

All demo accounts use `CrewDemo123!`. The sign-in hints appear only when `VITE_LOCAL_DEMO=true`. Never load these identities into a production project or expose the local stack publicly.

## Verify

```sh
npm run test:functions       # Parsers, time zones, WBGT and lightning decoding. No network.
npm run verify:monitoring    # Lightning state machine and risk formula on the linked project, rolled back
npm run verify:rules         # Every rule, briefings and demo scenarios on the linked project, rolled back
npm test                     # Crew backend against the local stack (needs Docker)
npm run test:ui              # Browser flows (needs Docker and: npx playwright install chromium)
npm run build                # TypeScript and production bundle
npm run db:lint              # Application schemas (local stack)
npm run format:check
```

The `verify:` commands always roll back. A passing run ends with an error that starts "ALL ... CHECKS PASSED". Any other error means a check failed.

Other commands:

```sh
npm run types                # Regenerate src/database.types.ts from the local schema
supabase gen types typescript --linked > src/database.types.ts   # or from the hosted schema
npm run local:cleanup        # Delete unattached photo uploads older than one hour (local)
supabase stop                # Stop the local stack; data is kept
```

## Repository layout

| Path                      | Contents                                                            |
| ------------------------- | ------------------------------------------------------------------- |
| `supabase/migrations/`    | Database schema, RPCs, rules, and cron jobs, in order               |
| `supabase/functions/`     | Edge Functions and the shared parsing modules in `_shared/`         |
| `supabase/seed.sql`       | Fictional local demo data. Never use on a hosted project.           |
| `supabase/seed-sites.sql` | The 60 real plants, generated by `scripts/load-sites.mjs`           |
| `src/`                    | Crew reporting UI (Vite, React and TypeScript)                      |
| `tests/`                  | Backend and UI tests, function tests, and the hosted verify scripts |
| `docs/`                   | Contracts and the data source reference                             |
| `requirements.txt`        | Python packages for data work (not used by the backend)             |
| `.claude/skills/`         | Agent skills for this repository                                    |

## Crew reporting design

- A **report** is the current state of one hazard at one site. An **observation** is an immutable record of a submission, confirmation or resolution. Merging keeps the location and severity history for ML.
- Every mutation checks site membership. Row level security limits reads, and direct client writes are revoked. Privileged RPCs check membership explicitly and use a fixed empty `search_path`.
- A per-request lock makes retries idempotent. A per-site lock serializes duplicate searches, report updates and expiration, so two matching submissions cannot both insert.
- A request UUID belongs to one user and one input. A retry returns the first response. A changed input needs a new UUID.
- Photos use reservations and immutable private paths. The upload comes before the submission, and the database checks that the object exists.
- Expired reports stop counting in metrics immediately. A pg_cron job every 5 minutes records the resolution and creates in-app check-in reminders.

The pin picker is a MapLibre map over a street basemap (plus coordinate fields and "Use my location"). Distances use PostGIS geography in meters.

## Handoff

| Interface                                                     | Consumer                                |
| ------------------------------------------------------------- | --------------------------------------- |
| `submit_hazard_report`, `checkin_hazard_report`               | Crew reporting form and controls        |
| `reserve_hazard_photo` and the private `hazard-photos` bucket | Crew photo upload                       |
| `site_overview`                                               | Dashboard site ranking and map          |
| `alerts`, `lightning_state` (Realtime)                        | Crew alerts and the 30 minute countdown |
| `crew_hazard_feed`, `hazard_heatmap`                          | Dashboard heatmap and open hazards      |
| `update_crew_location`, `crew_locations_live`                 | Location sharing and live crew markers  |
| `briefings`, `mark_briefing_read`                             | Evening briefing inbox                  |
| `demo_inject`, `demo_reset`, `demo_generate_briefing`         | Demo control panel (supervisors)        |
| `crew_observation_feed`, `ml_scores`, `upsert_ml_scores`      | ML work                                 |
| `hazard_events` with `claim_hazard_events`                    | A future push or SMS dispatcher         |

Request and response shapes are in [the monitoring contract](docs/api-contract.md) and [the crew API](docs/crew-api.md).

## Open items

- Verify the heat tiers (82, 85, 88, 90 F) against TB MED 507. The WBGT value is an estimate and is not yet validated.
- Validate GOES GLM lightning against a ground network before crews rely on it. Blitzortung is not used because its terms forbid storm warning use.
- Read the terms of use of each data provider. None have been reviewed.
- `river_distance_m` is the distance to the nearest stream gauge. It is a rough measure of how close a plant is to a river.
- For larger deployments, measure the locking strategy, paginate long feeds, and define limits on confirmation abuse and data retention.

## Cited task safety checklists (pilot)

Site supervisors can save planned work, request a cited private draft, review evidence and gaps, and publish a crew checklist. Crew acknowledge the exact publication. Existing weather briefings, risk, live alerts and stop-work rules continue independently. Generation defaults off.

The supported pilot requires confirmed Florida/private-sector electrical operations and maintenance coverage; other or unknown coverage produces gaps. Worker instructions come from reviewed canonical source passages and require supervisor review.

Use `npm run dev:design` for the fictional supervisor-to-crew demo. `npm run safety:local:start` creates an isolated local stack; `npm run test:safety:db` checks access, citations, concurrency and lifecycle. `npm run test:safety:ui` runs browser demo checks.

See the [safety API](docs/safety-api.md), [safety contract](docs/safety-contract.md) and [setup and operations](docs/safety-operations.md) for integration, source review, provider configuration, verification and deployment.
