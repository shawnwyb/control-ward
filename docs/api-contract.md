# Monitoring API contract

Everything runs inside Supabase. pg_cron calls Edge Functions with a shared secret; the functions fetch outside data and call worker RPCs with the service-role key; Postgres applies the rules and writes scores and alerts. Clients use the anon key plus the user's JWT and read tables with RLS, or call the client RPCs. Types are in `src/database.types.ts` (`supabase gen types typescript --linked`). There is no ML in this layer: `ml_scores` is optional and counts as 0 when empty.

## Data flow

```
pg_cron -> pg_net -> Edge Function -> ingest_readings / ingest_strikes -> evaluate_all_sites()
                                                                              |
   readings, lightning_strikes -> evaluate_site -> site_subscores, alerts, site_risk -> Realtime -> clients
pg_cron -> sweep_lightning (1 min), evaluate_all_sites (5 min), generate_due_briefings (hourly)
```

## Schedule

| Job                       | Schedule        | What                                                      |
| ------------------------- | --------------- | --------------------------------------------------------- |
| `invoke-ingest-lightning` | every minute    | NOAA GOES-East GLM flashes -> `ingest_strikes`            |
| `lightning-sweep`         | every minute    | clears a site 30 minutes after its last strike            |
| `invoke-ingest-openmeteo` | `2-59/15`       | heat, soil, rain and weather for all sites in one request |
| `invoke-ingest-nws`       | `7-59/15`       | NWS alert severity and flood warnings                     |
| `invoke-ingest-gauges`    | `12-59/15`      | river stage and flood stage (NOAA NWPS, USGS fallback)    |
| `invoke-ingest-wildfire`  | `1,31`          | active fires from NIFC WFIGS                              |
| `evaluate-all-sites`      | every 5 min     | recompute subscores, alerts, risk                         |
| `generate-due-briefings`  | hourly at :00   | briefing for sites whose local hour is 18                 |
| `crew-hazard-maintenance` | every 5 min     | hazard expiry and check-in reminders                      |
| `prune-monitoring-data`   | daily 04:17 UTC | drops readings older than 5 days, strikes older than 7    |

## Edge Functions

All require header `X-Cron-Secret` (Vault `cron_secret`, function secret `CRON_SECRET`); anything else gets 401. `verify_jwt` is off for these functions only. Each returns `{ ok, function, ... }` and then runs `evaluate_all_sites()`.

| Function           | Source                                 | Notes                                                                                                         |
| ------------------ | -------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `ingest-openmeteo` | Open-Meteo                             | WBGT is an approximation (see heat below), live values plus daily forecast for the next two local days        |
| `ingest-nws`       | api.weather.gov                        | per site; a failed site keeps its previous reading (expires after 3 h)                                        |
| `ingest-gauges`    | NOAA NWPS, then USGS                   | uses `sites.usgs_gauge_id`                                                                                    |
| `ingest-wildfire`  | NIFC WFIGS                             | writes `nearest_fire_mi = 999` when no active fire is known, so cleared fires replace old readings            |
| `ingest-lightning` | NOAA GOES GLM (`LIGHTNING_SOURCE=glm`) | optical flash detections, good-quality flag only. Blitzortung is not used: its terms forbid storm-warning use |

GLM covers the Americas from GOES-East. Detection is optical, so heavy cloud or sun glint can change accuracy; confirm before relying on it for real crews.

## Reading conventions

`ingest_readings` rows are identified by `(site_id, hazard, unit, observed_at, forecast_for, source)`. Omit `forecast_for` for live values. Forecast rows are one value per local day, stamped at local noon.

| hazard   | unit                                                                | meaning                                              |
| -------- | ------------------------------------------------------------------- | ---------------------------------------------------- |
| weather  | `temp_f`, `wind_gust_mph`, `precip_prob_pct`                        | current hour, or daily max when forecast             |
| weather  | `nws_alert_severity`                                                | 0-4 (Minor 1, Moderate 2, Severe 3, Extreme 4)       |
| heat     | `wbgt_f`, `heat_index_f`                                            | current hour, or daily max when forecast             |
| flood    | `precip_mm_overnight`                                               | rain in the latest 18:00 to 06:00 local window       |
| flood    | `precip_mm_24h`                                                     | rolling 24 h total, or the daily total when forecast |
| flood    | `gauge_stage_ft`, `gauge_flood_stage_ft`, `nws_flood_warning` (0/1) | river state                                          |
| soil     | `soil_moisture_frac`                                                | 0-1, top layer                                       |
| wildfire | `nearest_fire_mi`, `fires_within_25mi`                              |                                                      |

Live readings are used while newer than 3 hours (overnight rain 18 h, soil and wildfire 6 h, flood stage 3 days).

## Rules (`evaluate_site`)

| Hazard    | Alert                                                                                                                                                                                                                       | Subscore                                                                                                                              |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Heat      | WBGT 82 `info`, 85 and 88 `warning`, 90 `stop_work`. Heat index 103 `warning`, 125 `stop_work` only when no WBGT exists                                                                                                     | max of the WBGT tier and heat index tier: 3 / 5 / 7.5 / 10                                                                            |
| Flood     | `warning` when (riverside and overnight rain >= 25 mm), or gauge at or above flood stage, or an NWS flood warning. Riverside = gauge within 5 km, SFHA zone (A, AE, AH, AO, AR, A99, V, VE), or stage at 80% of flood stage | rain or stage score, times 1.3 for an SFHA zone and 1.2 within 5 km of a gauge (0.8 beyond 25 km); modifiers never raise it from zero |
| Wildfire  | `warning` within 25 mi, `stop_work` within 5 mi                                                                                                                                                                             | 10 / 8 / 6 / 3 / 1 at 5 / 10 / 25 / 50 / 100 mi                                                                                       |
| Weather   | `other` `warning` at NWS severity 3+ or gusts 40+ mph                                                                                                                                                                       | severity x 2 (max 8), gusts 30 / 40 / 58 mph -> 3 / 6 / 9                                                                             |
| Soil      | none                                                                                                                                                                                                                        | saturation 0.30 / 0.35 / 0.40 / 0.45 -> 2 / 4 / 6 / 8                                                                                 |
| Lightning | managed by `ingest_strikes` and `sweep_lightning`                                                                                                                                                                           | 10 while `stop_work`, 4 for a strike within 25 mi in the last hour                                                                    |
| Wildlife  | none                                                                                                                                                                                                                        | `crew_metrics.wildlife_subscore`                                                                                                      |

**Open items:** the WBGT tiers follow US military heat categories and are not yet checked against TB MED 507. WBGT itself is a simplified estimate (Stull wet bulb plus a solar and wind adjustment), not the Liljegren model. Both must be validated before real go/no-go use.

Alerts: one active row per `(kind, site)` (`dedup_key = '<kind>:<site_id>'`). Level and payload change in place; the row is set to `cleared` when the condition ends. Lightning is `kind = 'lightning'`; the generic weather alert uses `kind = 'other'`.

`top_driver` is the two largest non-zero subscores in plain words, for example "Driven by WBGT 89°F and saturated soil".

### Risk

`risk = min(10, base + crew)`. Now: `base = max(ML score, worst subscore)`. Tomorrow: `base = max(ML score, forecast heat/flood/weather, current wildfire and soil)`. `crew` is `crew_risk_term` (cap 2). Stored in `site_risk` for horizons `now` and `tomorrow`.

### Lightning

A strike within 10 mi (16093.44 m) and no older than 30 minutes sets `lightning_state.status = 'stop_work'`, raises `last_strike_at` (never backward) and updates the one active lightning alert, so Realtime delivers the countdown reset. `sweep_lightning()` clears it 30 minutes after the last strike. Duplicate strikes (same source, time and coordinates) are ignored. Clients compute the countdown from `payload.clear_at`.

### Briefing

For each site whose local clock is in the 18:00 hour, one `briefings` row per local date: `{ tz, hazards: [{ hazard, metric, forecast, unit, level }], predicted_risk, top_driver, open_crew_hazards: [...], smoke_note }`, for the next local day.

## Worker RPCs (service role)

| RPC                                                                   | Request                                                                                                                | Response                                                                                                 |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `ingest_strikes(p_batch)`                                             | `[{ lat, lon, struck_at, source? }]`, max 5000                                                                         | `{ strikes, sites_in_range: [{ site_id, distance_mi, last_strike_at, countdown_reset }], crew_exposed }` |
| `ingest_readings(p_batch)`                                            | `[{ site_id, hazard, value, unit, observed_at, forecast_for?, source? }]`, max 10000; repeats in a batch keep the last | `{ inserted, updated }`                                                                                  |
| `evaluate_site(p_site_id)`, `evaluate_all_sites()`                    |                                                                                                                        | `{ site_id, top_driver, risk }`, `{ evaluated, failed }`                                                 |
| `compute_site_risk(p_site_id, p_tomorrow_worst?, p_tomorrow_driver?)` |                                                                                                                        | `{ site_id, risk: [{ horizon, risk }] }`                                                                 |
| `upsert_ml_scores(p_batch)`                                           | `[{ site_id, horizon, score, model_version }]`                                                                         | `{ upserted }` (kept for the ML work)                                                                    |
| `generate_due_briefings()`                                            |                                                                                                                        | `{ sites, briefing_ids }`                                                                                |
| `sweep_lightning()`, `prune_monitoring_data()`                        |                                                                                                                        | counts                                                                                                   |

## Client RPCs (authenticated)

| RPC                                                                                              | Request                                      | Response                                                           |
| ------------------------------------------------------------------------------------------------ | -------------------------------------------- | ------------------------------------------------------------------ |
| `update_crew_location`                                                                           | `{ p_site_id, p_lat, p_lon, p_accuracy_m? }` | `{ ok, exposed_alerts: [{ alert_id, kind, level, distance_mi }] }` |
| `acknowledge_alert`                                                                              | `{ p_request_id, p_alert_id }`               | `{ ok, acknowledged_at }`                                          |
| `mark_briefing_read`                                                                             | `{ p_briefing_id }`                          | `{ ok }`                                                           |
| `demo_inject` (supervisor)                                                                       | `{ p_scenario, p_site_id, p_params? }`       | `{ ok, injected, result }`                                         |
| `demo_reset` (supervisor)                                                                        | `{ p_site_id }`                              | `{ ok, deleted_rows }`                                             |
| `demo_generate_briefing` (supervisor)                                                            | `{ p_site_id }`                              | `{ ok, briefing_id }`                                              |
| `submit_hazard_report`, `checkin_hazard_report`, `reserve_hazard_photo`, `get_site_crew_metrics` | see `docs/crew-api.md`                       |                                                                    |

Demo scenarios (rows are tagged `source = 'demo'` and flow through the real rules): `lightning_strike` / `extra_strike` (`distance_mi`, default 6), `heavy_rain` (`mm`, default 45), `heat_wave` (`wbgt_f`, default 91), `wildfire` (`distance_mi`, default 12), `wildlife` (a real severity 3 report through `submit_hazard_report`; `demo_reset` cannot remove it, resolve it with a check-in). Crew members cannot call these (SQLSTATE 42501).

`update_crew_location` keeps one row per user. Clients should send after about 50 m of movement or every 60 s; a row older than 5 minutes is `is_stale` in `crew_locations_live`.

## Reads (RLS scoped)

| Table or view                                                                                    | Who reads                           | Notes                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------ | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `site_overview`                                                                                  | site members                        | `{ site_id, name, lat, lon, timezone, risk_now, risk_tomorrow, top_driver, subscores, lightning: { status, last_strike_at }, active_alert_count }`, highest risk first |
| `alerts`, `lightning_state`, `site_risk`, `site_subscores`, `ml_scores`, `readings`, `briefings` | site members                        | Realtime enabled for `alerts`, `lightning_state`, `site_risk`, `crew_locations`                                                                                        |
| `crew_locations`, `crew_locations_live`                                                          | own row, or supervisors of the site |                                                                                                                                                                        |
| `hazard_heatmap`                                                                                 | site members                        | cells of 0.001 degrees from `crew_observation_feed`                                                                                                                    |
| `push_subscriptions`                                                                             | own rows (select, insert, delete)   |                                                                                                                                                                        |

## Operations

- Hosted project only (local Docker is not required). Deploy with `supabase functions deploy <name> --use-api` and `supabase db push --linked`.
- Secrets: function secrets `CRON_SECRET` and `LIGHTNING_SOURCE` (`glm` or `none`); Vault entries `cron_secret` and `functions_base_url`. The service-role key is never stored in the database.
- Sites: `node scripts/load-sites.mjs <EIA-860M .xlsx>` writes `supabase/seed-sites.sql`, applied with `supabase db query --linked -f supabase/seed-sites.sql`. 60 real plants are loaded. `river_distance_m` is the distance to the nearest USGS stream gauge, a proxy for riverside; `coast_distance_m` is not populated.
- Free plan: about 43k lightning invocations plus about 10k others per month against a 500k limit; free projects pause after 7 days of inactivity.

## Verification

| Command                     | Covers                                                                       |
| --------------------------- | ---------------------------------------------------------------------------- |
| `npm run test:functions`    | parsers, time zones, WBGT, GLM decoding (Node, no network)                   |
| `npm run verify:monitoring` | lightning state machine, readings upsert, risk formula (hosted, rolled back) |
| `npm run verify:rules`      | every rule, briefings, demo scenarios (hosted, rolled back)                  |

The two `verify:*` commands pass by raising an error that begins "ALL ... CHECKS PASSED"; the transaction is always rolled back.

## Not built

ML scoring and training, SMS and web push delivery (alerts are in-app through Realtime), and all UI.
