# Project brief: STRAM-inspired rutting forecast for access routes

Agreed through the `/interview` session and plan approval on 2026-10-17. This is the source of truth for the
model in `models/mud-trafficability/`. The methodology notes in `plan.md` are the user's and are not
replaced by this file. If a later request conflicts with this brief, flag it and update the brief first.

**Product claim:** "Forecasts potential ground rutting and highlights access-route segments requiring
inspection before equipment mobilization." It is STRAM-inspired (Jones & Arp 2019), uncalibrated, and
**not** a crossing clearance.

## Problem and intended outcome
- **Problem:** Crews mobilize trucks and tracked machines across unpaved ground near plants without a forecast of soft-ground risk.
- **Outcome:** For each plant, each equipment class and each horizon (now, tomorrow, 7 days):
  - a 10 m raster of predicted rut depth (wheeled) or MIL trafficability level (tracked);
  - **affected-area polygons** above the inspect threshold;
  - **route segments** that intersect them, flagged **ok / inspect / hold**. "Hold" means hold mobilization until the segment is inspected. It is not a stop-work rule.
  - a plant summary: affected acres, intersected route length, worst segment.
- The worst-segment score goes to `ml_scores`.

## Target users and use cases
- **Supervisors** at the 6 PM planning point (matches the next-day briefing). They decide which segments to walk or probe and which equipment is riskiest.
- **Hackathon judges.** They need an explainable map.

## In scope / out of scope
**In scope (agreed in interview):**
- The 60 hosted operating sites, from `supabase/seed-sites.sql`, keyed by `eia_plant_id`.
- OSM unpaved roads and tracks within 2 km.
- Keyless public data: SSURGO through `ssurgo_fetch.py`, USGS 3DEP, Open-Meteo and Overpass.
- The STRAM-inspired chain with the study's coefficients, uncalibrated.
- The hybrid NRCS rule.
- Equipment: bucket/line trucks, dump/lowboy trucks, tracked excavators/crawler cranes.
- Horizons: now and tomorrow go to `ml_scores`; the 7-day outlook stays in files and map only.
- Outputs: GeoJSON, CSV, a Leaflet map, and an SQL push to `ml_scores` on the full 0–10 scale.
- **Units:** US customary for all outputs (in, psi, ft, lbf, acres, mi). Every GeoJSON and `run.json` states its units and the factors back to the study's SI units. SI copies of each value were dropped to keep the files small (changed 2026-10-17).

**Out of scope:**
- Crossing clearance.
- Crane outrigger and lift bearing capacity.
- Paved, aggregate and matted road capacity. These are separate surface cases in `plan.md`; here mapped ways are only "existing track".
- Field calibration and a Random Forest. Both need real observations.
- New Edge Functions or migrations, schedulers, `src/` UI changes, and planned/under-construction plants.

**data/ use:**
- Used: `soil-data/`, `power-plants/` (through `seed-sites.sql`), and `flood-data/long_range_river_flood_risk_data.csv` (map context).
- Not used: OSHA, storm events, tides, the Stage IV GRIB and NLD boreholes.

## Functional requirements
1. **Equations: reuse `example_stram_usa_converter.py`.** Promote `STRAMModel`, `MACHINE_PRESETS` and `adapt_ssurgo_dataframe` into `stram/equations.py` (the example file is left untouched), and run in `unit_system="US"`. Fixes and guards:
   - **Eq 4 rescale.** As written, Eq 4 gives an NCI 3.65–4.26× the Table 5 values. This was verified this session. Eq 5 *is* consistent with Table 5: fed Table 5's NCI it gives 13.6, 15.5, 14.4 and 23.9 cm against measured 15.6, 13.3, 13.9 and 22.5. Apply a least-squares factor of about 0.26 so Eq 4 reproduces Table 5 (±8 % across machines), and log it. *Superseded 2026-10-17: the reference forwarder now uses the paper's own NCI/CI of 2.008 per MPa; see "Eq 4 mismatch: evidence".*
     - The converter's own demo gets NCI values of 13–18. That puts Eq 5's exponent into runaway (Block 9 = 51.8 cm), so its end-to-end numbers must not be reused.
   - **Domain guard.** Clamp NCI_adj to about 2.5–9.5. Allow only passes ∈ {1, 2, 5, 10}. The views are 1, 2 and 10 passes. **Default 1** (one loaded crossing; agreed 2026-10-17, see Decisions), 2 is in and out, 10 is a convoy. Set `extrapolated` with reasons when values fall outside the Table 5 ranges: sand 32–65 %, OM 4.4–13.3 %, Db 0.63–1.20 g/cm³, CF 21–48 %. All three soils in the `example_soil_plants.csv` sample trip this.
   - **Eq 2 is skipped.** Its DEM term is specific to New Brunswick, so MC_PS comes from Eq 1. SW = 0 and HW = 0, because the forest-type terms don't describe a cleared corridor (per `plan.md`).
   - **Column shim.** `ssurgo_fetch.py` outputs `sand_pct/om_pct/bulk_density_g_cm3/coarse_frag_pct`; the adapter expects `sandtotal_r/om_r/dbthirdbar_r/fragvol_r`.
2. **Static prep per site (cached), all on one 10 m UTM grid of about 2.5 km:**
   - **DEM:** 3DEP `exportImage`. Fill, D8 flow direction and accumulation (pysheds).
   - **DTW per FIA** for {0.25, 1, 4, 8, 16} ha (≈ 0.6–40 acres), using `skimage.graph.MCP_Geometric` with cost = slope.
   - **DTW_eff** = min(DTW, SSURGO `wt_depth_annual_min_cm`) where that field is populated. Flat Florida terrain defeats DEM-only DTW.
   - **Soils.**
     - Plant row: `cd data/soil-data && python ssurgo_fetch.py plants --plant-id <60 ids>`.
     - Per-cell: one SDA query for `mupolygon` WKT in the tile (via `SDAClient`). Per-mukey properties and ratings come from `SoilFetcher.ensure_mukeys` + `aggregate_plant({mukey: 1.0}, …)`, then are rasterized.
     - Cells with no data inherit the plant row. A plant with no data at all is `soil_unknown`, and its segments are at least inspect.
   - **Routes:**
     - Overpass ways: every `highway=track`, plus ways with an unpaved surface or tracktype grade 2–5, plus service/unclassified ways with unknown surface (tagged).
     - Rasterize a **Track** mask: 1 on ways (existing disturbed ground), 0 elsewhere (new route / native ground).
     - Split ways into about 330 ft (100 m) segments.
3. **Daily per cell: STRAM ground-condition index** (the study's own loaded JD1510E forwarder, which is inside the calibration range):
   1. θ = mean of Open-Meteo `soil_moisture_3_to_9cm` and `9_to_27cm`, run at the 6 PM local initialization.
   2. φ = 1 − Db/2.65 (the adapter's approach).
   3. MC_PS,top = 100·θ/φ.
   4. Wetness class → FIA, from 72 h antecedent plus same-day rain: <0.2 in →8 ha, 0.2–0.8 →4, 0.8–2 →1, ≥2 in →0.25.
   5. Frozen flag when soil temperature is below 32 °F.
   6. **Eq 1** with k_mc = 0.5 m⁻¹ and p_mc = 1.5, sourced from Jones & Arp 2019 (OJF 9:109–142) during implementation.
   7. **Eq 3** (Table 7 coefficients, depth 6 in).
   8. **NCI** = 2.008 × CI (MPa), the JD1510E's NCI/CI in Table 5. This is the scale Eq 5 was fitted on. It replaced 0.253 × Eq 4 (1.855 per MPa) on 2026-10-17.
   9. **Eq 5 × Eq 7** give the ground index Z in inches. It is labeled "ground index (study forwarder)", **not** a prediction for a specific truck.
   - *Why a reference machine (decided 2026-10-17, during implementation):*
     - Road-truck tires at 100+ psi fall below the study's NCI range.
     - With the Table 5 rescale, every truck clamps to the same 7.3 in on native ground, whatever the moisture.
     - Without the rescale, Eq 4 underpredicts the study's own ruts by about 3×.
4. **Hybrid NRCS rule** (agreed; truck part revised 2026-10-17):
   - **Road trucks** (bucket/line, dump, lowboy):
     - The flag is the **worse of** the ground-index flag and the NRCS MIL type-7 rating (poor → hold, fair → inspect). NRCS rutting hazard = Severe gives at least inspect.
     - All three are rear-wheel-drive road trucks, NRCS MIL type 7, so they share one flag until fleet-specific validation exists.
   - **Organic soils** (USCS `PT` or OM > 20 %, such as West County muck) are outside STRAM. They are NRCS-only, with a minimum of inspect.
   - **Tracked.** The flag comes from `mil_traf_t{type}_{season}`:
     - Season is dry when the wetness class is very dry or dry, otherwise wet.
     - Passes ≤ 2 use `wet1`; more passes use `wet50`.
     - Poor → hold, fair → inspect, good → ok.
5. **Wet-area override** (study §3.1 / Fig 8): DTW_eff < 1.6 ft (0.5 m) makes a cell at least inspect, and hold when the wetness class is wet. It applies only to moist and wet forecasts, as does the NRCS Severe rule (see Decisions).
6. **Flags, polygons, segments and score:**
   - Z ≥ 4 in (≈10 cm) → inspect; Z ≥ 8 in (≈20 cm) → hold. These are the agreed 10 and 20 cm, rounded for US display.
   - Group flagged cells within 100 ft of a mapped route into polygons (`rasterio.features.shapes`). Acres are counted in that corridor only (see Decisions).
   - A segment's flag is the worst along it. Each segment and plant reports affected acres and intersected length (ft/mi).
   - Score is piecewise linear in Z: 0→0, 2 in→2, 4→4, 8→6.5, 16→9, ≥24 in→10. An NRCS or override flag scores at least 4 (inspect) or 6.5 (hold).
   - Plant score = max over segments and equipment (agreed); with no routes, the plant cell is used. `score_p90`, the score exceeded by 10 % of route length, is also reported, and `push --metric p90` can use it instead.
7. **Uncertainty kept separate** (per `plan.md`):
   - Ground-response band: ±3.5 in, from the Eq 5 RMSE of 9.0 cm in Table 7.
   - Forecast range: rut depth recomputed at the min and max soil moisture across the Open-Meteo models that offer it.
   - Both appear in the outputs and are never merged.
8. **Outputs:** one folder per run, `models/mud-trafficability/output/run_<UTC stamp>/`. `output/LATEST` names the newest run.
   - `segments/<eia>.geojson` and `polygons/<eia>.geojson`, holding Z, flag, flag source, drivers, both uncertainty ranges, the vehicle and pass assumptions, the prediction time and window, `extrapolated` reasons, and `locally_validated=false`.
   - `sites.csv`: one row per site, horizon, machine class and pass count.
   - `agreement.csv`, comparing the STRAM wet case with the NRCS rutting hazard, plus Spearman ρ in `run.json`.
   - `map.html` (overview) and `map/<eia>.html` (one page per site, linked to the others).
   - `ml_scores_push.sql` or `ml_scores_clear.sql`, written by `push`.

## UX requirements (map)
- Polygons and segments colored by flag, with line style too (dashed = extrapolated, dotted = NRCS-set flag).
- Equipment, passes and day selectors.
- A popup showing the drivers, both uncertainty ranges and the assumptions.
- A permanent banner: *"STRAM-inspired, uncalibrated. Prioritizes inspection; does not certify a crossing is safe."*
- Leaflet from cdnjs. Works at phone width.

## Technical constraints and integrations
- Python 3.11 `.venv`, run from inside `models/mud-trafficability/`. The soil fetch runs from `data/soil-data/`.
- Add to `requirements.txt`: numpy, scipy, scikit-image, rasterio, pysheds, shapely, pyproj. If pysheds won't install, use an in-repo priority-flood + D8 implementation.
- **ml_scores push:**
  - SQL joins `sites.eia_plant_id` and calls `upsert_ml_scores`, with `model_version='stram-inspired-nrcs-0.1'`.
  - Apply with `supabase db query --linked -f …` only after the user confirms each time.
  - `--clear` removes the rows. No service-role key is handled.
- Cache in `cache/`. Both `cache/` and `output/` are gitignored.

## Data, privacy, security
- Public, keyless sources only. No crew data. No secrets written.

## Acceptance criteria
1. `python -m unittest discover -s tests` passes:
   - US and SI parity for Eq 1–7. The converter already shows identical rut results.
   - The rescaled Eq 4 reproduces Table 5 NCI within ±10 %.
   - Eq 5 reproduces the Table 5 block means within 1 SD.
   - DTW on a synthetic valley, plus the water-table cap.
   - Domain guard, wet-area override and hybrid NRCS rules, on the 3 real `example_soil_plants.csv` rows. Under a wet forecast, muck (56407) and clay (61666) come out at least inspect.
2. `python -m stram prepare --eia 649,56407,6008` then `forecast` produce non-empty outputs for Vogtle GA, West County FL and Palo Verde AZ. West County has more flagged acres and route length than Palo Verde.
3. The full 60-site run completes. Missing routes and missing soils are handled and tagged.
4. `agreement.csv` and `run.json` report ρ. It is informational, not a gate.
5. `ml_scores_push.sql` holds 120 rows. After user approval, hosted `ml_scores` is populated, and `npm run verify:rules` and `verify:monitoring` still pass. *Status 2026-10-17: the SQL is generated and checked (120 rows). The user chose **not to push yet**, so the hosted half of this criterion is deferred.*
6. Every output carries the STRAM-inspired / not-a-clearance label and `locally_validated=false`.

## Decisions made during implementation (2026-10-17)
These were found with real data from Vogtle, West County and Palo Verde. The user chose the ones marked *agreed*; the others are fixes that keep to the brief's intent.
- **The reference forwarder uses the paper's NCI/CI, 2.008 per MPa** (*agreed*, replacing 0.253 × Eq 4). See "Eq 4 mismatch: evidence".
- **Trucks use a reference machine** (*agreed*). STRAM runs for the study's own forwarder as a ground-condition index. Trucks take the worse of that index and NRCS MIL type 7. Without this, the Table 5 rescale clamps every 100 psi truck to a flat 7.3 in.
- **Default view is 1 pass** (*agreed*). At 2+ passes the ground index sits at about 4 in (the inspect line) on most firm ground in any weather. That matches the study, whose blocks averaged 13–22 cm. One pass is below the study's observed 2–80 and is labeled as a mild extrapolation.
- **Eq 1 constants found:** k_mc = 0.5 m⁻¹ and p_mc = 1.5 (Jones & Arp 2019).
- **MIL classes checked on SDA:** Poor < 0.50, Fair 0.50–0.73, Good 0.79–0.90, Excellent ≥ 0.92, and higher is better. Cut points are set at 0.50 and 0.76.
- **Wet-condition rules only in moist or wet forecasts.** These are the wet-area override and NRCS Severe rutting hazard → inspect.
  - In dry weather, flat desert reads as "wet area", because dry washes count as channels.
  - Many desert loams are rated Severe for wet-season rutting. Palo Verde would be flagged on dry days.
- **DTW_eff ≥ 2 m** where SSURGO has no water table and the soil is well, somewhat excessively or excessively drained. NRCS reads that as no water table within 200 cm.
- **The water-table cap only applies in moist or wet forecasts.** SSURGO's `wt_depth_annual_min` is the year's shallowest (wet-season) depth. Applied every day, it capped DTW on 81 % of route cells at the median site, and 90 % of dry-day truck flags traced back to it. With the gate, dry-day STRAM-inspect drops from 29.9 % to 22.4 % of route length.
- **Affected areas are limited to 100 ft either side of mapped routes.** Off-route native ground (Track = 0) sits at the inspect line almost everywhere, and over the full tile it swamped the acreage (Palo Verde 3,900 ac). This follows `plan.md`'s step of intersecting affected areas with access roads.
- **DTW_top is the tile's 95th percentile.** The study used DTW at the block's highest point, which is noisier on 10 m data.
- **Map is split into pages.** Embedding all 60 sites would make a page of about 110 MB, so there is an overview plus one page per site. Ground index, ranges and drivers are shown for now and tomorrow; other days show flag and source.
- **What still flags trucks on dry days (60 sites, tomorrow, 1 pass):**
  - 22 % of route length is STRAM-inspect, on flat, low-DTW ground where the study's equations sit at the 4 in line.
  - 27 % comes from NRCS's static dry-season ratings for type-7 trucks (loose sand, slope, wet clays).
  - The median site has 45 % of its route flagged.
  - This is the transfer limitation `plan.md` warns about, and the main reason to run the validation pilot.
- **STRAM and NRCS agree moderately across the 60 sites:** Spearman ρ = 0.38 (p = 0.003). That is consistent, but it is not validation.
- **Finding to act on before any push:** with the agreed worst-segment score, a few static NRCS "hold" segments put every demo site at 6.5 every day. The p90 metric separates them (Palo Verde 3.3).

## Eq 4 mismatch: evidence (checked 2026-10-17)
**Fact: Table 5's NCI is one fixed multiple of CI per machine.** The mean, min, max and SD all fit it. Allowing ±0.005 for the 2-decimal rounding:

| Machine | NCI per MPa |
|---|---|
| JD1510E (Blocks 1 and 2) | 2.006–2.012 |
| JD1110E (Block 3) | 1.942–1.948 |
| Tigercat 635D (Block 9) | 1.562–1.568 |

So the paper computed NCI from the same plot CI values it reports. A CI from another depth or position is ruled out. The gap is in the machine term, or in a constant unit factor; the data cannot separate those two.

**Strong evidence, not proof: the two JD machines' weights were swapped somewhere.**
- The machines have identical tires and pressure, so under Eq 4 the JD1510E/JD1110E ratio should be √(269.68/287.34) = 0.969.
- Table 5 allows only 1.030–1.036, which contains the swapped value √(287.34/269.68) = 1.032.
- The match is to the ±0.3 % that rounding permits, not to five significant figures. One external analysis claimed five; its 1.9456 for Block 3 was derived by assuming the ratio.
- The swap could be in the authors' calculation, in Table 3's column labels, or in the text that assigns machines to blocks.
- Front chains (JD1110E) versus front tracks (JD1510E) could also shift NCI.
- `tests/test_equations.py::test_table5_points_to_swapped_jd_weights` checks the bands.

**Unexplained:**
- With the weights swapped back, both JD machines need the same factor, 3.76–3.78, between Eq 4 and Table 5. That follows from the swap; it is not separate evidence. Its cause is unknown. Putting total weight in Eq 4's leading term would divide NCI by 8, or by 4 per bogie, not by 3.77.
- The Tigercat's 4.26× gap. An external search found Table 3 column and wheel-count combinations within 3 % of it, but only after trying about 250 of them. That is overfitting, not an explanation.

**What would settle it:** the authors' plot-level data or spreadsheet, the printed Eq 4 in the PDF (the web text drops the square-root structure), the machine data in Jones et al. (2018), and the NCI formulation in Vega-Nieva et al. (2009).

**Effect on the model: controlled A/B, 2026-10-18.**

*Method.* Both arms used the same weather snapshot (`cache/weather_20261018T00_0a2908f01c.json`), the same instant (2026-10-18T00:33Z), and the same cached terrain, soils and routes. Only the reference NCI differed: old = 0.253 × Eq 4 = 1.855 per MPa; new = 2.008 per MPa. Scope was all 60 sites. Results are for tomorrow, 1 pass, unless stated.

| Check | Result |
|---|---|
| Ground index new/old, per cell (14.5 M mineral cells) | 0.924–1.000, median 0.968. The NCI change alone bounds it at 0.924–1.0. |
| Flags made worse (any machine, pass count or day) | 0 |
| Machine classes affected | Road trucks only; tracked flags come from NRCS. |
| Route length whose flag changed | 5.0 %, all inspect → ok, all set by STRAM |
| STRAM-inspect share of route length | 22.5 % → 16.8 % |
| Median flagged route share per site | 44.6 % → 36.7 % |
| Sites whose tomorrow site score changes | 20/60 (worst-segment), 32/60 (p90) |
| Demo trio | West County −273 ft of flagged route; Palo Verde and Vogtle unchanged |

An earlier comparison between two separate runs gave 22.4 % → 16.8 %. The newer weather hour in that comparison made a negligible difference.

*Check against the paper's measured ruts* (Eq 5 at the Table 5 means, JD1510E):

| Block | Old NCI → rut | New NCI → rut | Measured |
|---|---|---|---|
| 1 | 4.47 → 14.0 cm | 4.84 → 13.6 cm | 15.6 ± 6.7 cm |
| 2 | 3.58 → 15.8 cm | 3.88 → 15.4 cm | 13.3 ± 10.5 cm |

The two differ by 0.4 cm, well inside the measured spread. Old is closer for Block 1 and new for Block 2.

*Conclusion.*
- **Shown:** the change works as intended. It is limited to road-truck STRAM flags, only ever lowers the ground index, and its size matches the 7.6 % NCI correction.
- **Shown:** the new NCI matches the paper's NCI scale, which Eq 5 was fitted on.
- **Not shown:** that the model got more accurate. It is a consistency correction.
- **Also measured:** every segment's ground index lies within the Eq 5 error band (±3.5 in) of the 4 in line, so no single STRAM flag can be told apart from the threshold given the paper's own model error. Only the field pilot can test accuracy.
- `tests/test_equations.py::test_reference_nci_only_lowers_the_index_within_bound` guards the "only lowers, by at most 7.6 %" property.

## Operational validation plan (out of scope to run; documented)
This is the pilot from `plan.md`, using paired observations:
- location and time;
- soil or road-surface type;
- moisture;
- cone index and its depth;
- vehicle spec and load;
- existing track condition;
- number of passes;
- rut depth after traffic;
- outcome.

Evaluate with whole sites and later periods held out, and test the full chain, not just intermediate values. Those observations then replace the coefficients and the reference NCI/CI, enable a Random Forest, and calibrate the MIL vehicle-type mapping.

## Assumptions (defaults chosen, not explicitly agreed)
- **Soil moisture:** Open-Meteo grid moisture stands in for ForHyM. Spatial variation within a site comes from DTW_eff, soils and the Track mask.
- **Eq 1 constants:** k_mc = 0.5 m⁻¹ and p_mc = 1.5, from Jones & Arp 2019 (doi 10.4236/ojf.2019.92005). They were calibrated there for New Brunswick, like everything else.
- **Wetness → FIA thresholds** are new; they aren't from the study.
- **MIL vehicle types** (verify against FM 5-430-00-1 Table 7-3, which was unreachable this session):

  | Equipment | Type |
  |---|---|
  | Excavator | 3 |
  | Crawler crane | 4 |
  | Rear-wheel-drive trucks | 7 |
  | All-wheel-drive trucks | 6 |

- **MIL cut points:** poor < 0.50, fair 0.50–0.76, good ≥ 0.76. Checked on SDA 2026-10-17: the classes are Poor 0–0.49, Fair 0.50–0.73, Good 0.79–0.90 and Excellent 0.92–1, and higher means better.
- **Equipment:**
  - STRAM runs only for the reference forwarder (Table 3).
  - Machine classes shown to users: road trucks (MIL 7), a 30 t tracked excavator (MIL 3) and a 100 t crawler crane (MIL 4).
- **Rounded thresholds:** 4 in and 8 in stand in for the agreed 10 cm and 20 cm.

## Risks
- **Unvalidated transfer.** The model is calibrated on New Brunswick loamy-sand forests and forwarders at 32 psi. US sands, clays and muck are outside that range.
  - Road tires at 100+ psi are too, which is why trucks use the reference forwarder plus NRCS.
  - NRCS narrows the gap but doesn't close it.
- **Trucks are under-resolved.** The ground index is computed for a forwarder, which is gentler on the ground than a 100 psi truck tire. For trucks, the machine-specific signal comes only from the static NRCS type-7 rating.
- **Eq 4 cannot reproduce the paper's NCI.** The model avoids Eq 4 for the reference machine by using the paper's NCI/CI directly. The cause of the gap is only partly understood (see "Eq 4 mismatch: evidence"). Any machine other than the study's three forwarders still has no trustworthy NCI.
- **Eq 3 compresses CI** (about 145–360 psi), which underestimates how weak saturated ground is. The wet-area override and the NRCS checks offset this.
- **NRCS ratings don't respond to weather.** Only the season and pass choice does.
- **Full 0–10 feed** (agreed): `compute_site_risk` uses max(ML, subscores) with no staleness check.
  - A rut score raises risk for every crew at the site and persists until it's overwritten.
  - `plan.md` warns that the paper's rut criteria aren't safety thresholds. So no alerts are raised, and only the risk number moves.
  - Mitigation: re-run daily during the demo, then `--clear`.
- **Table 4 vs the results text** assign FIA differently to Blocks 1 and 2 (noted in `plan.md`). Tests use Table 5's DTW values, not FIA.
- **OSM coverage** of on-site haul roads is incomplete.

## Open questions
1. The real cause of the Eq 4 mismatch. Check Vega-Nieva 2009 and Jones & Arp 2019 for their NCI formulation.
2. Driver label "ML hazard index" → "rutting", and an `ml_scores` staleness cutoff. Both need migrations.
3. A `soft_ground` crew hazard type with rut depth, for collecting ground truth. Note that the crew app is on the local project.
4. Real fleet specs.
5. `conversion_table.md` and `example_USDA_SSURGO_data_conversion.py` are empty. The user appears to be writing them, so they are left untouched.
