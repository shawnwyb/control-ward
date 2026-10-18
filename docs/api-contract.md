# Monitoring API contract

This document defines the monitoring backend: how data enters, which rules run, and which calls clients can make. It does not cover machine learning (ML) or the user interface (UI).

## How it works

1. pg_cron starts an Edge Function on a schedule. It sends the header `X-Cron-Secret`.
2. The Edge Function fetches data from an outside service and sends the result to the database with a worker RPC (`ingest_readings` or `ingest_strikes`).
3. The Edge Function then calls `evaluate_all_sites()`. Postgres calculates subscores, alerts and risk from the stored readings.
4. Clients read the tables and views. Realtime sends alert changes to clients that subscribe.

Edge Functions do not apply rules. Only Postgres decides when to raise or clear an alert.

Types for the database are in `src/database.types.ts`. Regenerate them with `supabase gen types typescript --linked`.

## Schedule

| Job                       | Schedule              | Action                                                           |
| ------------------------- | --------------------- | ---------------------------------------------------------------- |
| `invoke-ingest-lightning` | every minute          | Read NOAA GOES-East GLM flashes and call `ingest_strikes`.       |
| `lightning-sweep`         | every minute          | Clear a site 30 minutes after its last strike.                   |
| `invoke-ingest-openmeteo` | minute 2 of every 15  | Read heat, soil, rain and weather for all sites in one request.  |
| `invoke-ingest-nws`       | minute 7 of every 15  | Read NWS alert severity and flood warnings.                      |
| `invoke-ingest-gauges`    | minute 12 of every 15 | Read river stage and flood stage (NOAA NWPS, USGS as fallback).  |
| `invoke-ingest-wildfire`  | minutes 1 and 31      | Read active fires from NIFC WFIGS.                               |
| `evaluate-all-sites`      | every 5 minutes       | Recalculate subscores, alerts and risk.                          |
| `generate-due-briefings`  | hourly, minute 0      | Create a briefing for each site whose local hour is 18.          |
| `crew-hazard-maintenance` | every 5 minutes       | Expire hazards and create check-in reminders.                    |
| `prune-monitoring-data`   | daily, 04:17 UTC      | Delete readings older than 5 days and strikes older than 7 days. |

## Edge Functions

Each function requires the header `X-Cron-Secret`. The value is the Vault secret `cron_secret` and the function secret `CRON_SECRET`. A request without the correct value gets status 401. These functions have `verify_jwt` turned off. Each function returns `{ ok, function, ... }`.

| Function           | Source                                 | Notes                                                                                                              |
| ------------------ | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `ingest-openmeteo` | Open-Meteo                             | Writes current values and a daily forecast for the next two local days. WBGT is an estimate (see Rules).           |
| `ingest-nws`       | api.weather.gov                        | Calls once per site. If a call fails, the previous reading stays in use for up to 3 hours.                         |
| `ingest-gauges`    | NOAA NWPS, then USGS                   | Uses `sites.usgs_gauge_id`.                                                                                        |
| `ingest-wildfire`  | NIFC WFIGS                             | Writes `nearest_fire_mi = 999` when no active fire is known. This replaces the reading for a fire that is now out. |
| `ingest-lightning` | NOAA GOES GLM (`LIGHTNING_SOURCE=glm`) | Detects flashes by satellite camera. It keeps only flashes with quality flag 0.                                    |

Blitzortung is not used. Its terms forbid use in storm warning systems.

GLM is an optical sensor on a satellite, not a ground strike network. Its accuracy near a plant is not yet validated. Validate it before crews rely on it.

## Reading conventions

`ingest_readings` identifies a reading by `(site_id, hazard, unit, observed_at, forecast_for, source)`. Leave `forecast_for` empty for a current value. A forecast row holds one value for one local day, with the time set to local noon.

| hazard   | unit                                                                   | Meaning                                                                   |
| -------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| weather  | `temp_f`, `wind_gust_mph`, `precip_prob_pct`                           | Current hour, or the daily maximum for a forecast.                        |
| weather  | `nws_alert_severity`                                                   | 0 to 4: Minor 1, Moderate 2, Severe 3, Extreme 4. The worst active alert. |
| heat     | `wbgt_f`, `heat_index_f`                                               | Current hour, or the daily maximum for a forecast.                        |
| flood    | `precip_mm_overnight`                                                  | Rain in the latest 18:00 to 06:00 local window.                           |
| flood    | `precip_mm_24h`                                                        | Rain in the last 24 hours, or the daily total for a forecast.             |
| flood    | `gauge_stage_ft`, `gauge_flood_stage_ft`, `nws_flood_warning` (0 or 1) | River state.                                                              |
| soil     | `soil_moisture_frac`                                                   | Top soil layer, 0 to 1.                                                   |
| wildfire | `nearest_fire_mi`, `fires_within_25mi`                                 | Distance to the nearest active fire, and the count within 25 miles.       |

A reading counts as current for this long: 3 hours by default, 18 hours for overnight rain, 6 hours for soil and wildfire, and 3 days for flood stage.

## Rules

`evaluate_site` applies these rules to the current readings.

| Hazard    | Alert                                                                                                                                                             | Subscore                                                                                                                                                  |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Heat      | WBGT 82 `info`. WBGT 85 and 88 `warning`. WBGT 90 `stop_work`. When no WBGT exists: heat index 103 `warning`, heat index 125 `stop_work`.                         | The higher of the WBGT tier score (3, 5, 7.5, 10) and the heat index score (3, 6, 9 at heat index 90, 103, 125).                                          |
| Flood     | `warning` when any one is true: the site is riverside and overnight rain is at least 25 mm; the gauge is at or above flood stage; an NWS flood warning is active. | Rain or stage score, multiplied by 1.3 in a special flood hazard zone and by 1.2 within 5 km of a gauge (0.8 beyond 25 km). It never raises a zero score. |
| Wildfire  | `warning` within 25 mi. `stop_work` within 5 mi.                                                                                                                  | 10, 8, 6, 3, 1 at less than 5, 10, 25, 50, 100 mi.                                                                                                        |
| Weather   | `other` `warning` at NWS severity 3 or higher, or gusts of 40 mph or more.                                                                                        | Severity times 2 (maximum 8). Gusts of 30, 40, 58 mph score 3, 6, 9.                                                                                      |
| Soil      | None.                                                                                                                                                             | Soil moisture 0.30, 0.35, 0.40, 0.45 scores 2, 4, 6, 8.                                                                                                   |
| Lightning | Set by `ingest_strikes` and `sweep_lightning`.                                                                                                                    | 10 while the state is `stop_work`. 4 for a strike within 25 mi in the last hour.                                                                          |
| Wildlife  | None.                                                                                                                                                             | `wildlife_subscore` from `get_site_crew_metrics`.                                                                                                         |

A site is riverside when any one is true: its gauge is within 5 km, its flood zone is A, AE, AH, AO, AR, A99, V or VE, its river stage is at least 80 percent of flood stage, or an NWS flood warning is active.

**Not yet verified.** Do not use these for real go/no-go decisions until someone checks them:

- The heat tiers (82, 85, 88, 90 F) follow US military heat categories. They are not yet checked against TB MED 507.
- WBGT is an estimate from the Stull wet-bulb formula plus a sun and wind adjustment. It is not the Liljegren model.

### Alerts

The database keeps one active alert for each kind and site. Its `dedup_key` is `<kind>:<site_id>`. When conditions change, the level and payload update in place. When the condition ends, the status becomes `cleared`. The lightning alert has `kind = 'lightning'`. The general weather alert has `kind = 'other'`.

`top_driver` names the two largest non-zero subscores in plain words, for example "Driven by WBGT 89°F and saturated soil".

### Risk

`risk = min(10, base + crew)`.

- Now: `base` is the larger of the ML score and the highest subscore.
- Tomorrow: `base` is the largest of the ML score, the forecast heat, flood and weather scores, and the current wildfire and soil scores.
- `crew` is `crew_risk_term`, with a maximum of 2.

The result is stored in `site_risk` for the horizons `now` and `tomorrow`.

The ML score is the highest fresh row in `ml_scores` for that site and horizon. `ml_scores` holds one row per site, horizon and `model` (`mud`: rutting forecast, `models/mud-trafficability`; `hazard_index`: `models/hazard-index`). A row counts only while `computed_at` is less than 36 hours old (`now`) or 48 hours old (`tomorrow`); older rows are ignored, not deleted. With no fresh row the ML score counts as 0. When the ML score sets `base`, `top_driver` names the model: `ML mud trafficability <score>`, `ML hazard index <score>`, or `ML <model> <score>` for another model.

### Lightning

1. A strike within 10 miles (16,093.44 m) and no older than 30 minutes sets `lightning_state.status` to `stop_work`.
2. It moves `last_strike_at` forward. It never moves it back.
3. It updates the one active lightning alert, so Realtime sends the countdown reset to clients.
4. `sweep_lightning()` clears the state and the alert 30 minutes after the last strike.
5. A strike with the same source, time and coordinates is ignored.

Clients calculate the countdown as `payload.clear_at` minus the current time.

### Briefing

Each site gets one briefing per local date. The briefing is created when the site's local clock is in the 18:00 hour. It covers the next local day:

```json
{
  "tz": "America/New_York",
  "hazards": [
    {
      "hazard": "heat",
      "metric": "WBGT",
      "forecast": 88.4,
      "unit": "F",
      "level": "danger"
    }
  ],
  "predicted_risk": 7.4,
  "top_driver": "Driven by ...",
  "open_crew_hazards": [],
  "smoke_note": null
}
```

## Worker RPCs

Only the service role can call these.

| RPC                                                                   | Request                                                                                                                                              | Response                                                                                                 |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `ingest_strikes(p_batch)`                                             | `[{ lat, lon, struck_at, source? }]`, at most 5000                                                                                                   | `{ strikes, sites_in_range: [{ site_id, distance_mi, last_strike_at, countdown_reset }], crew_exposed }` |
| `ingest_readings(p_batch)`                                            | `[{ site_id, hazard, value, unit, observed_at, forecast_for?, source? }]`, at most 10000. If a batch repeats a reading, the last one is kept.        | `{ inserted, updated }`                                                                                  |
| `evaluate_site(p_site_id)`, `evaluate_all_sites()`                    | none                                                                                                                                                 | `{ site_id, top_driver, risk }`, `{ evaluated, failed }`                                                 |
| `compute_site_risk(p_site_id, p_tomorrow_worst?, p_tomorrow_driver?)` | none                                                                                                                                                 | `{ site_id, risk: [{ horizon, risk }] }`                                                                 |
| `upsert_ml_scores(p_batch)`                                           | `[{ site_id, horizon, score, model_version, model? }]`. `model` defaults to the `model_version` prefix (`stram` → `mud`, `hazidx` → `hazard_index`). | `{ upserted }`. One row per site, horizon and model; a model only overwrites its own rows.               |
| `generate_due_briefings()`                                            | none                                                                                                                                                 | `{ sites, briefing_ids }`                                                                                |
| `sweep_lightning()`, `prune_monitoring_data()`                        | none                                                                                                                                                 | Counts of rows changed.                                                                                  |

## Client RPCs

Signed-in users can call these.

| RPC                                                                                              | Request                                      | Response                                                                |
| ------------------------------------------------------------------------------------------------ | -------------------------------------------- | ----------------------------------------------------------------------- |
| `update_crew_location`                                                                           | `{ p_site_id, p_lat, p_lon, p_accuracy_m? }` | `{ ok, exposed_alerts: [{ alert_id, kind, level, distance_mi }] }`      |
| `acknowledge_alert`                                                                              | `{ p_request_id, p_alert_id }`               | `{ ok, acknowledged_at }`                                               |
| `mark_briefing_read`                                                                             | `{ p_briefing_id }`                          | `{ ok }`                                                                |
| `list_site_crew` (supervisor)                                                                    | `{ p_site_id }`                              | `[{ user_id, name, email, role, latitude, longitude, … has_push }]`     |
| `assign_site_member` (supervisor)                                                                | `{ p_site_id, p_email }`                     | `{ ok, outcome: 'assigned' or 'already_member', user_id, email, role }` |
| `unassign_site_member` (supervisor)                                                              | `{ p_site_id, p_user_id }`                   | `{ ok, removed }`                                                       |
| `demo_inject` (supervisor)                                                                       | `{ p_scenario, p_site_id, p_params? }`       | `{ ok, injected, result }`                                              |
| `demo_reset` (supervisor)                                                                        | `{ p_site_id }`                              | `{ ok, deleted_rows }`                                                  |
| `demo_generate_briefing` (supervisor)                                                            | `{ p_site_id }`                              | `{ ok, briefing_id }`                                                   |
| `submit_hazard_report`, `checkin_hazard_report`, `reserve_hazard_photo`, `get_site_crew_metrics` | See `docs/crew-api.md`.                      |                                                                         |

Supervisor alerts: `send_push` creates an `alerts` row (and no browser push) with `kind = 'supervisor'` (`payload.title`, `payload.body`). `target_user_ids` is null for everyone, or the list of chosen workers; row-level security shows it only to them and to the site's supervisors. Crew see it in the same alert list as automatic safety alerts and can acknowledge it. `clear_supervisor_alert({ p_alert_id })` (supervisor) takes it off their screens. Requires `20261017001600_supervisor_alerts.sql` and `20261017001700_supervisor_alert_no_push.sql`; `send_push` returns `{ ok, id, alert_id }` with both ids equal to the alert's id.

A supervisor can add an existing account to a site they supervise as `crew`, and remove `crew` from it. These calls never promote, demote or remove a supervisor, and `assign_site_member` leaves an existing member's role unchanged. Only `site_memberships` rows for the caller are readable by clients, so these are the only way to see or change a roster from the app. Check them with `npm run verify:crew-assignment`.

`update_crew_location` keeps one row for each user. Clients should send a position after about 50 m of movement or every 60 seconds. `crew_locations_live` marks a row `is_stale` after 5 minutes.

### Demo scenarios

Demo rows have `source = 'demo'`. They pass through the same rules as real data, so real alerts fire.

| Scenario                           | Parameter and default | Effect                                                                                                                     |
| ---------------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `lightning_strike`, `extra_strike` | `distance_mi`, 6      | Adds one strike.                                                                                                           |
| `heavy_rain`                       | `mm`, 45              | Adds overnight and 24-hour rain, and saturated soil.                                                                       |
| `heat_wave`                        | `wbgt_f`, 91          | Adds a WBGT reading and a heat index 21 degrees higher.                                                                    |
| `wildfire`                         | `distance_mi`, 12     | Adds a fire reading.                                                                                                       |
| `wildlife`                         | none                  | Files a severity 3 wildlife report with `submit_hazard_report`. `demo_reset` cannot remove it. Resolve it with a check-in. |

A crew member who calls a demo RPC gets SQLSTATE 42501.

## Reads

Row level security (RLS) limits every read to the caller's own sites.

| Table or view                                                                                    | Who can read                        | Notes                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------ | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `site_overview`                                                                                  | Site members                        | `{ site_id, name, lat, lon, timezone, risk_now, risk_tomorrow, top_driver, subscores, lightning: { status, last_strike_at }, active_alert_count }`. Highest risk first. |
| `alerts`, `lightning_state`, `site_risk`, `site_subscores`, `ml_scores`, `readings`, `briefings` | Site members                        | Realtime is on for `alerts`, `lightning_state`, `site_risk` and `crew_locations`.                                                                                       |
| `crew_locations`, `crew_locations_live`                                                          | Own row, or supervisors of the site |                                                                                                                                                                         |
| `hazard_heatmap`                                                                                 | Site members                        | Cells of 0.001 degrees, built from `crew_observation_feed`.                                                                                                             |
| `push_subscriptions`                                                                             | Own rows (select, insert, delete)   |                                                                                                                                                                         |

## Operations

- Run everything against the hosted project. Local Docker is not required.
- Deploy a function with `supabase functions deploy <name> --use-api`. Apply migrations with `supabase db push --linked`.
- Secrets: the function secrets `CRON_SECRET` and `LIGHTNING_SOURCE` (`glm` or `none`), and the Vault entries `cron_secret` and `functions_base_url`. The service-role key is not stored in the database.
- Load sites with `node scripts/load-sites.mjs <EIA-860M .xlsx>`. It writes `supabase/seed-sites.sql`. Apply that file with `supabase db query --linked -f supabase/seed-sites.sql`. 60 real plants are loaded.
- `river_distance_m` holds the distance to the nearest USGS stream gauge. It is only a rough measure of how close a plant is to a river. `coast_distance_m` is empty.
- Free plan limits: about 43,000 lightning calls and about 10,000 other calls each month, against a limit of 500,000. A free project pauses after 7 days without activity.

## Verification

| Command                     | What it checks                                                                              |
| --------------------------- | ------------------------------------------------------------------------------------------- |
| `npm run test:functions`    | Parsers, time zones, WBGT and GLM decoding. Runs in Node with no network.                   |
| `npm run verify:monitoring` | Lightning state machine, readings upsert and the risk formula. Runs on the hosted database. |
| `npm run verify:rules`      | Every rule, the briefing and the demo scenarios. Runs on the hosted database.               |

The two `verify:` commands always roll back. A passing run ends with an error that starts "ALL ... CHECKS PASSED". Any other error means a check failed.

## Not built

- ML training and scoring.
- SMS and web push. Alerts reach clients through Realtime only.
- The UI.
- The `site_detail` call. A client can build the same view from the tables above.
