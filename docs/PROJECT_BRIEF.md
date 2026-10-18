# Project brief: Hazard Index (0–10), offline ML prototype

Status: agreed in the design interview; built in `models/hazard-index/`. Design, run order and measured results: `models/hazard-index/README.md`.

## Problem and intended outcome

The SwampHacks brief (`docs/PlanIT_Control_SwampHacks_Brief.docx`) requires a "Hazard index (0-10): a machine learning (ML) model trained on historical weather and environmental data tied to the hazards on-site workers actually face."

The hosted backend already has a place for this score: the table `ml_scores(site_id, horizon, score, model_version)` (`horizon` is `now` or `tomorrow`, `score` is `numeric(3,1)` from 0 to 10), the service-role RPC `upsert_ml_scores`, and the risk formula `risk = min(10, max(ML score, highest subscore) + crew term)` in `compute_site_risk`. Nothing writes `ml_scores` today, so the ML score counts as 0.

Intended outcome: an offline prototype that
1. trains one model per hazard family to predict the probability that NOAA Storm Events records an event of that family near a plant on a local day;
2. multiplies each probability by an OSHA severity weight and keeps the largest product, `R = max_h(s_h × p_h)`;
3. maps `R` to a 0–10 score on the same scale as the rule subscores (about 3 watch, 7.5 warning, 10 stop work);
4. scores today and tomorrow for all 60 plants from the live forecast and writes a CSV and an `upsert_ml_scores`-shaped payload file, without writing to any database.

## Users and use cases

- Judges and supervisors who watch the demo: see a 0–10 index per plant for today and tomorrow, which family drives it, and how it compares with the rule engine.
- Teammates who integrate it later: take the payload file (or the scoring code) and send it to `upsert_ml_scores`; read `metrics.json` to know how far to trust each family.

## Scope

In scope:
- Hazard families: heat; storm (Thunderstorm Wind, Hail, Lightning, Tornado); flood (Flash Flood, Flood, Heavy Rain); fire (Wildfire, Dense Smoke).
- The 60 plants in `supabase/seed-sites.sql`, years 2015–2025.
- Mud is covered only by input features (soil moisture, rain in the previous 3 and 7 days).
- Scripts, unit tests, a results notebook, a dry-run CSV and payload file.

Out of scope:
- Migrations, Edge Functions, database writes, and any change in `supabase/` or `src/`.
- A mud label or mud model (the STRAM trafficability model is separate work).
- Converting forecast-zone events to counties with the NWS zone–county correlation file.

## Functional requirements

1. Labels: an event matches a plant if its start-to-end track passes within 25 km (county events with coordinates), if it is in the plant's county (county events without coordinates), or if it is in the plant's NWS forecast zone by code, or by a whole-word county name in the same state (zone events). Every local date from start to end is marked, at most 14 days.
2. Features: daily values from hourly ERA5 (`era5_seamless`), computed with the same conventions as `_shared/openmeteo.ts` and `_shared/time.ts`; no fixed site features, so the model cannot memorize the 60 plants.
3. Models: gradient-boosted trees with monotonic constraints for heat, storm and flood; L2 logistic regression for fire; Platt calibration on out-of-fold predictions grouped by year.
4. A past-data-only model per family and a `forecast_hours` column in the dry-run, to measure how much of the skill needs an accurate forecast.
5. Severity weights: OSHA injuries per event-day (NAICS 2211 and 237, federal-OSHA states), shrunk toward the overall rate, on a log scale from 0.75 to 1.0.
6. The 0–10 map from out-of-fold training predictions against the daily rule maximum, with a fixed-point fallback.
7. Dry-run: 120 rows (2 per plant), payload fields exactly `eia_plant_id, horizon, score, model_version` (or `site_id` with `--site-map`); `--replay` scores a past day offline.

## Technical constraints

- Python 3.11 in `.venv`, pandas 3 (no chained assignment), scikit-learn ≥ 1.5, Node 24 for the TypeScript parity test.
- Open-Meteo free tier: 600 calls a minute, 5,000 an hour, 10,000 a day; the 2015–2025 download costs about 17,000 weighted calls and takes 2 days.
- Under 12 hours of build time; download wait time is not counted.
- Every script finds its files relative to its own location and works from any working directory.

## Data and privacy

Public data only: Open-Meteo (ERA5 archive and forecast), NOAA Storm Events, NWS zone lookups, OSHA Severe Injury Reports, EIA-860M plant data. No personal data beyond what OSHA publishes in its injury narratives; `artifacts/severity_matches.csv` keeps the narratives but not the employer names. Open-Meteo's free tier is for non-commercial use.

## Acceptance criteria

1. All unit tests pass; Python and TypeScript heat and time calculations differ by less than 1e-9.
2. `site_days.parquet` covers all 60 plants for every downloaded year; `labels_report.json` shows events for every family in every year.
3. On the test years 2024–2025, the heat, storm and flood models each have a higher PR-AUC than climatology and a Brier skill score above 0. Fire and any failed criterion are reported as measured.
4. `evaluate.py` writes `metrics.json` and figures; the index ROC-AUC for "any event" and the escalation precision appear next to the rule baseline.
5. `dryrun.py` writes 120 rows with scores from 0 to 10 at 0.1 precision, the exact payload fields and a valid `model_version`, using about 220 API calls; `--replay` scores a past day offline.
6. The notebook runs from start to end using saved results only, and includes the West County Energy Center August case study.
7. Nothing in `supabase/` or `src/` changes, and nothing writes to a database.
8. Calibrators and the 0–10 map are fitted only on out-of-fold training predictions; 2023 is used only to choose settings; `metadata.json` records which years each step used.
9. `metrics.json` reports, per family, the test ROC-AUC, PR-AUC and Brier skill score of the full and the past-data-only model; the dry-run CSV has `forecast_hours`.

## Assumptions, dependencies and risks

- A Storm Events record stands in for "a hazard crews would face"; the model predicts a recorded event, not an injury.
- The storm, flood and fire severity weights rest on very few injuries (flood and fire on 0–1), so they mostly reflect the prior; the 0.75–1.0 range limits their effect to a 25% reduction.
- Models learn from reanalysis (weather that happened) and are scored on forecasts, so offline scores are an upper limit on live skill. Because the app uses `max(ML, rules)`, a forecast error can add false alarms but cannot hide a rule alert.
- NWS offices report events at different rates (population, spotters, regional heat criteria); zone renumbering and event-type renames are handled by zone-name matching and the heat pattern.
- The zone-name rule also matches far-away zones in very large western counties (for example all "Okanogan" zones for Grand Coulee), which inflates their fire and heat labels.
- `D_h` mixes county-days and zone-days, which inflates the heat rate relative to the others.
- Model files are Python pickles: load only the ones this project built.

## Open questions

1. What contact information goes in the NWS User-Agent header? Default: a generic project string.
2. Who runs the day-2 backfill download?
3. Should `bundle.joblib` be committed if it is larger than 10 MB, or only its metadata?
4. For later integration: should `compute_site_risk` name the ML hazard family in `top_driver`? This needs a SQL change.
5. Open-Meteo's free tier is non-commercial; a commercial product needs a paid plan.
