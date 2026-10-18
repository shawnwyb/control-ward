# Next-day report: screenshots

What the **Next-day report** tab looks like for Turkey Point (EIA plant 621).

- Report: `public/reports/621/latest.json`, for Mon 2026-10-19, built 2026-10-18 06:44 UTC (2:44 AM EDT), verdict "Go with limits".
- App: the mock backend (`npm run dev:design`), signed in as `supervisor@planit.local`, site "Turkey Point · Report demo".
- The three dots near the plant on the map are demo crew reports from the mock. A real site shows its own crew's open mud and wildlife reports.

| File                             | Shows                                                                                             |
| -------------------------------- | ------------------------------------------------------------------------------------------------- |
| `01-full-page-desktop.png`       | The whole tab at 1280 px wide                                                                     |
| `02-full-page-phone.png`         | The whole tab at 390 px wide (one column)                                                         |
| `03-header-verdict.png`          | Verdict, best work window, reasons, changes since the earlier report                              |
| `04-heat-water-breaks.png`       | Hourly heat index, water and rest timeline, band legend, new-worker switch                        |
| `05-weather-work-window.png`     | Hours free of limits, hourly storm, gust, rain and CAPE, NWS alerts and text                      |
| `06-routes-tide-levees-map.png`  | Map: routes to avoid, tide shading, levees, sightings, crew reports; equipment and layer switches |
| `07-task-planner.png`            | Task planner: hours blocked per task and why                                                      |
| `08-flood-river-levees-tide.png` | River forecast, levees, tide table and windows                                                    |
| `09-hazard-index.png`            | Hazard index 0 to 10, driver, chance by hazard family                                             |
| `10-air-quality.png`             | Hourly air quality index, wildfire distance                                                       |
| `11-wildlife.png`                | Recent sightings and the reported-sighting season                                                 |
| `12-data-gaps.png`               | Inputs that were missing or not applicable, and limits that always apply                          |
| `13-detour-planner.png`          | The detour planner after two map clicks, with the result in words                                 |

## Regenerate

```sh
reports/next-day/run.sh build --site 621       # optional: a fresh report
npm run dev:design -- --port 5173 --strictPort # in one terminal
node docs/screenshots/next-day-report/capture.mjs
```

Chromium must be installed once (`npx playwright install chromium`). The map needs internet for its base map tiles.
