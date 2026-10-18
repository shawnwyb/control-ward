# Next-day safety report

One report per site for the next local day, for a project or site manager. It answers: when to work, when to take
water breaks, which routes to avoid, and which weather, tide, river and levee conditions affect the day.
The report is decision support. It does not certify that work, a route or a crossing is safe.

Spec and agreed scope: `docs/NEXT_DAY_REPORT_BRIEF.md`. The app tab that reads the output: `src/features/nextday/`.
Nothing here writes to a database.

## Commands

`run.sh` is a shell script. Run it directly (`reports/next-day/run.sh build`) or with `bash`, not with `python`.

```sh
reports/next-day/run.sh build                     # the 5 sample sites, live data, tomorrow
reports/next-day/run.sh build --site 621 6113     # chosen plants (EIA plant ids from supabase/seed-sites.sql)
reports/next-day/run.sh build --all               # all 60 plants (about 45 s per site with every source)
reports/next-day/run.sh build --for today         # the 5 AM rebuild for the same day
reports/next-day/run.sh refresh                   # build, then list what changed since the previous report
reports/next-day/run.sh build --offline STAMP     # rebuild from the saved responses in cache/snapshots/STAMP (no network)
reports/next-day/run.sh build --no-wildlife --no-routing   # skip the slow iNaturalist and Overpass requests
reports/next-day/run.sh stations                  # propose a NOAA tide station per plant (a person must review it)
reports/next-day/run.sh calibrate-mud crew_mud.csv         # compare crew mud reports with the flagged routes
reports/next-day/run.sh test                      # unit tests; node is needed for the TypeScript parity test
npm run test:nextday                              # the same, plus the Node tests for the browser-side logic
```

Every build prints its snapshot stamp. Responses are saved under `reports/next-day/cache/snapshots/<stamp>/`
(not committed), so any report can be rebuilt later with `--offline <stamp>`.

## Run order each evening

Run per time-zone group at about 17:30 local, so the mud model's `now` and the hazard index's `tomorrow` match the report date.

1. `models/hazard-index/run.sh score`
2. `models/mud-trafficability/run_daily.sh`
3. `reports/next-day/run.sh build` (evening) and `reports/next-day/run.sh refresh --for today` (about 5 AM)

A hazard-index run older than 24 hours, or a mud run older than 48 hours, is not used: the section says so and
names the command to run. A mud run 24 to 48 hours old is shown with a warning.

To schedule it later: run these three commands from cron on a machine that holds the model caches, or move
`build` into an Edge Function and a table. That is out of scope for this prototype.

## Output

```
public/reports/index.json                         one row per site
public/reports/<eia>/latest.json                  the newest report (copy of <for_date>/report.json)
public/reports/<eia>/<for_date>/report.json       the report (schema_version 1)
public/reports/<eia>/<for_date>/report.prev.json  the build before it (not committed); changes are computed against it
public/reports/<eia>/<for_date>/*.geojson         mud_routes, tide_shading, levees, wildlife
public/reports/<eia>/<for_date>/road_graph.json   road graph for detours
```

Every section is `{status: "ok" | "stale" | "missing" | "not_applicable", reason?, ...}`. A missing, old or not
applicable input appears in `gaps` with its reason. Nothing is dropped silently.

| Section | Source | Notes |
|---|---|---|
| weather, heat | Open-Meteo hourly (7 points within 20 km), NWS alerts and text | hourly rules mirror `briefing.ts` |
| hazard_index | `models/hazard-index/artifacts/dryrun/ml_scores_*.csv` | refused when older than 24 h |
| mud, routing | `models/mud-trafficability/output/LATEST`, OpenStreetMap (Overpass) | uncalibrated; unpaved ways only |
| flood.tide | NOAA CO-OPS predictions and datums, 10 m ground tile of the mud model | only plants in `nextday/data/stations.json` |
| flood.levees | USACE National Levee Database through `data/flood-data/nld_fetch.py` | never removes tide or flood shading |
| flood.river | NOAA NWPS gauge nearest the site (list in `data/flood-data/long_range_river_flood_risk_data.csv`) | many gauges publish no forecast |
| air | Open-Meteo air quality, NIFC wildfire incidents, NWS alerts | model forecast, not a sensor |
| wildlife | iNaturalist (research grade, public coordinates, no photos) | counts reports, not animals |
| tasks | `nextday/data/task_profiles.json` | the browser applies a chosen task to the hourly table |
| changes | previous `report.json` for the same date | verdict, window, heat, alerts, hazard index, mud, tide, river, air |

## Things to check by a person

- **Heat bands.** `nextday/heat_plan.py` pins the NWS heat index categories (80, 91, 103, 125 F). The NWS chart is an image and
  could not be read by a machine, so the table is tagged "chart read by hand, confirm before use". Water and rest advice
  uses only what OSHA publishes (water about every 15 minutes, frequent rest breaks in the shade). No work/rest minute ratios are encoded.
- **Tide stations.** `run.sh stations` picks the nearest NOAA station within 20 km. A person must confirm each one is on the
  same water as the plant and set `reviewed` in `nextday/data/stations.json`. Notes mark the doubtful ones.
- **Task limits.** Limits from the alert rules are marked as such. Every other limit in `task_profiles.json` has
  `needs_confirmation: true` and must be replaced with the equipment manual or the site safety plan.
- **Wildlife species list.** `nextday/data/wildlife_taxa.json` is a starter list.

## Mud calibration with crew reports

The crew app has a hazard type `mud` (migration `supabase/migrations/20261018040000_hazard_type_mud.sql`, not applied anywhere yet:
apply it to the local stack with `npm run local:reset`, and to the hosted project only with the owner's go-ahead).
Export the mud reports as a CSV with the columns `eia_plant_id, latitude, longitude, created_at`:

```sql
select s.eia_plant_id, st_y(h.location::geometry) as latitude, st_x(h.location::geometry) as longitude, h.created_at
from public.hazard_reports h join public.sites s on s.id = h.site_id
where h.type = 'mud' and s.eia_plant_id is not null;
```

`run.sh calibrate-mud file.csv` finds the newest mud run before each report whose horizons cover the report's local date,
and says whether the model flagged the nearest rated segment within 50 m. It writes `cache/mud_validation.json`.
It never changes `locally_validated`: a person decides that after reading the numbers.

## Limits

Forecasts change. Hourly values are the highest of seven points within 20 km. The heat index assumes shade (full sun can add up
to 15 F). Tide shading ignores surge, river level, drains and levees. A levee in the database does not mean the levee holds.
The mud model rates only unpaved ways in OpenStreetMap. Sightings reflect where people looked. The full list of data gaps is in the brief.
