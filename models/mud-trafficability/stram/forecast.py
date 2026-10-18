"""Per-site forecast: soil rasters + terrain + routes + weather -> flags on a 10 m grid -> polygons and segments.

Everything here is computed in US units on the site's UTM grid. See ../PROJECT_BRIEF.md for the rules.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from rasterio.features import shapes as raster_shapes
from shapely.geometry import mapping, shape
from shapely.ops import transform as shp_transform, unary_union

from . import config as C, equations as E, rules as R
from .sites import Site
from .terrain import Grid

NUMERIC = ("sand_pct", "clay_pct", "om_pct", "bulk_density_g_cm3", "coarse_frag_pct", "wt_depth_annual_min_cm",
           *(f"mil_traf_t{t}_{s}" for t in sorted({e.mil_type for e in C.EQUIPMENT.values()}) for s in ("wet1", "wet50", "dry")))
CATEGORICAL = ("uscs_surface", "rutting_hazard_class", "drainage_class", "dominant_muname")
PASSES = C.PASSES_SHOWN
ACRES_PER_CELL = C.GRID_RES_M ** 2 * C.SQM_TO_ACRES


def _num(v):
    try:
        v = float(v)
    except (TypeError, ValueError):
        return np.nan
    return v


def soil_rasters(tile: dict, plant_row: dict | None) -> dict:
    """Per-cell soil properties. Map units without data (Urban land, Water, unmapped) inherit the plant row."""
    units, idx = tile["units"], tile["index"]
    plant = plant_row or {}
    lookup = np.where(idx >= 0, idx, len(units))
    out = {}
    for col in NUMERIC:
        fallback = _num(plant.get(col))
        vals = [(_num(u.get(col)) if np.isfinite(_num(u.get(col))) else fallback) for u in units] + [fallback]
        out[col] = np.asarray(vals, dtype=float)[lookup]
    for col in CATEGORICAL:
        fallback = plant.get(col) or None
        vals = [(u.get(col) or fallback) for u in units] + [fallback]
        out[col] = np.asarray(vals, dtype=object)[lookup]
    out["soil_unknown"] = np.isnan(out["bulk_density_g_cm3"]) & np.isnan(out["om_pct"])
    out["organic"] = (np.nan_to_num(out["om_pct"]) > C.ORGANIC_OM_PCT) | np.char.startswith(
        out["uscs_surface"].astype(str), "PT")
    out["rut_severe"] = out["rutting_hazard_class"] == "Severe"
    out["well_drained_no_wt"] = np.isin(out["drainage_class"], C.WELL_DRAINED) & np.isnan(out["wt_depth_annual_min_cm"])
    out["out_of_domain"] = np.zeros(idx.shape, bool)
    for key, (lo, hi) in C.DOMAIN.items():
        v = out[key]
        out["out_of_domain"] |= np.isfinite(v) & ((v < lo) | (v > hi))
    return out


def dtw_effective(dtw_m: np.ndarray, soil: dict, wet_class: str) -> np.ndarray:
    """DEM DTW (ft), floored at 2 m where SSURGO says there is no water table within 200 cm. In moist and wet
    forecasts it is also capped by SSURGO's annual-minimum water table. That depth is the year's shallowest, a
    wet-season value, so applying it on dry days made poorly drained ground read wet every day (it bound on 81 % of
    route cells at the median site)."""
    d = dtw_m * C.M_TO_FT
    if wet_class in R.WET:
        wt = soil["wt_depth_annual_min_cm"] / 100.0 * C.M_TO_FT
        d = np.where(np.isfinite(wt), np.minimum(d, wt), d)
    return np.where(soil["well_drained_no_wt"], np.maximum(d, C.NO_WATER_TABLE_DTW_M * C.M_TO_FT), d)


def ground_index(theta: float, d_ft, soil: dict, track, passes: int):
    """STRAM chain for the reference forwarder: Eq 1 -> Eq 3 -> paper NCI/CI -> Eq 5 x Eq 7. Returns rasters."""
    db = np.where(np.isfinite(soil["bulk_density_g_cm3"]), soil["bulk_density_g_cm3"], 1.4)
    d_top = float(np.nanpercentile(d_ft, C.DTW_TOP_PERCENTILE))
    mc = E.eq1_mc_ps_dtw(d_ft, d_top, E.mc_ps_from_theta(theta, db))
    ci = E.eq3_ci_psi(mc, C.CI_DEPTH_IN, track)
    nci = E.reference_nci(ci)
    cf = np.nan_to_num(soil["coarse_frag_pct"] / 100.0)
    z, nci_adj, out = E.eq5_rut_in(nci, passes, d_ft, cf)
    z = np.where(soil["organic"], np.nan, z)  # outside STRAM: NRCS decides
    return {"z": z, "mc": mc, "ci": ci, "nci_adj": nci_adj, "nci_out": out}


def _weighted_p90(scores: list[float], lengths: np.ndarray) -> float:
    """Score exceeded by 10 % of route length: a steadier site summary than the single worst segment."""
    order = np.argsort(scores)
    cum = np.cumsum(lengths[order]) / lengths.sum()
    return round(float(np.asarray(scores)[order][np.searchsorted(cum, 0.9)]), 1)


@dataclass
class SegmentIndex:
    """Grid cells under each segment, sampled every 5 m."""
    cells: list[np.ndarray]
    length_ft: np.ndarray


def index_segments(segs: list[dict], grid: Grid) -> SegmentIndex:
    inv = ~grid.transform
    cells, lengths = [], []
    for s in segs:
        g = s["geom"]
        pts = [g.interpolate(d) for d in np.append(np.arange(0.0, g.length, 5.0), g.length)]
        cols, rows = zip(*(inv * (p.x, p.y) for p in pts))
        r = np.clip(np.asarray(rows, dtype=int), 0, grid.n - 1)
        c = np.clip(np.asarray(cols, dtype=int), 0, grid.n - 1)
        cells.append(np.unique(r * grid.n + c))
        lengths.append(g.length * C.M_TO_FT)
    return SegmentIndex(cells, np.asarray(lengths))


def polygons(flag: np.ndarray, grid: Grid) -> list[dict]:
    """Inspect and hold areas as simplified WGS84 polygons with their acreage."""
    to_wgs = grid.to_wgs84()
    out = []
    for level in (R.INSPECT, R.HOLD):
        mask = flag == level
        if not mask.any():
            continue
        geoms = [shape(g) for g, v in raster_shapes(mask.astype(np.uint8), mask=mask, transform=grid.transform) if v == 1]
        merged = unary_union(geoms).simplify(C.GRID_RES_M / 2, preserve_topology=True)
        out.append({"flag": C.FLAGS[level], "acres": round(float(mask.sum() * ACRES_PER_CELL), 1),
                    "geometry": mapping(shp_transform(to_wgs.transform, merged))})
    return out


def run_site(site: Site, grid: Grid, terrain: dict, tile: dict, plant_row: dict | None, segs: list[dict],
             track: np.ndarray, corridor: np.ndarray, horizons: list[dict], polygon_horizons: tuple[str, ...]) -> dict:
    """corridor: cells within CORRIDOR_FT of a mapped route. Affected areas and acres are counted only there, because
    off-route native ground (Track = 0) sits at the inspect line nearly everywhere and would swamp the polygons."""
    soil = soil_rasters(tile, plant_row)
    seg_index = index_segments(segs, grid)
    plant_cell = grid.cell_of(*grid.to_utm().transform(site.lon, site.lat))
    plant_flat = plant_cell[0] * grid.n + plant_cell[1] if plant_cell else None

    seg_results = [dict() for _ in segs]  # key "<equipment>|<passes>|<horizon>" -> [flag, source, score, z, zlo, zhi, flagged_ft]
    seg_drivers = [dict() for _ in segs]  # horizon -> [mc_ps, ci_psi, nci_adj, dtw_eff_ft] at the segment's worst cell
    seg_out_of_domain = np.zeros(len(segs), bool)
    summaries, polys = [], []
    for h in horizons:
        wet = R.wetness_class(h["rain_in"])
        fia = C.WETNESS_FIA_HA[wet]
        d = dtw_effective(terrain["dtw_m"][fia], soil, wet)
        for passes in PASSES:
            gi = ground_index(h["theta"], d, soil, track, passes)
            z_lo = ground_index(h["theta_min"], d, soil, track, passes)["z"]
            z_hi = ground_index(h["theta_max"], d, soil, track, passes)["z"]
            extrap = soil["out_of_domain"] | gi["nci_out"]
            for eq in C.EQUIPMENT.values():
                mil = soil[R.mil_column(eq.mil_type, wet, passes)]
                flag, source = R.combine(eq, z_in=gi["z"], mil=mil, organic=soil["organic"],
                                         soil_unknown=soil["soil_unknown"], rut_severe=soil["rut_severe"],
                                         dtw_eff_ft=d, wet_class=wet)
                score = R.score(eq, gi["z"], flag, soil["organic"])
                key = f"{eq.key}|{passes}|{h['key']}"
                ff, fs, fz, fl, fh, fsrc = (a.ravel() for a in (flag, score, gi["z"], z_lo, z_hi, source))
                flagged_ft = 0.0
                worst = None
                for i, cells in enumerate(seg_index.cells):
                    j = cells[np.lexsort((fs[cells], ff[cells]))[-1]]  # highest flag, then highest score
                    frac = float((ff[cells] >= R.INSPECT).mean())
                    zz = (None if eq.kind != "wheeled" or not np.isfinite(fz[j]) else
                          [round(float(fz[j]), 1), round(float(fl[j]), 1), round(float(fh[j]), 1)])
                    seg_results[i][key] = [int(ff[j]), int(fsrc[j]), round(float(fs[j]), 1),
                                           *(zz or [None, None, None]), round(frac * seg_index.length_ft[i])]
                    flagged_ft += frac * seg_index.length_ft[i]
                    if worst is None or (ff[j], fs[j]) > worst[:2]:
                        worst = (ff[j], fs[j], segs[i]["id"])
                    if passes == C.DEFAULT_PASSES and eq.key == "road_truck":
                        seg_drivers[i][h["key"]] = [round(float(gi["mc"].ravel()[j]), 1), round(float(gi["ci"].ravel()[j])),
                                                    round(float(gi["nci_adj"].ravel()[j]), 2), round(float(d.ravel()[j]), 1)]
                        seg_out_of_domain[i] |= bool(extrap.ravel()[cells].any())
                plant = None if plant_flat is None else {
                    "flag": C.FLAGS[int(ff[plant_flat])], "score": round(float(fs[plant_flat]), 1),
                    "z_in": None if eq.kind != "wheeled" or not np.isfinite(fz[plant_flat]) else round(float(fz[plant_flat]), 1)}
                site_score = max((r[key][2] for r in seg_results), default=plant["score"] if plant else 0.0)
                site_p90 = _weighted_p90([r[key][2] for r in seg_results], seg_index.length_ft) if segs else site_score
                summaries.append({
                    "eia": site.eia, "site": site.name, "horizon": h["key"], "label": h["label"], "date": h["date"],
                    "equipment": eq.key, "passes": passes, "wetness": wet, "fia_ha": fia, "rain_in": round(h["rain_in"], 2),
                    "theta": round(h["theta"], 3), "theta_min": round(h["theta_min"], 3), "theta_max": round(h["theta_max"], 3),
                    "frozen": h["frozen"], "score": site_score, "score_p90": site_p90,
                    "worst_flag": C.FLAGS[int(worst[0])] if worst else (plant["flag"] if plant else "ok"),
                    "worst_segment": worst[2] if worst else None,
                    "inspect_acres": round(float(((flag == R.INSPECT) & corridor).sum() * ACRES_PER_CELL), 1),
                    "hold_acres": round(float(((flag == R.HOLD) & corridor).sum() * ACRES_PER_CELL), 1),
                    "corridor_acres": round(float(corridor.sum() * ACRES_PER_CELL), 1),
                    "flagged_route_ft": round(flagged_ft), "route_ft": round(float(seg_index.length_ft.sum())),
                    "segments": len(segs), "plant_cell": plant,
                })
                if passes == C.DEFAULT_PASSES and h["key"] in polygon_horizons:
                    for p in polygons(np.where(corridor, flag, R.OK), grid):
                        polys.append({**p, "equipment": eq.key, "horizon": h["key"]})

    soil_ok = ~soil["soil_unknown"]
    to_wgs = grid.to_wgs84()
    features = []
    for i, s in enumerate(segs):
        mid = s["geom"].interpolate(0.5, normalized=True)
        cell = grid.cell_of(mid.x, mid.y)
        flat = cell[0] * grid.n + cell[1] if cell else 0
        features.append({"type": "Feature", "geometry": mapping(shp_transform(to_wgs.transform, s["geom"])), "properties": {
            "site": site.eia, "id": s["id"], "osm_id": s["osm_id"], "highway": s["highway"], "surface": s["surface"],
            "surface_confidence": s["surface_confidence"], "name": s["name"],
            "length_ft": round(float(seg_index.length_ft[i])),
            "soil": soil["dominant_muname"].ravel()[flat], "organic": bool(soil["organic"].ravel()[flat]),
            "extrapolated": bool(seg_out_of_domain[i]), "locally_validated": False,
            "r": seg_results[i], "d": seg_drivers[i]}})
    extrap_reasons = E.domain_reasons({k: float(np.nanmedian(soil[k][soil_ok])) if soil_ok.any() else None for k in C.DOMAIN})
    return {"summaries": summaries, "segments": features, "polygons": polys,
            "soil": {"organic_frac": round(float(soil["organic"].mean()), 3),
                     "unknown_frac": round(float(soil["soil_unknown"].mean()), 3),
                     "median_domain_reasons": extrap_reasons, "vintages": tile.get("vintages", {})},
            "agreement": agreement_row(site, soil, terrain["dtw_m"], track, plant_row, seg_index)}


def agreement_row(site: Site, soil: dict, dtw_m: dict, track, plant_row: dict | None, seg_index: SegmentIndex) -> dict:
    """STRAM wet case (pore space 90 % full, wettest FIA, default passes) on route cells, beside the NRCS rutting
    hazard. Both rise with rutting, so agreement shows up as a positive rank correlation across sites."""
    d = dtw_effective(dtw_m[C.WETNESS_FIA_HA["wet"]], soil, "wet")
    db = np.where(np.isfinite(soil["bulk_density_g_cm3"]), soil["bulk_density_g_cm3"], 1.4)
    theta = 0.9 * float(np.nanmedian(E.porosity(db)))
    z = ground_index(theta, d, soil, track, C.DEFAULT_PASSES)["z"].ravel()
    cells = np.unique(np.concatenate(seg_index.cells)) if seg_index.cells else np.arange(z.size)
    zc = z[cells]
    plant = plant_row or {}
    return {"eia": site.eia, "site": site.name,
            "stram_wet_median_in": round(float(np.nanmedian(zc)), 2) if np.isfinite(zc).any() else None,
            "stram_wet_p90_in": round(float(np.nanpercentile(zc, 90)), 2) if np.isfinite(zc).any() else None,
            "organic_frac": round(float(soil["organic"].ravel()[cells].mean()), 3),
            "nrcs_rutting_hazard": plant.get("rutting_hazard"), "nrcs_rutting_class": plant.get("rutting_hazard_class"),
            "nrcs_mil_t7_wet1": plant.get("mil_traf_t7_wet1")}
