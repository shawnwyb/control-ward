# Run PlanIT locally

Start here after cloning the repository. The main path uses the real application, agent and prediction code. The optional UI preview at the end uses fictional data.

All shell commands assume macOS, Linux, or a Linux shell in WSL, and start in the repository root unless a block explicitly changes directory.

## 1. Get the code

Install Git, Node.js 22+ and npm. Node 22.12 was verified; the repository's test and agent commands explicitly enable TypeScript stripping for that version. Then:

```sh
git clone https://github.com/shawnwyb/swamphacks2026.git
cd swamphacks2026
npm ci
```

Choose the setup you need:

| Goal                                                                          | Follow    | Additional requirements                                        |
| ----------------------------------------------------------------------------- | --------- | -------------------------------------------------------------- |
| Show the real app and existing results from the team's database               | Section 2 | Project's public connection settings and an assigned account   |
| Generate real safety checklists from your computer using an isolated database | Section 3 | Running Docker, Supabase CLI and your own Gemini configuration |
| Calculate real Hazard Index and mud predictions locally                       | Section 4 | Python 3.12 and internet access                                |
| Work on the UI without any backend                                            | Section 6 | None                                                           |

Running the frontend does not start the agent or prediction jobs. Sections 3 and 4 start those separately. You do not need to retrain models to use the committed Hazard Index model.

### Verification status

The October 18, 2026 check used macOS, Node 22.12, Python 3.12 and the team's hosted Supabase database. Both assigned roles could sign in and open the checklist and full report without browser errors. One real CodeAct run published four actions backed by two independently fetched sources. Hazard Index scoring, mud preparation/forecast/map generation and a West County full report also completed. The report's 62 Python tests, 19 frontend report tests, 28 frontend tests, 61 function tests and 50 mud tests passed. Both model/report parity runners initially failed on Node 22 because they omitted TypeScript stripping; that is fixed in the repository, and the affected tests passed on rerun.

The complete isolated setup in section 3 was **not rerun from a fresh database** during that check. The hosted agent used an authorized server credential and already deployed functions; it did not prove that cloning the repository supplies provider credentials or starts the local Edge server. A published checklist still had unavailable-source coverage notes and a stale forecast input. Check those separately from the checklist's overall current/stale state.

## 2. Real app with the team's hosted database

This is the shortest path for a presentation using real stored data. Ask the project owner for the public Supabase URL/anon key and a login assigned to the demonstration worksite. Public connection settings do not grant access to sites without a membership.

```sh
cp .env.example .env.local
```

Edit `.env.local`:

```dotenv
VITE_SUPABASE_URL=https://YOUR-PROJECT-REF.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR-ANON-PUBLIC-KEY
VITE_LOCAL_DEMO=false
```

Then:

```sh
npm run dev
```

Open <http://127.0.0.1:5173>, choose **Sign in** (or open <http://127.0.0.1:5173/#/sign-in> directly), sign in, and select the assigned worksite. Open **Next-day briefing** (supervisor) or **Tomorrow's briefing** (worker) for the automatic safety checklist. **Next-day report** is the separate full forecast/model report. On phones, open **Menu** to access navigation and the site selector. Both roles can read the safety checklist and expand its scope/citations. Supervisors also see research details. Acknowledge only a current version; a new version requires a new receipt.

This uses the hosted project's existing ingestion, saved predictions and checklist generation. It does not enable CodeAct or start a model job. The project owner must separately keep the CodeAct executor running and activate its queue mode; see [safety operations](safety-operations.md#start-against-the-real-database). A local frontend does not need Docker for this path.

If there are no assigned sites, ask the owner to add your account to the worksite. If a checklist is stale, follow live alerts and inspect generation status; do not present it as current. Demo-login credentials from the fictional preview are not a promise that those accounts exist on the hosted project.

For a connection check, run `npm run check:connection`. To also check an assigned account's login, membership and screen queries without embedding its password in shell history:

```sh
read -r CHECK_EMAIL
read -rs CHECK_PASSWORD
export CHECK_EMAIL CHECK_PASSWORD
npm run check:connection
unset CHECK_EMAIL CHECK_PASSWORD
```

Enter the email after the first command and password after the second; password input is hidden. These commands work in Bash and Zsh.

## 3. Real CodeAct agent with an isolated local database

This runs actual source research, Gemini calls, Python actions and citation validation. It uses local test identities with a real worksite's coordinates; it is not a production deployment or an employer-approved procedure. Provider calls may incur charges.

Install the Supabase CLI and start Docker. Keep the three long-running processes below in separate terminals. Run all commands from this checkout, not another copy of the repository.

### A. Start the database and frontend

```sh
SAFETY_LOCAL_DIR=/tmp/planit-local npm run safety:local:start
npm run safety:dev
```

Open <http://127.0.0.1:5173>. Local Studio is <http://127.0.0.1:55323>. The API is <http://127.0.0.1:55321>.

The script applies migrations and creates `.env.safety`; it preserves the shared stack and `.env.local`. A fresh local stack loads demo identities. It does not reset an existing database. The usual `npm run local:start` uses a different stack and rewrites `.env.local`, so use the safety commands consistently for this guide.

Local accounts:

| Role       | Email                     | Password       |
| ---------- | ------------------------- | -------------- |
| Supervisor | `supervisor@planit.local` | `CrewDemo123!` |
| Worker     | `crew@planit.local`       | `CrewDemo123!` |

Initially, these accounts have fictional North/South sites. They will receive access to the real-coordinate pilot below.

### B. Configure and serve the local Edge Functions

In a second terminal:

```sh
cp supabase/functions/safety.env.example .env.safety-functions
```

Edit that ignored file. Set:

- `SAFETY_AGENT_ENABLED=true`
- `GEMINI_API_KEY` to your provider key.
- `SAFETY_MODEL` to a supported model configured for this project.
- `SAFETY_RESERVED_USD_PER_TURN` to the project's conservative reservation for that model, including search/thinking/output.
- `SAFETY_MAX_SPEND_USD` to the per-run ceiling; the template uses `0.50`.
- `CRON_SECRET` to a locally chosen value, reused in the weather request below.

Ask the project owner for the model ID and budget settings if unsure. Hosted secret values are not downloaded by cloning the repository. See [server configuration](safety-operations.md#one-time-server-setup) for provider documentation and budget details. These values do not belong in `.env.local` or a `VITE_` variable.

```sh
SAFETY_LOCAL_DIR=/tmp/planit-local node scripts/safety/local-stack.mjs serve "$PWD/.env.safety-functions"
```

Leave this terminal running. It serves the model broker and weather ingestion locally; no function deployment or Supabase login is needed for this local path.

### C. Add one local pilot and load real weather

Open the **local** Studio at <http://127.0.0.1:55323> and its SQL Editor. Run the following there. Replace `YOUR_MODEL_ID` with exactly the `SAFETY_MODEL` value from `.env.safety-functions`.

```sql
insert into public.sites
  (name, latitude, longitude, timezone, eia_plant_id, utility, plant_type)
values
  ('West County Energy Center', 26.6986, -80.3747, 'America/New_York',
   '56407', 'Florida Power & Light Co', 'Natural Gas Fired Combined Cycle')
on conflict (eia_plant_id) do nothing;

insert into public.site_memberships (site_id, user_id, role)
select s.id, u.id,
  case when u.email = 'supervisor@planit.local'
       then 'supervisor' else 'crew' end
from public.sites s cross join auth.users u
where s.eia_plant_id = '56407'
  and u.email in ('supervisor@planit.local', 'crew@planit.local')
on conflict (site_id, user_id) do nothing;

update private.safety_settings
set model = 'YOUR_MODEL_ID', enabled = false, execution_mode = 'codeact';
```

In a third terminal, replace the header placeholder with your local `CRON_SECRET`, then fetch real weather:

```sh
curl --fail-with-body --request POST \
  http://127.0.0.1:55321/functions/v1/ingest-openmeteo \
  --header 'X-Cron-Secret: YOUR_LOCAL_CRON_SECRET'
```

Look for a successful ingestion response. Back in local Studio, enable generation and queue the pilot:

```sql
update private.safety_settings set enabled = true;
select public.enqueue_automatic_safety_checklists();
```

These SQL steps are one-time developer setup for a local database. Supervisors do not enter a job plan or generate/publish a checklist in the app.

### D. Run the local CodeAct executor

Still in the third terminal:

```sh
supabase status --workdir /tmp/planit-local -o env
```

Copy **`SERVICE_ROLE_KEY`** from this local status output, not `ANON_KEY`. Create ignored `.env.codeact.local`:

```dotenv
SUPABASE_URL=http://127.0.0.1:55321
SUPABASE_SERVICE_ROLE_KEY=YOUR-LOCAL-SERVICE-ROLE-KEY
```

Keep the browser's anon key in `.env.safety`; the executor needs the privileged local key. The URL and key must come from the same local stack.

```sh
chmod 600 .env.codeact.local
docker pull python:3.12-slim@sha256:a6e34c598f2467ed0e9a8d349809fcd8b5c603269512df273a0bb1784edc11b1
node --env-file=.env.codeact.local --experimental-strip-types scripts/safety/codeact/worker.mjs --once
```

A successful job prints `saved:true`, item/source counts and Python/tool counts. Inspect the content too: a successful job with zero items can legitimately mean sources were unavailable. An immediate exit with no job record means nothing was claimable; check the local queue, mode, enabled/model settings and retry availability.

For continuous local processing, leave this running instead:

```sh
node --env-file=.env.codeact.local --experimental-strip-types scripts/safety/codeact/worker.mjs
```

The database queues work each minute; the worker polls for CodeAct jobs. Local weather was fetched once above. Repeat that weather request when you need fresh readings; this guide does not configure continuous weather ingestion through Vault. New readings can invalidate an earlier checklist, which should become visibly stale until replaced.

### E. Verify both roles

1. Sign in to the frontend as the local supervisor, select **West County Energy Center**, and open **Next-day briefing**. Refresh the page if it was open before the membership insert.
2. Confirm the checklist appears automatically with no Generate/Publish step.
3. Inspect condition timestamps, current/stale state, the action titles, scope, exact quotes, official source links and coverage notes.
4. Sign out and repeat as the local worker, opening **Tomorrow's briefing**. Acknowledge the current checklist; expect **Receipt recorded**. Missing/expired guidance must not be acknowledged.
5. Inspect local Studio's `automatic_safety_runs` for state/errors and `automatic_safety_checklists` for the published content. Private action traces live in `private.safety_codeact_attempts`.

If a site shows no instructions, inspect the gaps. A blocked government page or unresolved jurisdiction is not proof that no regulation applies. Do not replace a failed live run with fictional results while describing it as live.

Stop the frontend, Edge server and worker with Ctrl+C. Stop the local Supabase stack with:

```sh
SAFETY_LOCAL_DIR=/tmp/planit-local npm run safety:local:stop
```

## 4. Run the real prediction models locally

These jobs are independent of the safety checklist. They calculate predictions and write local artifacts. Running them does not automatically put their new outputs into the browser's database.

From the repository root, install Python 3.12 and create the environment once. This version was verified with the current dependencies and committed model; the older Python 3.11 instructions were not exercised in that check. If `.venv` already exists, check `.venv/bin/python --version` before reusing it.

```sh
python3.12 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
```

Geospatial dependencies are required for the mud model. The committed Hazard Index model uses scikit-learn; use the version recorded in its `metadata.json` when loading the bundle if the installed version differs. See the model README for its version and assumptions.

Start with one plant, West County (`56407`):

```sh
models/hazard-index/run.sh score --plants 56407
```

This uses the committed trained model and live weather, writing CSV/payload files under `models/hazard-index/artifacts/dryrun/`. It does not train a model or write to Supabase. Historical replay requires a separately populated weather cache; a fresh clone is not enough for replay.

For the mud model:

```sh
cd models/mud-trafficability
../../.venv/bin/python -m stram prepare --eia 56407
../../.venv/bin/python -m stram forecast --eia 56407
../../.venv/bin/python -m stram map
cd ../..
```

Preparation downloads and caches soils, terrain and route data. It can take longer than scoring and may need retries if outside data services fail. Inspect `models/mud-trafficability/output/LATEST` to locate the latest output directory and its `map.html`.

To publish model results, follow the explicit project-selection/preview/apply steps in the [Hazard Index README](../models/hazard-index/README.md) and [mud runbook](../models/mud-trafficability/RUNBOOK.md). Their production apply commands target a linked hosted project; they are not part of the isolated local setup. In particular, `models/mud-trafficability/run_daily.sh` includes a production apply step, so do not use it merely to preview local predictions.

### Generate the full report shown in the app

After both models finish, run from the repository root:

```sh
reports/next-day/run.sh build --site 56407 --for today
```

This writes `public/reports/56407/<date>/report.json` and updates `public/reports/index.json`. Reload **Next-day report** for West County. Use `--for tomorrow` for the following day's report. External data fetches can take several minutes; inspect the report's gaps and input timestamps when it finishes. This report is independent of the automatic safety checklist in the briefing page.

If the report files are absent, the app shows **No report yet** even when database predictions or a safety checklist exist. Generated reports are local static files: a hosted frontend only includes files present when it builds. Generation also changes caches, output pointers and report indexes; inspect `git status` and select intended artifacts before committing. Model scores still require the separate database publishing steps above.

To check the report code:

```sh
npm run test:nextday
```

This runs both Node and Python tests and requires the repository `.venv`. Custom commands that import TypeScript on Node 22.12 must include `--experimental-strip-types`.

## 5. Prepare a real demonstration

Use section 2 for the app, or section 3 when demonstrating local generation. Calculate any model predictions ahead of the presentation and publish them through the model runbooks if the app should display them. Verify the selected worksite, output dates, ingestion timestamps, checklist freshness and source coverage before presenting.

Showing a previously generated real result is valid if you identify its timestamp and cache status. A fresh generation can show the research/execution loop, but it depends on network services and can fail or return limited evidence. Keep an earlier real result available with its timestamp; label any fictional UI fallback explicitly.

A worker launched in a terminal runs only while that process, Docker and the computer remain available. For continuous hosted operation, use a worker host with a restart policy as described in [safety operations](safety-operations.md#start-against-the-real-database). Hosting the frontend alone does not keep the agent or prediction jobs running.

## 6. Optional fictional UI preview

```sh
npm run dev:design
```

Open <http://127.0.0.1:5173/#/sign-in>. Sign in as `supervisor@planit.local` or `crew@planit.local` with `CrewDemo123!`, select North, and open the briefing page for its safety checklist. This uses browser-only fixtures: no real database, research, model execution or provider charges. It is useful for UI development and an explicitly labeled fallback, not proof of the AI pipeline.

## Troubleshooting

| Symptom                                            | Check                                                                                                                                                       |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frontend shows fictional content                   | Use `npm run dev` for the hosted database or `npm run safety:dev` for the local database; `dev:design` always uses fixtures.                                |
| No sites assigned                                  | Confirm membership in the database the frontend actually uses, then reload.                                                                                 |
| Local temporary links belong to another checkout   | Pick a new `/tmp/...` path and use it consistently with `SAFETY_LOCAL_DIR` and `supabase status --workdir`.                                                 |
| Worker waits silently                              | Check queued `execution_mode='codeact'` jobs, enabled/model settings and `available_at`; pipeline jobs are handled by a different worker.                   |
| Broker authorization error                         | Match `.env.codeact.local` URL/key to the local stack and keep the local Edge server running. An anon key cannot run the executor.                          |
| Provider/model/budget failure                      | Check local Edge configuration, matching SQL model ID, provider access and per-run budgets. The worker records bounded errors/retries.                      |
| Checklist stale or acknowledge disabled            | Refresh recorded conditions and let the worker generate a replacement; never bypass freshness checks.                                                       |
| Models run but new scores do not appear in the app | Scoring writes local files; publishing is a separate explicit step.                                                                                         |
| Full report says No report yet                     | Generate the selected site's report using section 4; include the report and index in a hosted build.                                                        |
| Tests fail with unknown file extension `.ts`       | Pull the parity-runner fixes; use the documented npm commands or explicitly enable Node TypeScript stripping.                                               |
| Checklist is current but an input says STALE       | Inspect that input's timestamp and source coverage. Refresh ingestion and inspect replacement runs; overall current status does not make every input fresh. |
| Port 5173 already used                             | Stop the other frontend or add `-- --port 5174 --strictPort` to the frontend npm command and open that port.                                                |

For implementation, verification and production operation details, see [safety operations](safety-operations.md), [Hazard Index](../models/hazard-index/README.md) and [mud operations](../models/mud-trafficability/RUNBOOK.md).
