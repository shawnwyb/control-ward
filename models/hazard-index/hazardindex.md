Hazard Index (0–10): offline ML prototype plan

 Summary

 We will build an offline Python prototype of the Hazard Index in models/hazard-index/. The prototype does four things:

 1. It trains one model for each hazard family. Each model predicts the probability that NOAA records a severe-weather event of that family near a plant on a given local day.
 2. It multiplies each probability by a severity weight from OSHA injury reports and keeps the largest product.
 3. It converts that product to a 0–10 score on the same scale as the existing rule subscores.
 4. It scores today and tomorrow for all 60 plants from the live weather forecast and writes the scores to a CSV file. It does not write to any database.

 Build time is under 12 hours. The historical weather download runs unattended over 2 days because of the free API quota.

 Context

 The SwampHacks brief (docs/PlanIT_Control_SwampHacks_Brief.docx) requires a "Hazard index (0-10): a machine learning (ML) model trained on historical weather and environmental data tied to the hazards on-site workers actually face."

 The hosted backend already has a place for this score:
 - The table ml_scores(site_id, horizon, score, model_version). horizon is now or tomorrow, and score is numeric(3,1) from 0 to 10.
 - The RPC upsert_ml_scores, which only the service role can call.
 - The risk formula in compute_site_risk (supabase/migrations/20261017001200_scheduling.sql): risk = min(10, max(ML score, highest subscore) + crew term). The ML score is 0 today because nothing writes it.

 docs/api-contract.md and README.m
 ├─────────────────┼──────────────────────────────────────────────────────────────────────────────────────────┤
 │ Mud             │ Covered only by input features (soil moisture, rain in the previous 3 and 7 days). No    │
 │                 │ mud label and no mud model. The STRAM trafficability model is out of scope               │
 ├─────────────────┼──────────────────────────────────────────────────────────────────────────────────────────┤
 │ How the         │ R = max over families h of (s_h × p_h), where p_h is the probability and s_h the         │
 │ families        │ severity weight. The family with the largest product is the top driver                   │
 │ combine         │                                                                                          │
 ├─────────────────┼──────────────────────────────────────────────────────────────────────────────────────────┤
 │ Severity weight │ OSHA injuries per Storm Events event-day for each family, adjusted toward the average    │
 │  s_h            │ when data is sparse, then converted on a log scale to a value from 0.75 to 1.0 (changed  │
 │                 │ in review from a linear ratio with a 0.5 floor)                                          │
 ├─────────────────┼──────────────────────────────────────────────────────────────────────────────────────────┤
 │ Calibration     │ Platt scaling for all families, fitted on out-of-fold predictions from the training      │
 │                 │ years (folds
 │ Delivery        │ Offline only: scripts, a results notebook, and a dry-run CSV. No migrations, Edge        │
 │                 │ Functions or database writes                                                             │
 ├─────────────────┼──────────────────────────────────────────────────────────────────────────────────────────┤
 │ Time budget     │ Under 12 hours of build time. Download wait time is not counted                          │
 └─────────────────┴──────────────────────────────────────────────────────────────────────────────────────────┘

 Definitions:
 - NOAA Storm Events: a database of severe-weather events that National Weather Service (NWS) offices recorded. Each event has a type, a time, and either coordinates, a county, or an NWS forecast zone.
 - ERA5: a reanalysis, which is a model reconstruction of past hourly weather on a grid of about 25 km. era5_seamless adds the finer ERA5-Land grid (about 10 km) where it exists.
 - OSHA SIR: OSHA Severe Injury Reports. Employers must report amputations, in-patient hospitalizations and eye losses.

    - Open-Meteo counts one call for each 2-week span per location, plus a fraction for each variable above 10.
 3. The archive has no CAPE. CAPE (convective available potential energy) measures thunderstorm potential. The storm model uses wind gusts, maximum hourly rain, pressure drop and solar radiation instead.
 4. The live forecast API has no soil_moisture_0_to_7cm, the soil layer that the archive provides. The ECMWF model endpoint of the forecast API does provide it. The dry-run uses that endpoint.
 5. Python environment:
    - .venv has Python 3.11 and pandas 3.0.6. scikit-learn is not installed.
    - Node v24 runs supabase/functions/_shared/heat.ts and time.ts directly, because these files have no imports and no enums. The parity test uses this.

 Step 0: save the brief

 Write docs/PROJECT_BRIEF.md with the sections that the interview skill requires:
 - problem and intended outcome

 hazidx/
   config.py      hazard families, 25 km radius, 14-day event cap, year splits, severity and tier settings,
                  FEATURE_TIMING (each feature marked same_day, past or fixed; see "Feature timing")
   paths.py       file locations
   http.py        retries and backoff copied from tide_fetch.py, plus quota detection and manifests
   sites.py       reads the 60 plants from seed-sites.sql (names contain commas and parentheses)
   heat.py        Python copy of _shared/heat.ts: wetBulbC, wbgtF, heatIndexF
   features.py    hourly weather -> daily features; used by both training and the dry-run
   rules.py       Python copy of the rule subscores in 20261017001000_rules_engine.sql
   labels.py      matches Storm Events to plants and local days
   severity.py    OSHA severity weights
   tiermap.py     converts the combined probability to 0-10
   model.py       trains, calibrat
 Reading the files:
 - Read dates and times from the integer columns, not from BEGIN_DATE_TIME, which has 2-digit years.
 - Remove marine events (CZ_TYPE='M').
 - Treat latitude or longitude 0 as missing.

 Matching an event to a plant. Storm Events records an event in one of three ways:
 - County event with coordinates. It matches if the line from its start point to its end point passes within 25 km of the plant. This catches a tornado track that crosses the plant even when both ends are far away.
 - County event without coordinates. It matches if its state and county code equal the plant's county.
 - Forecast-zone event. It matches if its zone code equals the plant's NWS forecast zone, or if it is in the same state and its zone name contains the plant's county name as a whole word.
   - The name rule protects against NWS renumbering zones over the years.
   - Fire-weather zones are never used, because their numbers differ from forecast-zone numbers.

 Assigning local days:
 1. Read the event's time zone from CZ_TIMEZONE (for example EST-5 or CST). Storm Events times are local standard time.
 - variables: temperature_2m, relative_humidity_2m, wind_speed_10m, wind_gusts_10m, shortwave_radiation, precipitation, soil_moisture_0_to_7cm, soil_moisture_7_to_28cm, pressure_msl
 - units: Fahrenheit, mph, mm
 - time zone: UTC

 Same calculations as the live system. Features use the same calculations as _shared/openmeteo.ts (buildReadings) and _shared/time.ts (zonedToUtc, localDate):
 - A local day runs from local midnight to the next local midnight. Days at daylight-saving changes have 23 or 25 hours.
 - "Overnight rain" covers 18:00 the previous day to 06:00, inclusive.
 - Missing values are handled the same way.

 Features by family:
would identify each plant. The model would then learn how often each NWS office reports events instead of how weather causes hazards. Without these features, the trees can split only on weather and season, so shallow trees cannot fit single plants (see "Models"). The rule baseline still uses FEMA zone and river distance.

 Limitation: training data is not forecast data.
 - The models learn from reanalysis, which is the weather that happened.
 - The dry-run gives them forecasts, which contain errors.
 - So offline scores are an upper limit on live performance.
 - Because the app uses max(ML, rules), a forecast error can only add false alarms. It cannot hide a rule alert.

 Feature timing: forecast inputs and past-data inputs

 Training uses only historical data. All inputs come from ERA5, the weather that happened. All labels come from Storm Events, which NOAA publishes months later. Labels are never used at scoring time.

 At scoring time, inputs fall into three groups:
 - Same-day inputs describe the tadrop
 (partly uses the previous day)
 Past-data inputs (observed at scoring): None
 Main signal: Same-day forecast
 Expected live reliability: Low. Forecasts place and time thunderstorms poorly. In training, gusts and hourly rain
 on event days are partly effects of the event itself
 ────────────────────────────────────────
 Family: Flood and mud
 Same-day inputs (forecast at scoring): 24-hour rain, hours with rain, overnight rain (observed for now after
 06:00, forecast for tomorrow)
 Past-data inputs (observed at scoring): rain in the previous 3 and 7 days; soil moisture (a forecast value, but it
 changes slowly and mostly reflectreliable at both horizons. They show the conditions, not the trigger: a single cloudburst or an ignition is not in them.
 4. The index takes the reliability of its driving family. Because R = max_h(s_h × p_h), the highest family sets the score.
    - On hot summer days heat usually drives the score, and heat is the most reliable family.
    - When storm drives a high tomorrow score, read it as "conditions favor storms", not "a storm is expected".
    - The dry-run CSV shows top_driver and all four probabilities, so a reader can see which family set the score.
 5. The ML index and the rules do different jobs.
    - The rules use current observations that the ML model does not have: lightning strikes, NWS alerts, river gauges and distance to active fires. They show what is happening now.
    - The ML index shows what the weather favors.
    - The live formula max(ML, rules) combines the two.

 How the build measures this:
 - Version 1 (day 1): the training years are the downloaded years up to 2022 (2021, 2022 and part of 2020).
 - Version 2 (after the backfill): the training years are 2015–2022. 2023 and the test years do not change, so the results stay comparable.

 Models:
 - Heat, storm, flood: gradient-boosted trees (HistGradientBoostingClassifier).
   - Fixed settings: max_leaf_nodes=15, l2_regularization=5.0, learning_rate=0.05.
   - min_samples_leaf: 30 or 50 for Version 1; 50 or 100 for Version 2.
   - max_iter: 150 or 300.
   - Choose among these 4 combinations by log-loss on 2023.
   - Monotonic constraints: the prediction can only rise as WBGT or heat index rises (heat), as gust speed rises (storm), and as 24-hour or 3-day rain rises (flood).
   - Why the trees cannot memorize plants: the inputs contain no plant identifiers, so the trees split only on weather and season. Each tree has at most 15 leaves of at least 30–100 days each.
 - Fire: logistic regression with L2 regularization. Fire has too few separate events for trees.

 Calibration: Platt scaling for al

 Metrics (on the test years 2024–2025):
 - ROC-AUC: the probability that the model ranks a random event day above a random non-event day.
 - PR-AUC: area under the precision-recall curve. It is more informative than ROC-AUC for rare events.
 - Brier score: the mean squared error of the probabilities. Brier skill score: the improvement over climatology; above 0 means better.
 - Reliability diagram: predicted probability against observed frequency.
 - Uncertainty ranges: resample plants 200 times.
 - For the combined index:
   - ROC-AUC for "any event"
   - a table of index tier against rule tier
   - escalation precision: on days when the index is more than 2 points above the rule maximum, the event rate compared with other days at the same rule tier. This shows whether the model adds information that the rules miss.
    s_h = 0.75 + 0.25 × (ln r_h − ln r_min) / (ln r_max − ln r_min)

    - r_min and r_max are the smallest and largest of the four rates.
    - The family with the highest rate gets 1.0, the lowest gets 0.75, and the others fall in between by log rate.
    - If all four rates are equal, every s_h is 1.0.
    - Also report a 90% interval for each rate.

 Why not max(0.5, r_h / max r): the denominator D_h mixes units.
 - NOAA records Thunderstorm Wind, Hail, Tornado and Flash Flood mostly by county (CZ_TYPE='C'). It records Heat, Wildfire and often Flood by forecast zone (CZ_TYPE='Z').
 - Counties and zones divide states differently.
 - Storm county-days probably outnumber heat zone-days by about 10 times. Step E measures this.
 - So r_heat will be much larger than r_storm and r_flood. A linear ratio with a 0.5 floor then acts as a switch: 1.0 for heat and 0.5 for everything else. That would halve the storm and flood probabilities because of a few noisy narrative matches.
 - The log scale limits the reduction to 25% and keeps the order of the families.

 2. Sort the pairs by rule maximum. Remove any pair whose median R is not larger than the previous kept pair's, so that R increases with the rule level. Report the removed pairs.
 3. Connect (0, 0) and the kept pairs with straight lines. Extend the last segment to 10.
 4. Round to 0.1 (half up) and limit to 0–10. This matches how Postgres stores numeric(3,1).

 Properties:
 - The map uses only predictions and rule levels, not event labels.
 - Because the map only increases, it does not change ROC-AUC.
 - No isotonic regression is used.

 Fallback: if fewer than 3 pairs are kept, or none is at 7.5 or above, use the fixed points (0, 0), (0.05, 3), (0.20, 7.5), (0.40, 10).

 Rejected alternative: quantile maevaluate_site uses.
 - A horizon with fewer than 20 hours of data is skipped, with a warning.

 Output CSV: 120 rows, 2 per plant.
 - The first four columns are exactly eia_plant_id, horizon, score, model_version.
 - Then:
   - site_name, local_date, top_driver
   - the raw combined value
   - the four family probabilities
   - key weather values
   - rule_max_fc: the highest of the heat, weather (gust), flood (rain) and soil rules, computed from the same forecast. These are the rules that the live engine can compute from Open-Meteo alone. Soil is included here because this column previews live risk. The 0–10 map leaves soil out (see "The 0–10 scale").
   - risk_preview = max(score, rul
 │    Test     │                                        What it checks                                        │
 ├─────────────┼──────────────────────────────────────────────────────────────────────────────────────────────┤
 │             │ tests/gen_golden.mjs runs _shared/heat.ts and time.ts in Node over a grid of temperature,    │
 │ Heat parity │ humidity, wind and sun values, and over daylight-saving dates in all 7 plant time zones. The │
 │             │  Python results must differ by less than 1e-9. The assertions in                             │
 │             │ tests/functions/shared.test.mjs are also copied.                                             │
 ├─────────────┼──────────────────────────────────────────────────────────────────────────────────────────────┤
 │             │ The TypeScript test fixture gives overnight rain 30 mm, gust 45 mph and WBGT above 85 °F.    │
 │ Features    │ Days of 23 and 25 hours work. Archive and forecast input give identical features for         │
 │             │ identical data.                                                                              │
 ├─────────────┼──────────────────────────────────────────────────────────────────────────────────────────────┤
 │ Rules       │ Boundaries at WBGT 82/85/88/90, heat index 90/103/125, rain 10/25/50/100 mm, gust 30/40/58   │
 │             │ mph and soil 0.30–0.45; flood multipliers; the cap at 10                                     │
 ├─────────────┼──────────────────────────────────────────────────────────────────────────────────────────────┤
 │ Labels      │ A small synthetic data set covers radius, tornado track, county, zone code, zone name,       │
 │             │ multi-day events, an EST-5 event that crosses midnight, marine rows, and the 14-day cap      │
 ├─────────────┼──────────────────

 Build order and time estimates

 Total: about 12 hours of build time. This is at the limit of the budget, so the cut list below matters.

 ┌─────┬───────────────────────────────────────────────────────────────────────────────────────────────┬───────┐
 │  #  │                                             Step                                              │ Hours │
 ├─────┼───────────────────────────────────────────────────────────────────────────────────────────────┼───────┤
 │ A   │ Project setup and sites.py with its test. fetch_weather.py with its test. Start the day-1     │ 1.25  │
 │     │ download: budget 8,500 calls, 2025 back to 2021 and part of 2020.                             │       │
 ├─────┼───────────────────────────────────────────────────────────────────────────────────────────────┼───────┤
 │ B   │ fetch_storms.py and fetch_sites.py; run both                                                  │ 0.75  │
 ├─────┼───────────────────────────────────────────────────────────────────────────────────────────────┼───────┤
 │ C   │ heat.py with the parity t
 1. uncertainty ranges
 2. the past-data-only models (keep the forecast_hours column; it is cheap)
 3. the quantile-matching comparison
 4. the settings grid
 5. --replay
 6. the "above normal" features
 7. the fitted scale (use the fixed points)
 8. the fire model (use climatology)
 9. the version 2 retrain (deliver version 1 and document why)

 Acceptance criteria

 1. All unit tests pass. Python and TypeScript heat and time calculations differ by less than 1e-9.
 2. site_days.parquet covers all 6
 - Estimated, not yet measured: the share of plant-days with an event.

 | Family | Estimated share of days |
 |--------|-------------------------|
 | storm  | 1–1.5%                  |
 | heat   | 0.5–2%                  |
 | flood  | 0.5–1%                  |
 | fire   | 0.1–0.3%                |
   Step D checks these numbers.

 Risks

 ┌──────────────────────────────────────────────┬─────────────────────────────────────────────────────────────┐
 │                     Risk                     │                         Mitigation                          │
 ├──────────────────────────────────────────────┼─────────────────────────────────────────────────────────────┤
 │ NWS offices report events at different       │                                                             │
 │ rates. Storm reports depend on
 ├──────────────────────────────────────────────┼─────────────────────────────────────────────────────────────┤
 │                                              │ Budget-aware, resumable download. A shared hackathon Wi-Fi  │
 │ The download quota runs out                  │ address can use up the quota early; use a phone hotspot if  │
 │                                              │ needed                                                      │
 ├──────────────────────────────────────────────┼─────────────────────────────────────────────────────────────┤
 │ Model files are Python pickles               │ Load only model files that this project built               │
 ├──────────────────────────────────────────────┼─────────────────────────────────────────────────────────────┤
 │ pandas 3 copy-on-write behavior              │ Do not use chained assignment                               │
 └──────────────────────────────────────────────┴─────────────────────────────────────────────────────────────┘

 Open questions

 1. What contact information goes in the NWS User-Agent header? Default: a generic project string.
 2. Who runs the day-2 backfill do
 All numbers in this appendix are invented to show the format. They are not results. Plant names, IDs and time zones are real (from seed-sites.sql).

 A. Severity weights (artifacts/severity.json, excerpt)

 ┌────────┬────────────┬──────────────┬───────────────┬──────────┐
 │ Family │ Injuries N │ Event-days D │ Shrunk rate r │ Weight s │
 ├────────┼────────────┼──────────────┼───────────────┼──────────┤
 │ heat   │ 234        │ 18,900       │ 0.01230       │ 1.000    │
 ├────────┼────────────┼──────────────┼───────────────┼──────────┤
 │ fire   │ 0          │ 5,200        │ 0.00054       │ 0.816    │
 ├────────┼────────────┼──────────────┼───────────────┼──────────┤
 │ flood  │ 3          │ 41,000       │ 0.00018       │ 0.751    │
 ├────────┼────────────┼──────────
 wrote artifacts/dryrun/ml_scores_20261017T220000Z.payload.json (120 rows)

 CSV excerpt (8 of 120 rows; model_version and some columns omitted):

 eia_plant_id: 56407
 site_name: West County Energy Center
 horizon: now
 local_date: 2026-10-17
 score: 2.8
 top_driver: storm
 p_heat: 0.020
 p_storm: 0.030
 p_flood: 0.010
 p_fire: 0.001
 rule_max_fc: 2.0
 risk_preview: 2.8
 forecast_hours: 6
 horizon: now
 local_date: 2026-10-17
 score: 4.1
 top_driver: heat
 p_heat: 0.040
 p_storm: 0.010
 p_flood: 0.002
 p_fire: 0.002
 rule_max_fc: 3.0
 risk_preview: 4.1
 forecast_hours: 7
 drift_flags:
 ────────────────────────────────────────
 eia_plant_id: 3470
 p_flood: 0.000
 p_fire: 0.004
 rule_max_fc: 0.0
 risk_preview: 0.8
 forecast_hours: 9
 drift_flags: sm07_mean<p0.5
 ────────────────────────────────────────
 eia_plant_id: 6008
 site_name: Palo Verde
 horizon: tomorrow
 local_date: 2026-10-18
 score: 0.9
 top_driver: heat
 p_heat: 0.006
 p_storm: 0.002
 p_flood: 0.000
 p_fire: 0.004
 ────────────────────────────────────────
 eia_plant_id: 6163
 site_name: Grand Coulee
 horizon: tomorrow
 local_date: 2026-10-18
 score: 3.4
 top_driver: storm
 p_heat: 0.000
 p_storm: 0.040
 p_flood: 0.003
 p_fire: 0.001
 rule_max_fc: 6.0
 risk_preview: 6.0
 forecast_hours: 24
   {"eia_plant_id": "56407", "horizon": "tomorrow", "score": 4.0, "model_version": "hazidx-0.1.0+2020-2022.3f9a1c2e"}
 ]

 D. Replay of an August day at West County Energy Center (the brief's scenario)

 dryrun.py --replay 2024-08-14 uses ERA5 data only, so forecast_hours is 0 for both rows.

 ┌─────────────────────────┬──────────────────────┬───────────────────────┐
 │                         │   now (2024-08-14)   │ tomorrow (2024-08-15) │
 ├─────────────────────────┼──────────────────────┼───────────────────────┤
 │ max WBGT                │ 89.6 °F              │ 88.7 °F               │
 ├─────────────────────────┼──────────────────────┼───────────────────────┤
 │ max heat index          │ 112 °
 │ fire: p × s (0.82)      │ 0.001 × 0.82 = 0.001 │ 0.001 × 0.82 = 0.001  │
 ├─────────────────────────┼──────────────────────┼───────────────────────┤
 │ R (largest product)     │ 0.210 (heat)         │ 0.170 (heat)          │
 ├─────────────────────────┼──────────────────────┼───────────────────────┤
 │ Hazard Index            │ 8.8                  │ 8.1                   │
 ├─────────────────────────┼──────────────────────┼───────────────────────┤
 │ rule_max_fc             │ 7.5 (WBGT ≥ 88 °F)   │ 7.5                   │
 ├─────────────────────────┼──────────────────────┼───────────────────────┤
 │ risk_preview            │ 8.8                  │ 8.1                   │
 └─────────────────────────┴──────────────────────┴───────────────────────┘

 Here the ML index is above the rule maximum: heat, a week of rain and building storms all raise the probabilities at the same time.

 E. Test metrics (metrics.json, excerpt)

 {
   "model_version": "hazidx-0.1.0+2020-2022.3f9a1c2e",
   "years": {"train": [2020, 2021, 2022], "model_selection": [2023], "test": [2024, 2025],
             "calibration": "Platt, out-of-fold, GroupKFold by year, 3 folds",
             "tier_map": "out-of-fold predictions, training years"},
   "families": {
     "heat":  {"pr_auc": {"full": 0.41, "past_only": 0.18, "climatology": 0.12, "rule": 0.33},
               "roc_auc": {"full": 0.93, "past_only": 0.84}, "brier_skill": {"full": 0.27, "past_only": 0.08},
               "forecast_dependent_share": 0.79},
     "storm": {"pr_auc": {"full": 0.22, "past_only": 0.06, "climatology": 0.05, "rule": 0.15},
               "roc_auc": {"full": 0.86, "past_only": 0.66}, "brier_skill": {"full": 0.12, "past_only": 0.01},
               "forecast_dependent_share": 0.94},
     "flood": {"pr_auc": {"full": 0.19, "past_only": 0.11, "climatology": 0.06, "rule": 0.12},
               "roc_auc": {"full": 0.88, "past_only": 0.79}, "brier_skill": {"full": 0.10, "past_only": 0.04},
               "forecast_dependent_share": 0.62},
     "fire":  {"pr_auc": {"full": 0.05, "past_only": 0.045, "climatology": 0.03, "rule": null},
               "roc_auc": {"full": 0.78, "past_only": 0.76}, "brier_skill": {"full": 0.01, "past_only": 0.01},
               "forecast_dependent_share": 0.25}
   },
   "index": {"roc_auc_any_event": 0.84, "rule_max_roc_auc_any_event": 0.77,
             "escalation": {"days": 412, "event_rate": 0.19, "same_rule_tier_event_rate": 0.08}}
 }

 How to read it:
 - Storm: 94% of its skill above climatology needs same-day forecast inputs, and storm forecasts are weak. So a storm-driven tomorrow score is the least reliable.
 - Fire: most of its small skill comes from past dryness, so its score is stable but weak.
 - Escalation: on the 412 test days when the index was more than 2 points above the rule maximum, events happened on 19% of days. On other days at the same rule tier, they happened on 8%.