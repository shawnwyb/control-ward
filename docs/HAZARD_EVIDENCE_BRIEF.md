# Project brief: Hazard Index Backing Evidence & News Grounding

Status: agreed in interview; ready for implementation planning.

## Problem and intended outcome

The offline ML model in `models/hazard-index/` calculates a 0–10 Hazard Index per power plant site for today (`now`) and tomorrow (`tomorrow`), alongside the confounding event / hazard family that contributed most to the score (`top_driver`: flood, fire, storm, or heat).

While the score and driver are quantitative, supervisors and field crew operators need **qualitative backing evidence and verified local ground truth** (e.g. local flooding reports, river crests, road washouts, wildfire smoke advisories, severe storm incident news) nearby the power plant site to understand and trust why an elevated hazard index was flagged.

Intended outcome:
An end-to-end evidence grounding pipeline that:

1. Identifies plants where the Hazard Index or rule score is elevated (at Watch tier $\ge 3.0$ or higher) and inspects their main driver (`top_driver`).
2. Gathers the power plant site's geographic context (plant name, coordinates, county, state, and recent forecast metrics like precipitation, gust, or heat).
3. Uses Gemini with Google Search Grounding to search for recent news articles, reports, and advisories about that specific hazard near the site.
4. Stores structured backing evidence (summary text, article titles, publisher sources, links, snippets, timestamp) in both an offline JSON artifact and a Supabase database table (`hazard_evidence`).
5. Displays this backing evidence and clickable news articles directly in the supervisor and crew site dashboard alongside the Hazard Index and Main Driver.

## Users and use cases

- **Field Crew Supervisors & Crew Members**: When opening a site with an elevated Hazard Index (e.g., Flood 4.1 or Fire 4.1), see immediate backing news articles and weather event summaries confirming real-world conditions around the plant.
- **System Operators & Data Scientists**: Review offline evidence artifacts (`artifacts/evidence/`) generated during dry-runs to validate whether ML risk spikes correspond to real local incidents.

## Scope

### In scope

1. **Python Evidence Pipeline (`models/hazard-index/fetch_evidence.py`)**:
   - Reads the latest dryrun CSV (e.g. `artifacts/dryrun/ml_scores_*.csv`).
   - Filters for elevated sites (default: Hazard Index $\ge 3.0$ or rule maximum $\ge 3.0$).
   - Enriches site data with county, state, and NWS zone from `artifacts/sites_nws.json`.
   - Queries Gemini API with Google Search grounding (`tools: [{ google_search: {} }]`) using `GEMINI_API_KEY`.
   - Parses the synthesized summary and structured web grounding chunks (title, URL, source, publication date/snippet).
   - Writes `artifacts/evidence/evidence_<stamp>.json` and `.push.sql`.
   - Adds CLI support to `models/hazard-index/run.sh evidence` and `push.py`.

2. **Supabase Migration (`supabase/migrations/20261018030000_hazard_evidence.sql`)**:
   - Creates table `public.hazard_evidence`:
     - `site_id uuid references public.sites(id)`
     - `horizon text check (horizon in ('now', 'tomorrow'))`
     - `driver text check (driver in ('flood', 'fire', 'storm', 'heat'))`
     - `hazard_score numeric(3,1)`
     - `summary text`
     - `articles jsonb` (list of `{title, url, source, snippet, published_at}`)
     - `model_version text`
     - `queried_at timestamptz`
     - `primary key (site_id, horizon, driver)`
   - RLS policy: read access granted to site members via `private.is_site_member(site_id)`.
   - Security-definer RPC `public.upsert_hazard_evidence(p_batch jsonb)`.

3. **Frontend Dashboard Integration**:
   - `src/lib/monitoring.ts`: data fetcher `fetchHazardEvidence(siteId)`.
   - `src/features/dashboard/RiskPanel.tsx`: renders an expandable or highlighted "Backing Evidence & Local News" card when evidence exists for the site's top driver.
   - `src/dev/mockBackend.ts`: mock evidence data for design/demo mode.

4. **Testing & Verification**:
   - Python unit tests for prompt formatting, grounding response parsing, and fallback handling when no news is found.
   - SQL verification tests for `hazard_evidence` schema, RLS, and upsert RPC.
   - Frontend component tests / typecheck (`npm run build`).

### Out of scope

- Scraping arbitrary third-party paywalled websites directly.
- Overwriting or removing existing ML scoring models or rule engines.
- Retraining or altering the hazard index feature math.

## Technical constraints & integrations

- LLM Provider: Google Gemini (`gemini-2.5-flash` or `gemini-1.5-flash` with Google Search tool) using `GEMINI_API_KEY`.
- Language & Runtimes: Python 3.11 in `.venv`, Node 24 / Vite React TypeScript frontend, PostgreSQL 15 on Supabase.
- Graceful offline fallback: If `GEMINI_API_KEY` is not set or network is disabled, `fetch_evidence.py` can generate mock/dry-run evidence or report an explicit exit code without crashing.

## Acceptance criteria

1. Running `models/hazard-index/run.sh evidence` parses the dryrun CSV, identifies plants at $\ge 3.0$, and queries news/backing evidence for each plant's confounding driver.
2. The output JSON file contains valid news references (title, url, snippet) and a 2-3 sentence grounded summary.
3. `push.py` can upload the evidence to production `public.hazard_evidence` alongside `ml_scores`.
4. RLS prevents non-members from reading evidence for a site.
5. In the web dashboard (`RiskPanel.tsx`), when a site has backing evidence, the news reports and summary are displayed with clickable external links.
6. Design demo mode (`npm run dev:design`) displays realistic mock evidence.
