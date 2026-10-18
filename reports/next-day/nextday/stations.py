"""Ranks NOAA tide-prediction stations near each plant and writes data/stations.json. A person must review
the result: a station on the wrong water body (a tidal-head station above a dam, a lake station) would
put tide times on a site that has no tide. Entries start with reviewed=false."""
from __future__ import annotations

import json
import math
from pathlib import Path

from hazidx.sites import load_sites

from . import paths
from .fetch import Fetcher

STATIONS_URL = "https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations.json"
ACCEPT_KM = 20.0          # nearest station within this distance is proposed for the site
LOOK_KM = 50.0            # nearest station within this distance is listed for review but not proposed
FILE = paths.DATA / "stations.json"


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2
    return 6371.0 * 2 * math.asin(math.sqrt(a))


def rank(sites, stations: list[dict]) -> dict[str, list[dict]]:
    # NOS tide stations have all-digit ids. Other ids (TEC..., TWC...) are current or water-level
    # programme stations that are not tide predictions at a shoreline.
    nos = [s for s in stations if str(s["id"]).isdigit()]
    out = {}
    for site in sites:
        near = sorted(({"station": s["id"], "name": s["name"], "state": s.get("state"), "type": s.get("type"),
                        "reference_id": s.get("reference_id") or None,
                        "distance_km": round(haversine_km(site.latitude, site.longitude, s["lat"], s["lng"]), 1)}
                       for s in nos), key=lambda x: x["distance_km"])[:3]
        out[site.eia_plant_id] = near
    return out


def load() -> dict:
    return json.loads(FILE.read_text(encoding="utf-8")) if FILE.is_file() else {}


def run(fetcher: Fetcher | None = None, out: Path = FILE) -> int:
    f = fetcher or Fetcher()
    sites = load_sites()
    stations = f.get_json("noaa_stations", STATIONS_URL, {"type": "tidepredictions"})["stations"]
    ranked = rank(sites, stations)
    prior = load() if out == FILE else {}
    result, review = {}, []
    for site in sites:
        near = ranked[site.eia_plant_id]
        best = near[0]
        row = {"site": site.name, "candidates": near}
        if best["distance_km"] <= ACCEPT_KM:
            old = prior.get(site.eia_plant_id, {})
            keep = old.get("station") == best["station"]
            row.update(station=best["station"], station_name=best["name"], distance_km=best["distance_km"],
                       reviewed=bool(old.get("reviewed")) if keep else False, note=old.get("note", "") if keep else "")
        elif best["distance_km"] <= LOOK_KM:
            review.append(f"{site.name} ({site.eia_plant_id}): nearest station {best['name']} is {best['distance_km']} km away; not proposed.")
        result[site.eia_plant_id] = row
    out.write_text(json.dumps(result, indent=1) + "\n", encoding="utf-8")
    tidal = [r for r in result.values() if "station" in r]
    print(f"{len(tidal)} of {len(sites)} plants have a tide station within {ACCEPT_KM:.0f} km -> {out}")
    for r in tidal:
        print(f"  {r['site']:<28} {r['station']} {r['station_name']} ({r['distance_km']} km){'' if r['reviewed'] else '  [needs review]'}")
    for line in review:
        print("  review:", line)
    print("A person must check each proposed station is on the same tidal water as the plant, then set reviewed=true.")
    return 0
