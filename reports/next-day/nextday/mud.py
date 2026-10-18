"""Mud routes section: reads the newest run of models/mud-trafficability (output/LATEST). The model is a
STRAM-inspired rutting forecast for OSM unpaved ways within 2 km of each plant. It is uncalibrated and
flags routes for inspection. It does not certify a crossing is safe, and the report keeps that label."""
from __future__ import annotations

import csv
import json
from datetime import datetime, timezone
from pathlib import Path

from . import paths

FLAGS = ("ok", "inspect", "hold")        # index into the per-segment flag value; matches run.json "flags"
EQUIPMENT = ("road_truck", "excavator", "crawler_crane")
DEFAULT_EQUIPMENT = "road_truck"
PASSES = 1
STALE_HOURS = 24
MISSING_HOURS = 48


def latest_run(output_dir: Path = paths.MUD_OUTPUT) -> Path | None:
    f = Path(output_dir) / "LATEST"
    if not f.is_file():
        return None
    run = Path(output_dir) / f.read_text(encoding="utf-8").strip()
    return run if (run / "run.json").is_file() else None


def _round_coords(geom: dict, digits: int = 5) -> dict:
    return {"type": geom["type"], "coordinates": [[round(x, digits), round(y, digits)] for x, y in geom["coordinates"]]}


def build(eia: str, for_date: str, as_of: datetime, run_dir: Path | None = None) -> tuple[dict, dict | None]:
    """Returns (section, GeoJSON of the inspect/hold routes or None)."""
    run_dir = run_dir or latest_run()
    cmd = "models/mud-trafficability/run_daily.sh"
    if run_dir is None:
        return {"status": "missing", "reason": f"No mud-trafficability run found. Run `{cmd}` first."}, None
    run = json.loads((run_dir / "run.json").read_text(encoding="utf-8"))
    site = next((s for s in run["sites"] if str(s["eia"]) == eia), None)
    if site is None:
        return {"status": "not_applicable", "reason": "The mud model has no run for this plant."}, None
    horizon = next((h for h in site["horizons"] if h["date"] == for_date), None)
    if horizon is None:
        return {"status": "missing", "reason": f"The newest mud run covers {site['horizons'][0]['date']} to "
                f"{site['horizons'][-1]['date']}, not {for_date}. Run `{cmd}` again."}, None
    generated = datetime.fromisoformat(run["generated_at"]).astimezone(timezone.utc)
    age_h = (as_of - generated).total_seconds() / 3600
    if age_h > MISSING_HOURS:
        return {"status": "missing", "generated_at": run["generated_at"],
                "reason": f"The newest mud run is {age_h:.0f} hours old (limit {MISSING_HOURS}). Run `{cmd}` again."}, None

    rows = {}
    with (run_dir / "sites.csv").open(newline="", encoding="utf-8") as fh:
        for r in csv.DictReader(fh):
            if r["eia"] == eia and r["horizon"] == horizon["key"] and r["passes"] == str(PASSES):
                rows[r["equipment"]] = r
    labels = {e["key"]: e["label"] for e in run["equipment"]}
    equipment = [{
        "key": k, "label": labels.get(k, k), "score": float(r["score"]), "score_p90": float(r["score_p90"]),
        "worst_flag": r["worst_flag"], "worst_segment": r["worst_segment"],
        "flagged_route_ft": int(float(r["flagged_route_ft"])), "route_ft": int(float(r["route_ft"])),
        "inspect_acres": float(r["inspect_acres"]), "hold_acres": float(r["hold_acres"]),
    } for k in EQUIPMENT if (r := rows.get(k))]
    if not equipment:
        return {"status": "missing", "reason": "sites.csv has no rows for this plant and day."}, None

    seg_file = run_dir / "segments" / f"{eia}.geojson"
    features, counts = [], {f: 0 for f in FLAGS}
    if seg_file.is_file():
        for ft in json.loads(seg_file.read_text(encoding="utf-8"))["features"]:
            p, r = ft["properties"], ft["properties"]["r"]
            per = {k: r.get(f"{k}|{PASSES}|{horizon['key']}") for k in EQUIPMENT}
            flag_default = (per[DEFAULT_EQUIPMENT] or [0])[0]
            counts[FLAGS[flag_default]] += 1
            if not any(v and v[0] >= 1 for v in per.values()):
                continue
            features.append({"type": "Feature", "geometry": _round_coords(ft["geometry"]), "properties": {
                "id": p["id"], "osm_id": p["osm_id"], "highway": p["highway"], "name": p.get("name"),
                "length_ft": p["length_ft"],
                # [flag index, score, rut depth in inches] per equipment class
                "r": {k: [v[0], v[2], v[3]] for k, v in per.items() if v}}})
    section = {
        "status": "stale" if age_h > STALE_HOURS else "ok",
        "label": run["label"], "model_version": run["model_version"], "generated_at": run["generated_at"],
        "horizon": {"key": horizon["key"], "date": horizon["date"], "label": horizon["label"],
                    "rain_in": horizon["rain_in"], "soil_moisture": round(horizon["theta"], 3)},
        "passes": PASSES, "default_equipment": DEFAULT_EQUIPMENT, "thresholds_in": run["thresholds_in"],
        "equipment": equipment, "segment_counts": counts, "locally_validated": False,
        "routes_file": "mud_routes.geojson" if features else None,
        "caveats": [run["label"], run["passes_note"],
                    "Only unpaved ways in OpenStreetMap are rated. Paved roads and private haul roads are not."],
    }
    if age_h > STALE_HOURS:
        section["reason"] = f"The mud run is {age_h:.0f} hours old. Soil moisture and rain may have changed."
    geo = {"type": "FeatureCollection", "properties": {"flags": list(FLAGS), "horizon": horizon["key"],
           "r": "equipment -> [flag index, score, rut depth in]"}, "features": features} if features else None
    return section, geo
