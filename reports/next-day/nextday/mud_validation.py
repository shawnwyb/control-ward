"""Compare crew 'mud' reports with the mud model's flagged routes. For each report, find the newest mud-trafficability
run made before the report whose horizons cover the report's local date, then see what the model said about the
nearest rated route segment within MATCH_M metres:

  hit            the model flagged that segment (inspect or hold) for the default equipment
  false_clear    the model rated that segment ok
  outside        no rated segment within MATCH_M metres (the model does not cover that spot)

The result is evidence for a person to read. This command never changes locally_validated."""
from __future__ import annotations

import csv
import json
import math
import sys
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import shapely
from shapely.geometry import Point, shape

from hazidx.sites import load_sites

from . import paths
from .mud import DEFAULT_EQUIPMENT, FLAGS, PASSES

MATCH_M = 50.0


def _runs(output_dir: Path) -> list[tuple[datetime, Path, dict]]:
    out = []
    for run_json in sorted(Path(output_dir).glob("run_*/run.json")):
        meta = json.loads(run_json.read_text(encoding="utf-8"))
        out.append((datetime.fromisoformat(meta["generated_at"]).astimezone(timezone.utc), run_json.parent, meta))
    return sorted(out, key=lambda r: r[0])


def _planar(g, lat0: float):
    kx = math.cos(math.radians(lat0))
    return shapely.transform(g, lambda a: a * [kx * 111_320.0, 110_540.0])


def evaluate(reports: list[dict], output_dir: Path = paths.MUD_OUTPUT, tz_of: dict[str, str] | None = None) -> dict:
    """reports: [{eia, latitude, longitude, created_at (ISO, with zone)}]."""
    runs = _runs(output_dir)
    tz_of = tz_of or {s.eia_plant_id: s.timezone for s in load_sites()}
    cache: dict[tuple[str, str], list] = {}
    rows = []
    for r in reports:
        created = datetime.fromisoformat(r["created_at"].replace("Z", "+00:00")).astimezone(timezone.utc)
        eia = str(r["eia"])
        day = created.astimezone(ZoneInfo(tz_of.get(eia, "UTC"))).strftime("%Y-%m-%d")
        row = {"eia": eia, "created_at": r["created_at"], "local_date": day, "result": "no_run"}
        usable = None
        for generated, folder, meta in reversed(runs):
            if generated > created:
                continue
            site = next((s for s in meta["sites"] if str(s["eia"]) == eia), None)
            horizon = next((h for h in (site or {"horizons": []})["horizons"] if h["date"] == day), None)
            if horizon:
                usable = (folder, horizon["key"], meta["generated_at"])
                break
        if usable is None:
            rows.append({**row, "reason": "No mud run made before the report covers its date."})
            continue
        folder, horizon_key, generated_at = usable
        key = (str(folder), eia)
        if key not in cache:
            f = folder / "segments" / f"{eia}.geojson"
            cache[key] = json.loads(f.read_text(encoding="utf-8"))["features"] if f.is_file() else []
        lat0 = float(r["latitude"])
        pt = _planar(Point(float(r["longitude"]), lat0), lat0)
        best, best_d = None, float("inf")
        for ft in cache[key]:
            d = _planar(shape(ft["geometry"]), lat0).distance(pt)
            if d < best_d:
                best, best_d = ft, d
        if best is None or best_d > MATCH_M:
            rows.append({**row, "result": "outside", "run": generated_at, "horizon": horizon_key,
                         "nearest_m": None if best is None else round(best_d, 1)})
            continue
        v = best["properties"]["r"].get(f"{DEFAULT_EQUIPMENT}|{PASSES}|{horizon_key}")
        flag = FLAGS[v[0]] if v else None
        rows.append({**row, "result": "hit" if flag in ("inspect", "hold") else "false_clear" if flag == "ok" else "outside",
                     "run": generated_at, "horizon": horizon_key, "nearest_m": round(best_d, 1), "flag": flag,
                     "segment": best["properties"]["id"]})
    counts = {k: sum(1 for x in rows if x["result"] == k) for k in ("hit", "false_clear", "outside", "no_run")}
    covered = counts["hit"] + counts["false_clear"]
    return {"reports": len(rows), **counts, "hit_rate": round(counts["hit"] / covered, 3) if covered else None,
            "match_m": MATCH_M, "equipment": DEFAULT_EQUIPMENT, "rows": rows,
            "note": "Evidence only. This command does not change locally_validated. Few reports give a weak signal."}


def read_csv(path: str) -> list[dict]:
    with open(path, newline="", encoding="utf-8") as fh:
        rows = list(csv.DictReader(fh))
    need = {"eia_plant_id", "latitude", "longitude", "created_at"}
    if not rows or not need <= set(rows[0]):
        raise SystemExit(f"{path}: needs columns {', '.join(sorted(need))}")
    return [{"eia": r["eia_plant_id"], "latitude": r["latitude"], "longitude": r["longitude"], "created_at": r["created_at"]} for r in rows]


def run(csv_path: str, out: str | None = None) -> int:
    result = evaluate(read_csv(csv_path))
    dest = Path(out) if out else paths.CACHE / "mud_validation.json"
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(json.dumps(result, indent=1) + "\n", encoding="utf-8")
    print(f"{result['reports']} crew mud reports: {result['hit']} hit, {result['false_clear']} false clear, "
          f"{result['outside']} outside the rated routes, {result['no_run']} with no mud run for their date.")
    if result["hit_rate"] is not None:
        print(f"Of the reports on rated routes, the model flagged {result['hit_rate'] * 100:.0f}%.")
    print(f"locally_validated stays false. Details: {dest}")
    return 0
