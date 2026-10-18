"""River section: nearest NWS river forecast point (NWPS) and its stage forecast. Many gauges publish no
forecast, and the nearest gauge can be on a different river from the site, so the report states the gauge
name and distance and never says a site is safe from river flooding."""
from __future__ import annotations

import csv
import math
from datetime import datetime, timedelta, timezone
from pathlib import Path

from hazidx import localtime
from hazidx.sites import Site

from . import paths
from .fetch import Fetcher, SourceUnavailable
from .stations import haversine_km

NWPS = "https://api.water.noaa.gov/nwps/v1/gauges"
MAX_KM = 25.0
CATEGORIES = ("action", "minor", "moderate", "major")     # ascending
TREND_FT = 0.2         # change over the last 6 hours that counts as rising or falling


def load_gauges(csv_path: Path = paths.RIVER_POINTS_CSV) -> list[dict]:
    out = []
    with Path(csv_path).open(newline="", encoding="utf-8") as fh:
        for r in csv.DictReader(fh):
            r = {(k or "").strip(): (v or "").strip() for k, v in r.items()}
            try:
                out.append({"lid": r["lid"], "name": r["name"], "lat": float(r["lat"]), "lon": float(r["lon"]), "state": r["state"]})
            except (KeyError, ValueError):
                continue
    return out


def nearest(site: Site, gauges: list[dict], max_km: float = MAX_KM) -> dict | None:
    best = min(gauges, key=lambda g: haversine_km(site.latitude, site.longitude, g["lat"], g["lon"]), default=None)
    if best is None:
        return None
    d = haversine_km(site.latitude, site.longitude, best["lat"], best["lon"])
    return {**best, "distance_km": round(d, 1)} if d <= max_km else None


def category(stage: float | None, thresholds: dict) -> str:
    if stage is None:
        return "unknown"
    out = "none"
    for c in CATEGORIES:
        t = (thresholds.get(c) or {}).get("stage")
        if isinstance(t, (int, float)) and t > -999 and stage >= t:
            out = c
    return out


def _points(block: dict | None) -> list[tuple[datetime, float]]:
    pts = []
    for p in (block or {}).get("data") or []:
        v = p.get("primary")
        if isinstance(v, (int, float)) and v > -999:
            pts.append((datetime.fromisoformat(p["validTime"].replace("Z", "+00:00")), float(v)))
    return sorted(pts)


def summarize(meta: dict, flow: dict, dist: dict, for_date: str, tz: str, as_of: datetime) -> dict:
    thresholds = (meta.get("flood") or {}).get("categories") or {}
    unit = (meta.get("flood") or {}).get("stageUnits") or "ft"
    obs, fc = _points(flow.get("observed")), _points(flow.get("forecast"))
    out = {"status": "ok", "gauge": {"lid": dist["lid"], "name": meta.get("name") or dist["name"], "distance_km": dist["distance_km"],
                                     "url": f"https://water.noaa.gov/gauges/{dist['lid']}"},
           "stage_unit": unit,
           "thresholds": {c: thresholds[c]["stage"] for c in CATEGORIES if isinstance((thresholds.get(c) or {}).get("stage"), (int, float))},
           "caveats": [f"The gauge is {dist['distance_km']} km from the site and may sit on a different river.",
                       "A river gauge does not show local drainage or rain on the site."]}
    if obs:
        last_t, last = obs[-1]
        past = [v for t, v in obs if t <= last_t - timedelta(hours=6)]
        delta = round(last - past[-1], 2) if past else None
        out["observed"] = {"stage": round(last, 2), "time": last_t.strftime("%Y-%m-%dT%H:%MZ"), "category": category(last, thresholds),
                           "change_6h": delta, "trend": None if delta is None else ("rising" if delta >= TREND_FT else "falling" if delta <= -TREND_FT else "steady")}
    else:
        out["observed"] = None
    day0 = localtime.zoned_to_utc(for_date, 0, tz) / 1000
    day1 = localtime.zoned_to_utc(localtime.add_days(for_date, 1), 0, tz) / 1000
    future = [(t, v) for t, v in fc if t >= as_of - timedelta(hours=1)]
    if not future:
        out["forecast"] = None
        out["forecast_note"] = "No river forecast is published for this gauge. Only the observed trend is shown."
    else:
        crest_t, crest = max(future, key=lambda x: x[1])
        on_day = [v for t, v in fc if day0 <= t.timestamp() < day1]
        out["forecast"] = {
            "crest": {"stage": round(crest, 2), "time": crest_t.strftime("%Y-%m-%dT%H:%MZ"), "category": category(crest, thresholds)},
            "report_day_max": None if not on_day else {"stage": round(max(on_day), 2), "category": category(max(on_day), thresholds)},
            "last_point": future[-1][0].strftime("%Y-%m-%dT%H:%MZ"),
        }
    cats = [c for c in ((out.get("forecast") or {}).get("crest", {}).get("category"), ((out.get("forecast") or {}).get("report_day_max") or {}).get("category"),
                        (out.get("observed") or {}).get("category")) if c]
    worst = max((CATEGORIES.index(c) for c in cats if c in CATEGORIES), default=-1)
    out["flag"] = "none" if worst < 0 else CATEGORIES[worst]
    return out


def build(f: Fetcher, site: Site, for_date: str, as_of: datetime, gauges: list[dict] | None = None) -> dict:
    g = nearest(site, gauges if gauges is not None else load_gauges())
    if g is None:
        return {"status": "not_applicable", "reason": f"No NWS river forecast point within {MAX_KM:.0f} km of the site."}
    try:
        meta = f.get_json(f"nwps_gauge_{g['lid']}", f"{NWPS}/{g['lid']}")
        flow = f.get_json(f"nwps_stageflow_{g['lid']}", f"{NWPS}/{g['lid']}/stageflow")
    except SourceUnavailable as e:
        return {"status": "missing", "reason": str(e), "gauge": {"lid": g["lid"], "name": g["name"], "distance_km": g["distance_km"]}}
    return summarize(meta, flow, g, for_date, site.timezone, as_of)
