# Hazard Index (0–10): offline ML prototype

One calibrated model per hazard family predicts the probability that NOAA Storm Events records an event of that family near a plant on a local day. Each probability is multiplied by an OSHA severity weight, the largest product `R = max_h(s_h × p_h)` is kept, and `R` is mapped to 0–10 on the rule-subscore scale (about 3 watch, 7.5 warning, 10 stop work). `dryrun.py` scores today and tomorrow for the 60 plants from the live forecast and writes a CSV and an `upsert_ml_scores`-shaped payload. **Nothing here writes to a database, and nothing in `supabase/` or `src/` imports it.**

Brief: `docs/PROJECT_BRIEF.md`. Results: `notebooks/results.ipynb` and `artifacts/models/<version>/metrics.json`.

## Run order

Run from anywhere; every script finds its files relative to `models/hazard-index/`. Use the repository venv (`.venv/bin/python`, Python 3.11) after `pip install -r requirements.txt`.

```sh
cd models/hazard-index
../../.venv/bin/python -m unittest discover -s tests -t . -v   # unit tests (needs node for the parity test)

../../.venv/bin/python fetch_weather.py run          # day 1: 8,500 weighted calls, 2025 back to ~2020
../../.venv/bin/python fetch_weather.py status       # coverage and calls used
../../.venv/bin/python fetch_weather.py run --budget 9000   # day 2, after the daily quota resets: 2020-2015
../../.venv/bin/python fetch_storms.py               # NOAA Storm Events 2015-2025 (~120 MB)
../../.venv/bin/python fetch_sites.py                # NWS county and forecast zone per plant
../../.venv/bin/python build_dataset.py              # site_days.parquet + artifacts/labels_report.json (read it)
../../.venv/bin/python compute_severity.py           # artifacts/severity.json (+ the matched injuries)
../../.venv/bin/python train.py                      # artifacts/models/<version>/
../../.venv/bin/python evaluate.py                   # metrics.json + figures/
../../.venv/bin/python dryrun.py                     # artifacts/dryrun/ml_scores_<stamp>.csv + .payload.json (~220 calls)
../../.venv/bin/python dryrun.py --replay 2024-08-14 --plants 56407   # a past day, offline
```

From the repository root the test command is `.venv/bin/python -m unittest discover -s models/hazard-index/tests -t models/hazard-index -v`.

Exit codes for every script: 0 ok, 1 error, 2 blocked by network policy, 3 API quota used up (files already written are kept; run again later to continue).

## Layout

```
hazidx/            config.py (every tunable number, FEATURE_TIMING), paths.py, http.py (retries, quota, ledger,
                   manifests), sites.py, states.py, heat.py + localtime.py (copies of _shared/heat.ts and time.ts),
                   features.py, rules.py (copy of the rule subscores), labels.py, severity.py, model.py,
                   tiermap.py, plots.py
fetch_*.py, build_dataset.py, compute_severity.py, train.py, evaluate.py, dryrun.py
notebooks/results.ipynb   reads saved results only; never trains
tests/                    unittest; tests/gen_golden.mjs runs the live TypeScript for the parity test
cache/                    downloads and the data set (not committed, ~250 MB)
artifacts/                small committed results: sites_nws.json, labels_report.json, severity.json,
                          severity_matches.csv, models/<version>/, dryrun/
```

`model_version` is `hazidx-<package version>+<first>-<last training year>.<first 8 hex of bundle.joblib's SHA-256>`. `bundle.joblib` is a pickle: load only files this project built.

## How it works

**Labels** (`hazidx/labels.py`). An event matches a plant if its start-to-end track passes within 25 km (county events with coordinates), if it is in the plant's county (county events without coordinates), or if it is in the plant's NWS public forecast zone by code, or by a whole-word county name in the same state (zone events; guards against zone renumbering). Times are local standard time (`CZ_TIMEZONE`), converted to the plant's zone; every local date from start to end is marked, at most 14. Marine events are dropped (these files label them `CZ_TYPE='Z'`, not `'M'`, so the `Marine` event-type prefix is also used).

**Features** (`hazidx/features.py`). Hourly ERA5 → one row per plant and local day with the same conventions as the live system (local midnight to midnight, 23/25-hour DST days, overnight rain 18:00–06:00 inclusive, missing values as in `buildReadings`). No fixed site features (coordinates, soil, FEMA zone), so trees can split only on weather and season. `FEATURE_TIMING` in `config.py` marks each input `same_day` (a forecast at scoring time), `past` (observed) or `fixed`.

**Models** (`train.py`). Trees (`HistGradientBoostingClassifier`, at most 15 leaves, L2 5.0, learning rate 0.05, monotonic in WBGT/heat index, gust, and 24-hour/3-day rain) for heat, storm, flood; L2 logistic regression for fire. Settings chosen by log-loss on 2023 only. Platt calibration fitted on out-of-fold predictions from the training years (`GroupKFold` by year). A past-data-only twin of each model measures how much skill needs the forecast.

**Severity** (`hazidx/severity.py`). OSHA SIR injuries per Storm Events county-day or zone-day (NAICS 2211 and 237, federal-OSHA states, 2015-01 to 2025-11), shrunk toward the overall rate (Gamma-Poisson, prior of 5 injuries), on a log scale from 0.75 to 1.0.

**0–10 map** (`hazidx/tiermap.py`). Median out-of-fold `R` for each daily rule maximum seen on at least 50 training days, kept only while increasing, joined by straight lines from (0, 0) and extended to 10; fixed fallback points if fewer than 3 pairs survive or none reaches 7.5.

**Dry-run** (`dryrun.py`). One forecast request for all 60 plants (default model, 31 past days, 3 forecast days) plus the ECMWF endpoint for the 0–7 and 7–28 cm soil layers the archive has. `forecast_hours` counts the target-day hours still to come; `drift_flags` lists inputs outside the 0.5–99.5 percentile range of the training data; `rule_max_fc` is the highest heat/gust/rain/soil rule from the same forecast and `risk_preview = max(score, rule_max_fc)` (no crew term, NWS alerts, gauges, lightning or fire distance).

## Limitations

- Training data is reanalysis (weather that happened); live scoring uses forecasts. Offline scores are an upper limit on live skill, most of all for storm. Because live risk is `max(ML, rules)`, a forecast error can add false alarms but cannot hide a rule alert.
- The label is a *recorded* Storm Events event, not an injury. NWS offices record events at very different rates (most Florida offices record almost no Heat events), and no site feature is allowed to learn those habits.
- The zone-name rule matches every zone named after a very large western county (for example all "Okanogan" zones for Grand Coulee), so fire and heat labels there include events far from the plant. Long river floods are filed as month-long `Flood` records, so a plant near a flooding river (Union Power Station) has flood labels on many consecutive days.
- Severity weights for storm, flood and fire rest on very few injuries (flood on none, fire on one), so they mostly reflect the prior.
- `D_h` mixes county-days and zone-days. The complete fix (the NWS zone–county correlation file) is not in this build.
