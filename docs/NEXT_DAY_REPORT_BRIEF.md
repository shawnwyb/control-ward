# Project brief: 6 PM next-day safety report

Status: plan approved in the design interview. Built in `reports/next-day/` (generator) and `src/features/nextday/` (app tab). Commands and run order: `reports/next-day/README.md`.

## Problem and intended outcome

The SwampHacks brief (`docs/PlanIT_Control_SwampHacks_Brief.docx`) requires that the platform send a next-day safety report every evening at 6 PM local time. Today the repo drafts a 6 PM work plan (`briefing_drafts`, `BriefingPanel.tsx`). That plan has a work window and hourly blocked hours. It has no tide, mud route, hazard index, heat-index timeline, levee, river forecast, air quality or wildlife data.

Intended outcome: one report per site, for the next local day, that a project or site manager can use to decide:

- when to do the work,
- when to schedule water breaks, with the heat-index peak shown,
- which routes to avoid (mud), and where to detour,
- which severe weather, tide, river and levee conditions affect the day, and
- which tasks fit which hours.

The report is decision support. It does not certify that work, a route or a crossing is safe.

## Target users and main use cases

- Project or site manager: reads the report at 6 PM, plans the next day, prints or shows it at the morning briefing.
- Supervisor: reviews the report next to the existing next-day plan.
- Crew member: does not use the report. Crew mud and wildlife reports feed it.

## Scope

In scope:

- A generator script (`reports/next-day/run.sh`) that writes one JSON report per site.
- A new tab in the app that shows the report.
- Sections: verdict, changes since the last report, hazard index, heat and water breaks, weather and severe-weather outlook, air quality and smoke, flood (river forecast, levees, tide), mud routes and detours, wildlife, task planner, data gaps.
- Sample output for 3 to 5 sites.
- One schema change: a new crew hazard type, `mud` (Phase C only).

Out of scope:

- Sending the report by PDF, email or SMS, and read receipts.
- Outcome feedback ("worked" / "stopped") to check the verdicts.
- A scheduled hosted job. The generator is run by hand. The README says how to schedule it later.
- Changes to the supervisor review/send flow, `ml_scores`, or any hosted database.

## Functional requirements

1. **Dates and time zones.** The report date is the site-local date plus one day (`--for today` for the 5 AM refresh). All times are site-local.
2. **Hazard index.** Show the 0-10 score for the report date, the top driver, the four family probabilities and the model caveats. Read the newest dry-run CSV. Refuse a CSV older than 24 hours.
3. **Heat and water breaks.** Show hourly heat index and WBGT (wet bulb globe temperature), the band for each hour, the peak hour and a water-break timeline. Use one pinned, cited heat-index table. Do not invent work/rest minute ratios.
4. **Weather.** Show the hourly storm strip (probability, CAPE, gusts, rain), active NWS alerts that overlap the day, the best work window and a three-level day verdict (go, go with limits, reschedule) with its reasons.
5. **Air quality.** Show hourly US AQI and PM2.5, smoke or air-quality alerts, and the hazard index fire probability.
6. **Flood.** Show:
   - the nearest river gauge: observed trend, forecast crest and flood category, or "no forecast published";
   - the National Levee Database (NLD) levees near the site: leveed-area membership, system name, FEMA accreditation, closure structures and pump stations, with the levee lines on the map;
   - for tidal sites: high and low tide times, rising windows, and ground below the predicted high-tide level shaded on the map where NOAA publishes the NAVD88 (North American Vertical Datum of 1988) offset.
7. **Mud routes.** Show route segments flagged `inspect` or `hold` for the next day, by equipment class. Keep the model label: uncalibrated, not a crossing clearance.
8. **Detours.** Let the user click two points and get a path that avoids `hold` (or `hold` and `inspect`) segments. Say when the path uses roads the mud model does not rate.
9. **Wildlife.** Show recent public sightings of listed species near the site and a seasonal activity label for the month. Overlay crew wildlife reports.
10. **Task planner.** Let the user pick task types and see the hours each task is blocked, and why. Limits that have no source are marked "needs confirmation".
11. **Acclimatization toggle.** For workers new to the job or back after a break, show the gradual-exposure guidance.
12. **Changes.** On a refresh, list what changed since the previous report for the same date.
13. **Gaps.** Every missing, stale or not-applicable input appears in the report with the reason. Nothing is dropped silently.
14. **Mud calibration.** A command compares crew `mud` reports with the flagged segments and writes hit and miss counts. It does not change `locally_validated`.

## UX and accessibility requirements

- The report opens from the sidebar page "Next-day report" (`#/next-day-report`, mounted in `SiteWorkspace.tsx`). Revision 1 below corrected this line.
- Colour is never the only signal. Every band, flag and verdict also has a word or symbol.
- The page works at phone width and prints to a short PDF.
- Map layers can be switched on and off. The map has a text alternative: the same facts in lists.
- The detour planner works with the keyboard: arrow keys move a crosshair, Enter picks the point, Escape cancels. "Start at the plant" fills in the start.
- Routes to avoid are also listed in words, worst first, so the answer does not depend on the map.
- On phones, sticky links jump to each panel. Source notes are folded under "About this data" and open when the page prints. Caveats that change a decision stay visible.
- Report text follows Standard Technical English: short sentences, concrete verbs, terms defined at first use (WBGT, CAPE, MLLW and NAVD88 carry their long form).

## Technical constraints and integrations

- Data path: static JSON files in `public/reports/<eia>/`. The app reads them. No database write.
- Python generator reuses `hazidx.heat`, `hazidx.localtime`, `hazidx.sites` and `nld_fetch.NLDClient` through `PYTHONPATH`. No copies of the formulas.
- Blocked-hours rules mirror `supabase/functions/_shared/briefing.ts`. A Node parity test checks them.
- External sources, all without a key: Open-Meteo forecast and air quality, NWS (`api.weather.gov`), NOAA CO-OPS tides and `mdapi` datums, NOAA NWPS river gauges, USACE NLD, iNaturalist, OSM (Overpass). Responses are saved as dated snapshots so a sample report can be rebuilt offline.
- Inputs from the offline models: `models/hazard-index/artifacts/dryrun/`, `models/mud-trafficability/output/LATEST`, `models/mud-trafficability/cache/`.
- Schema change (Phase C): `supabase/migrations/20261018030000_hazard_type_mud.sql`. Apply to the local stack only. Do not push it to the hosted project without the user's go-ahead.

## Data, privacy and security considerations

- No personal data enters the report. Crew reports are shown as map points and counts only.
- iNaturalist: use public coordinates, counts and dates only. No photos. Skip obscured records. Credit iNaturalist.
- The generator never writes to a database and never calls `push --apply`.
- Every outbound request sets a descriptive `User-Agent`, retries with back-off, and respects the free-tier limits.

## Acceptance criteria

1. `reports/next-day/run.sh test` passes with no network.
2. `run.sh build --site 621` writes `public/reports/621/latest.json` that validates against `schema_version: 1`. Each section has a status of `ok`, `stale`, `not_applicable` or `missing`.
3. The Turkey Point report shows tide times, high-tide shading with its label, levee data (or "none within range"), mud routes, the hourly heat strip with a water-break timeline, and the hazard index.
4. An inland site shows "not applicable" for tide with the reason.
5. A site with no report, a stale report and an empty river forecast each show a clear message in the tab.
6. `npm run build` and the Playwright spec for the tab pass.
7. Nothing wrote to a hosted database.

## Data gaps found

1. `data/` has no weather forecast. The hourly forecast is not stored in the database (only inside `briefing_drafts.content.hourly`, without heat index). The stored daily forecast covers day +1 and +2 at local noon only.
2. Tide: no data, no station mapping, no per-site flood threshold, empty `coast_distance_m`. About 13 of 60 plants are tidal. Predictions exclude storm surge and river level. The 10 m ground model has vertical error that matters at decimetre tide heights.
3. Levees: the NLD map service has no inspection-rating field. The NLD2 API may have it, but its query parameters are unverified and some routes need an account. Levee data does not say whether a levee holds on the day. Local, unlisted and non-USACE levees may be missing.
4. River: NWPS publishes no forecast at many gauges. The nearest gauge may be on another river.
5. Mud: only OSM unpaved ways are modelled. On-site haul roads and paved crossings are missing or unrated. The model is uncalibrated. `now` depends on run time. Crew reports have no mud type until the migration lands.
6. Detours: the paved network is not rated. Private roads are missing from OSM. There is no gate, closure or truck-height data.
7. Heat: WBGT is an approximation (not Liljegren). The tiers are not verified against TB MED 507. Published heat-index bands disagree. There is no workload input. The heat index assumes shade. No work/rest schedule is encoded.
8. Hazard index: 60 plants only. Trained on ERA5 reanalysis, scored on forecasts. Fire has negative skill. Heat skill is low (Brier skill 0.10). No hourly values. No per-site uncertainty. `docs/ML_SCORES_BRIEF.md` and `push.py` disagree on the model key name (`hazard_index` and `hazidx`).
9. Weather not ingested today: CAPE, UV, sunrise and sunset, apparent temperature, visibility, wind direction. There is no lightning forecast, only rain probability as a proxy.
10. Air and wildlife: Open-Meteo air quality is a model, not a sensor. iNaturalist holds opportunistic sightings. "No sightings" does not mean "no animals".
11. Task limits: wind and other limits per task need equipment-manual or site-safety-plan values. None are in the repo.

## Assumptions, dependencies and risks

- Assumption: the default mud profile is `road_truck`, 1 pass, horizon `d1`. The tab offers the other two equipment classes at 1 pass.
- Assumption: sample output covers Turkey Point (621), a leveed inland site, a site with no mud segments or a stale hazard index, and a heat-heavy site.
- Assumption: the verdict thresholds live in one table and the user may change them.
- Dependency: the hazard-index `score` run and the mud-trafficability daily run must finish before `build`. Run per time-zone group at about 17:30 local.
- Risk: heat-index sources conflict. The generator pins one table with its URL and retrieval date. If sources still conflict at build time, stop and ask.
- Risk: tide shading can mislead. It ignores surge, river level, drains, levees and ground-model error. The label says so next to the layer.
- Risk: levee data can look reassuring. The report never uses a levee to remove tide or flood shading.
- Risk: a person may read "go" as clearance. Every verdict carries the decision-support label.

## Open questions

1. Task list and real limits (wind, rain, ground condition) for each task type.
2. Wildlife species list for the sighting and season layer.
3. Go-ahead before the `mud` hazard-type migration is pushed to the hosted project.
4. Which heat-index source to pin if the sources still conflict at build time.
5. Human check of the tide-station mapping, mainly Haynes and the inland candidates.

## Revision 1: field-briefing layout (2026-10-18)

The first layout read like a debug log. A supervisor at 5:30 AM scrolled four hourly grids, NWS text, a heat-band dictionary and model strings to learn when crews can work and which roads are on hold. Revision 1 changes the layout and the copy. It does not change the data: no generator, JSON or `schema_version` change, and no report is rebuilt.

### Layout

1. **Hero row (three cards).**
   - Verdict: level word and shape, best window ("weather limits only"), at most three short action lines built from the verdict's reason codes, the decision-support line, and a fold with the full reasons, the weather-only note and "Changed since the last report".
   - Hazard index: half-circle gauge (green to 3, amber to 7.5, red to 10, the hazard index's own tiers), the score and tier, the top driver, four pills (heat, storm, flood, fire), and a "Model details" fold (version, drift flags, first two caveats). The later caveats (the fire and heat skill warnings) stay visible.
   - Mud trafficability: score and flag word, flagged miles of rated miles, a slope split into ok, inspect and hold by share of rated route length, the maximum predicted rut when one exists, and the uncalibrated label.
2. **Work schedule (one table, one time axis).** Weather, each selected task, the heat index, and the air quality row only on a day that reaches an AQI of 101. Picking an hour (mouse, keyboard focus or tap) shows its gusts, rain chance, rain, CAPE and heat index. Folds hold the band dictionary, task limits and sources, and the hourly table with the National Weather Service text. National Weather Service alerts show as a banner when there are any.
3. **Routes.** The map and a "Flagged routes" table side by side. Picking a row highlights that road on the map and zooms to it. The planner and its keyboard path are unchanged.
4. **Tiles.** Tide and flood, air and smoke, wildlife. The footer fold "Model and data disclaimers" holds the data gaps, the limits that always apply, and the model and source notes.

### Decisions

- Caveats that change a decision stay visible as one-liners: the decision-support line, the mud "uncalibrated, does not certify" line, the heat chart "read by hand, confirm" line, the tide "ignores storm surge, ground not shaded is not guaranteed dry" line, the levee "treat a leveed area as able to flood" line, and the wildlife "no sightings does not mean no animals" line. Everything else is folded.
- "Hold" is not a rut depth. The flag is the worse of the ground-index flag and the NRCS soil rating, so a segment can be at hold with a predicted rut under 8 in, or with no rut value. The route table shows "-" when there is none. The card and the map key say that soil rating can set hold. For Turkey Point, 98 of 304 hold segments have no rut value.
- The window is weather only. Mud holds and task limits are not in it. The verdict card says so.
- "Storm chance" in the old hourly table was rain probability. It is now labelled "Rain chance". The hazard index percentages are the chance that NOAA records an event of that kind near the plant that day.
- The truck on the mud slope marks the equipment class. It does not mark a place on the slope.
- The tide window keeps the report's wording, "within one hour of high water". It is not called flood risk.
- Short action lines are built in the browser (`briefing.ts`). The Python generator is unchanged.
- Not built: a wind tile and a rip-current tile. The report has no rip-current data. A rip current statement appears only when the National Weather Service issues one, as an alert.

### Measured (Turkey Point, 1280 px wide, folds closed, screen-reader text excluded)

| | Before | After |
| --- | --- | --- |
| Visible words | 1,975 | 881 |
| Page height, desktop | 5,320 px | 3,318 px |
| Page height, phone (390 px) | 9,602 px | 6,186 px |

The aim was a cut of about 75 % of the text. The page reached 55 %. What remains is mostly the schedule, the map controls and key, the detour planner and the caveats above.

### Tests

`tests/ui-design/next-day-report.spec.ts` was rewritten for the new layout. `tests/nextday/briefing.test.mjs` covers the pure helpers (`briefing.ts`, `maxPredictedRut` in `routesList.ts`).
