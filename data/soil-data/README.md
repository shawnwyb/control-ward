# soil-data

`ssurgo_fetch.py` pulls SSURGO soil properties from USDA NRCS Soil Data Access
(`SDMDataAccess.sc.egov.usda.gov/Tabular/post.rest`), a free public SQL service with
no key required. For each EIA-860M power plant in
`../power-plants/august_generator2026.xlsx` it writes one flat row. The row holds the
static soil inputs for the mud-trafficability model (`models/mud-trafficability/`).

Run it from this directory:

```sh
python ssurgo_fetch.py plants --state FL                  # -> soil_plants_FL_250m.csv (~30 s, 346 plants)
python ssurgo_fetch.py plants --plant-id 136 --format json
python ssurgo_fetch.py query "SELECT TOP 5 * FROM sacatalog"   # raw SQL, for exploring the schema
```

`example_soil_plants.csv` is a real 3-plant sample, with its manifest, made with
`python ssurgo_fetch.py plants --plant-id 136 --plant-id 61666 --plant-id 56407 --out example_soil_plants.csv`.
The three plants show three different soils: dry sand (136 Seminole), plastic clay
(61666 Peace Creek Solar), and drained muck (56407 West County).

For all options, see the module docstring or `python ssurgo_fetch.py plants --help`. Every
output file gets a `<out>.manifest.json` sidecar. It records the request log, a SHA-256 of
the output, the row count, and the SSURGO survey-area vintages (`saverest`) used.

## How a row is built

- A point at a plant usually falls on "Urban land", which has no soil data. So each plant is
  a 250 m buffer (`--radius-m`).
- Each map unit is weighted by its share of the buffer area. Each component is weighted by
  that share × `comppct_r`.
- Horizon properties are depth-weighted means over 0–30 cm (`--depth-cm`). They include only
  components that report them.
- If less than 20% of the buffer has soil data (`--min-coverage`), the plant is retried at
  1000 m (`--fallback-radius-m`). The larger buffer is kept only if it has more coverage.
- Categorical columns hold the value with the largest weight.

## Columns

| Column | Meaning |
| :--- | :--- |
| `plant_id` … `lon` | EIA-860M plant identity. `technology` lists every generator technology at the plant. |
| `radius_m_used` | Buffer radius used for this row (250, or 1000 after a fallback). |
| `mapped_frac` | Share of the buffer covered by SSURGO polygons. It is below 1 offshore or at survey gaps. |
| `soil_coverage_frac` | Share of the buffer whose components have 0–30 cm horizon data. |
| `urban_frac`, `water_frac` | Share of the buffer that is "Urban land" or "Water" components. |
| `dominant_mukey`, `dominant_muname`, `areasymbol`, `survey_saverest` | Map unit with the largest area in the buffer, its survey area, and that survey's last-export date. |
| `dominant_component` | Component name with the largest weight. This can be "Urban land". |
| `sand_pct`, `silt_pct`, `clay_pct`, `om_pct` | Texture and organic matter, % (chorizon `*_r`). |
| `bulk_density_g_cm3` | Bulk density at 1/3 bar (`dbthirdbar_r`). |
| `coarse_frag_pct` | Coarse fragment volume, % (sum of `chfrags.fragvol_r`). |
| `ksat_um_s`, `awc_cm_cm` | Saturated hydraulic conductivity (µm/s) and available water capacity (cm/cm). |
| `liquid_limit`, `plasticity_index` | Atterberg limits. |
| `uscs_surface` | Unified (USCS) class of the uppermost horizon. PT means peat or muck. |
| `drainage_class`, `hydrologic_group` | Component drainage class and hydrologic soil group. |
| `wt_depth_annual_min_cm` | Shallowest annual water-table depth (`muaggatt.wtdepannmin`). Null means no water table within 200 cm, or the field is not populated. |
| `flood_freq` | Dominant flooding frequency class. SSURGO's class "None" is written as "No flooding", because pandas reads the string "None" as missing. |
| `pond_freq_pct`, `slope_pct` | Ponding frequency (%) and slope gradient (%), from `muaggatt`. |
| `rutting_hazard`, `rutting_hazard_class` | NRCS "FOR - Soil Rutting Hazard". Fuzzy value from 0 to 1; **higher means more rutting**. |
| `harvest_equip_operability` | NRCS "FOR - Harvest Equipment Operability". Fuzzy value from 0 to 1; higher means more limited. |
| `mil_traf_t{1..7}_{wet1,wet50,dry}` | NRCS "MIL - Trafficability (DOD)" for vehicle types 1–7. The suffix gives the season and passes: wet season with 1 pass, wet season with 50 passes, or dry season. Fuzzy value from 0 to 1; **higher means better trafficability**. |
