# Runbook: forecast and push to production

Step-by-step procedure for running the rutting forecast and sending its scores to the **production** (hosted)
`ml_scores` table. Read `PROJECT_BRIEF.md` first if you have not; it explains what the score means and why it is
uncalibrated. This file is the operational checklist.

`run_daily.sh` automates sections 4–7 below. It never applies to production unattended: the apply step always
shows a preview and then reads a typed project ref from the terminal. Section 1–2 are one-time setup.

## 1. What this does

Running the full procedure writes one score per site per horizon (`now`, `tomorrow`) to production `public.ml_scores`.
That score:
- raises that site's live risk to `max(ML score, hazard subscores) + crew term`, for every crew at the site;
- becomes the risk driver ("ML mud trafficability `<score>`") wherever it is the largest input;
- feeds the 6 PM local briefing's `predicted_risk` through the `tomorrow` row;
- raises no alerts;
- contributes to risk only while fresh: under 36 hours for `now`, under 48 hours for `tomorrow` (migration `20261018020000`); historical rows remain stored.

Run this once a day, before the 6 PM local briefing window, so `tomorrow`'s score reflects that day's forecast.
A supervisor or whoever owns this model should run it — not CI, and not unattended.

## 2. One-time machine setup

```sh
cd <repo root>
python3.11 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

**Supabase CLI.** Try Homebrew first:

```sh
brew install supabase/tap/supabase
```

If Homebrew asks for updated Xcode Command Line Tools and you would rather not install them, use the official
release binary instead (no sudo):

```sh
TAG=$(curl -fsSL https://api.github.com/repos/supabase/cli/releases/latest | python3 -c "import json,sys;print(json.load(sys.stdin)['tag_name'])")
curl -fsSLO "https://github.com/supabase/cli/releases/download/$TAG/supabase_darwin_arm64.tar.gz"   # or _amd64 on Intel
curl -fsSLO "https://github.com/supabase/cli/releases/download/$TAG/checksums.txt"
grep "darwin_arm64.tar.gz" checksums.txt   # check this SHA-256 against `shasum -a 256 supabase_darwin_arm64.tar.gz`
mkdir -p ~/.local/bin && tar -xzf supabase_darwin_arm64.tar.gz supabase && install -m 0755 supabase ~/.local/bin/supabase
```

`checksums.txt` lists the file under its versioned name (`supabase_<version>_darwin_arm64.tar.gz`); match the hash,
not the filename. Make sure `~/.local/bin` is on `PATH`.

**Log in and link**, from the repo root:

```sh
supabase login                               # opens a browser
supabase projects list                       # find the REFERENCE ID for ControlWard
supabase link --project-ref <project-ref>    # press Enter past the DB password prompt; not needed
```

Check it worked: `supabase db query --linked "select count(*) from public.sites"` should return 60.
`supabase/.temp/` (holding the link and your access token) is gitignored — never commit it.

## 3. One-time inputs: `prepare`

```sh
cd models/mud-trafficability
../../.venv/bin/python -m stram prepare
```

Caches SSURGO soils, 3DEP terrain/DTW and OSM routes per site, about 1–2 minutes each (the OSM fetch is the slow
part; Overpass allows roughly two concurrent requests per client, so don't run more than two `prepare` processes
at once). `prepare` skips sites it has already cached — safe to re-run or resume. Retry one failed site with
`prepare --eia <id>`. The cache lives in `cache/` (gitignored, several hundred MB for 60 sites).

## 4. Each run

```sh
cd models/mud-trafficability
./run_daily.sh
```

This runs, in order: unit tests, `prepare` (skips cached sites), `forecast`, `map`, a read-only preflight, then
`push --apply` (section 6), then the hosted verify scripts and a `site_risk` check (section 7). Flags:

| Flag | Effect |
|---|---|
| `--eia ID,ID,...` | Limit `prepare`/`forecast` to specific EIA plant ids (e.g. the demo trio `649,56407,6008`). |
| `--metric max\|p90` | Site score sent to production. Default `p90` (score exceeded by 10% of route length). `max` is the worst segment and runs hotter — see `PROJECT_BRIEF.md` → Decisions. |
| `--skip-prepare` | Skip `prepare` entirely (only if you already ran it recently and nothing has changed). |

Running the steps by hand instead of the script:

```sh
../../.venv/bin/python -m unittest discover -s tests
../../.venv/bin/python -m stram forecast
../../.venv/bin/python -m stram map
```

Sanity-check `output/LATEST`'s `map.html` before pushing: the uncalibrated-model banner is present, and on the demo
trio (Vogtle 649, West County 56407, Palo Verde 6008) West County shows far more flagged route than Palo Verde.

## 5. Before applying (read-only, no changes)

**(a) Check what is already in `ml_scores`**, so you know whether another model's rows would be overwritten
(`ml_scores` holds one row per site, horizon and model, primary-keyed on `(site_id, horizon, model)` — a push only
touches rows with this model's `model_version`, which maps to model `mud`):

```sh
cd <repo root>
supabase db query --linked --workdir "$PWD" --output-format json \
  "select model_version, horizon, count(*), min(score), max(score) from public.ml_scores group by 1,2 order by 1,2"
```

**(b) Estimate the live impact**, before committing to anything (read-only; adjust `score_p90` to `score` for
`--metric max`):

```sh
cd models/mud-trafficability
../../.venv/bin/python - <<'EOF'
from pathlib import Path
from stram import push
run = Path("output") / Path("output/LATEST").read_text().strip()
cli = push.supabase_cli()
scores = push.site_scores(run, "p90")
rows = push.query(cli, "select s.eia_plant_id as eia, s.name, r.horizon, r.risk::float as risk, "
                       "r.base::float as base, r.crew_term::float as crew, r.top_driver "
                       "from public.site_risk r join public.sites s on s.id = r.site_id")
for h in ("now", "tomorrow"):
    changed = [(min(10.0, max(r["base"], scores[(r["eia"], h)]) + r["crew"]) - r["risk"], r["name"])
               for r in rows if r["horizon"] == h and (r["eia"], h) in scores
               and scores[(r["eia"], h)] > r["base"]]
    print(h, "ML becomes the driver at", len(changed), "sites")
EOF
```

**(c) `push` writes SQL only, without applying anything:**

```sh
../../.venv/bin/python -m stram push --metric p90
```

## 6. Apply

```sh
../../.venv/bin/python -m stram push --metric p90 --apply
```

This shows a preview (project, run, row count, score spread, highest sites, production effects), then asks:

```
Type the project ref (<ref>) to apply to production:
```

Type the ref exactly to proceed, or press Ctrl-C (or anything else) to cancel — nothing is applied until it
matches. There is no unattended `--yes`; `--confirm <ref>` only skips the *prompt*, not the decision — pass it
only right after a human has read the preview for that specific project.

On success it prints the read-back counts and writes `output/run_<stamp>/applied.json`
(`{applied_at, project_ref, metric, rows_expected, rows_read_back, read_back}`).

## 7. Verify

The read-back inside `push --apply` already confirms the row counts. Also run, from the repo root:

```sh
npm run verify:monitoring
npm run verify:rules
```

Both roll back their own test data and **exit non-zero on success** — that is expected. Success looks like an
error whose message starts `ALL CHECKS PASSED` / `ALL RULE CHECKS PASSED`; any other error text is a real failure.

After the next `evaluate-all-sites` run (every 5 minutes), confirm `site_risk` picked up the scores:

```sh
supabase db query --linked --workdir "$PWD" --output-format json \
  "select horizon, count(*) filter (where top_driver like 'ML mud trafficability%'), count(*) \
   from public.site_risk group by horizon order by horizon"
```

## 8. Refresh and expiry

Scores remain stored, but after migration `20261018020000` they stop contributing to risk after 36 hours (`now`) or 48 hours (`tomorrow`). `push --apply` refuses a run older than 24 hours (`--allow-stale` to override,
not recommended). To keep production current, re-run section 4 daily. To stop influencing site risk without a
fresh run, clear (section 9).

## 9. Rollback

```sh
cd models/mud-trafficability
../../.venv/bin/python -m stram push --clear --apply
```

Same preview/confirm/read-back flow, deleting this model's rows from `ml_scores`. Site risk falls back to the
hazard subscores within 5 minutes. Re-check with the section 7 query (expect 0 `ML mud trafficability%` rows).

## 10. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `Supabase CLI not found on PATH` | Install it (section 2); make sure `~/.local/bin` or Homebrew's bin is on `PATH`. |
| `This checkout is not linked` | `supabase login && supabase link --project-ref <ref>` from the repo root. |
| `AccessTokenRequiredError` | Session expired; `supabase login` again. |
| `<run> is NN h old` | Run `forecast` again, or pass `--allow-stale` if you are sure the scores are still fit to use. |
| `sites are not in production public.sites` | The linked project's `sites` table doesn't match `supabase/seed-sites.sql`; confirm you linked the right project. |
| Overpass `HTTP 500` / `429` during `prepare` | Transient; retry just that site: `prepare --eia <id>`. |
| Homebrew asks for Xcode Command Line Tools | Use the release-binary install in section 2 instead. |
| `the read-back does not match` | Applied, but row counts/min/max differ from the preview — stop and inspect `public.ml_scores` directly before trusting production; do not blindly re-run. |
| `npm run verify:*` prints `ERROR: ... ALL CHECKS PASSED` | This is a pass — see section 7. Any other error text is a real failure. |

## 11. Reference: first production apply (2026-10-18)

- Project `zarkusdtiwdquimnplya`, run `run_2026-10-18T0327Z`, metric `p90`.
- 120 rows applied (60 sites × now/tomorrow), scores 2.2–6.5, 25 sites at 6.5.
- `site_risk` after the next cycle: ML was the driver at 57/60 sites (now) and 58/60 (tomorrow); risk rose by a
  median of +4.0 / +4.4.
- Both `verify:monitoring` and `verify:rules` passed.
