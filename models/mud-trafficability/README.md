# Rutting inspection forecast (STRAM-inspired)

Forecasts potential ground rutting and highlights access-route segments that need inspection before equipment
mobilization, for the 60 power plants on the hosted project. It is **uncalibrated** and **not** a crossing clearance.

- `PROJECT_BRIEF.md`: the agreed spec, every assumption, and the decisions made while building it.
- `plan.md`: methodology notes and the validation pilot.
- `soil_trafficability_forecasting.md`: Jones & Arp (2019), the source study.
- `example_stram_usa_converter.py`: the SI/US equation reference. `stram/equations.py` is ported from it, and the tests check the port.

## Run

From this directory, using the repo's virtualenv (`pip install -r ../../requirements.txt`):

```sh
../../.venv/bin/python -m unittest discover -s tests   # no network
../../.venv/bin/python -m stram prepare                # cache SSURGO, 3DEP terrain/DTW, OSM routes (~1-2 min per site)
../../.venv/bin/python -m stram forecast               # one Open-Meteo call, then all sites in seconds
../../.venv/bin/python -m stram map                    # output/run_<stamp>/map.html and map/<eia>.html
../../.venv/bin/python -m stram push                   # writes SQL only; see below
```

Add `--eia 649,56407,6008` to `prepare` or `forecast` to work on a few sites. Vogtle, West County and Palo Verde are the
demo trio: sandy uplands with a clay floodplain, drained muck, and desert loam. `prepare` skips sites it has already
cached; `--force` refetches.

## How a flag is made

| Machine class | Signal | Flag |
|---|---|---|
| Road trucks (bucket/line, dump, lowboy) | STRAM ground index, from the study's own forwarder (Eq 1 → 3 → paper NCI/CI of 2.008 per MPa → 5 × 7). | Worse of: index ≥ 4 in inspect / ≥ 8 in hold; NRCS MIL type-7 rating poor → hold, fair → inspect. |
| Tracked excavator, crawler crane | NRCS MIL type 3 / 4 rating, wet or dry season by forecast, 1 or 50 passes. | Poor → hold, fair → inspect. |

Overrides that apply to every class:
- **Organic soils:** NRCS only, never below inspect.
- **Wet areas** (DTW < 1.6 ft): inspect in moist forecasts, hold in wet ones.
- **Unknown soil:** at least inspect.

The default view is **1 pass**. At 2 or more passes the study's equations put most firm ground at the inspect line in
any weather. See `PROJECT_BRIEF.md` → *Decisions*.

## Outputs (`output/run_<stamp>/`, newest named in `output/LATEST`)

- `segments/<eia>.geojson`: one feature per ~330 ft segment, with every machine × passes × horizon. Keys are explained
  in the collection properties.
- `polygons/<eia>.geojson`: flagged ground within 100 ft of a route, at default passes, for now and tomorrow.
- `sites.csv`: one row per site × horizon × machine × passes, with score (worst segment), `score_p90`, corridor acres and
  flagged route length.
- `agreement.csv`: STRAM wet case beside the NRCS rutting hazard. The Spearman ρ is in `run.json`; it is not a
  validation.
- `map.html` and `map/<eia>.html`: open from disk.

## Pushing to the hosted `ml_scores`

`push` writes `ml_scores_push.sql` and prints the command. It never runs it. Applying it changes **live** site risk:
`compute_site_risk` takes max(ML score, subscores) and does not check how old a score is. Use `--metric p90` for the
route-length-weighted score instead of the worst segment. Use `push --clear` to write the SQL that removes this model's
scores.
