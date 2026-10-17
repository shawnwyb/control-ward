"""Unpaved access routes from OpenStreetMap (Overpass), split into segments, plus the Track mask and flood context.

Mapped ways are "existing track" (Track = 1 in Eq 3); every other cell is native ground or a new route (Track = 0).
Paved, aggregate and matted surfaces are separate cases in plan.md and are not modeled here.
"""
from __future__ import annotations

import csv
import json
import math
import time

import httpx
import numpy as np
from rasterio.features import rasterize
from shapely.geometry import LineString, box, mapping
from shapely.ops import substring, transform as shp_transform

from . import config as C
from .net import post_with_retry
from .sites import Site
from .terrain import Grid

OVERPASS = ("https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter")
UNPAVED = "unpaved|dirt|gravel|ground|grass|compacted|fine_gravel|mud|sand|earth|pebblestone|rock|woodchips|soil"
PAVED = {"paved", "asphalt", "concrete", "concrete:plates", "concrete:lanes", "paving_stones", "sett", "metal", "wood",
         "chipseal", "bricks", "cobblestone"}


def overpass_query(lat: float, lon: float, radius_m: float = C.ROUTE_RADIUS_M) -> str:
    a = f"around:{radius_m:.0f},{lat:.6f},{lon:.6f}"
    return f"""[out:json][timeout:90];
(
  way({a})["highway"="track"];
  way({a})["highway"]["tracktype"~"^grade[2-5]$"];
  way({a})["highway"~"^(service|unclassified|road|residential|tertiary|path)$"]["surface"~"^({UNPAVED})$"];
  way({a})["highway"~"^(service|unclassified|road)$"][!"surface"];
);
out tags geom;"""


def fetch_ways(site: Site, client: httpx.Client, force: bool = False) -> list[dict]:
    path = C.CACHE / f"osm_{site.eia}.json"
    if path.exists() and not force:
        return json.loads(path.read_text())
    q = overpass_query(site.lat, site.lon)
    last: Exception | None = None
    for url in OVERPASS:
        try:
            elements = post_with_retry(client, url, data={"data": q}, tries=3).json().get("elements", [])
            break
        except Exception as exc:  # try the mirror
            last = exc
    else:
        raise RuntimeError(f"Overpass failed for {site.name}: {last}")
    ways = [{"id": e["id"], "tags": e.get("tags", {}), "coords": [(p["lon"], p["lat"]) for p in e.get("geometry", [])]}
            for e in elements if e.get("type") == "way" and len(e.get("geometry", [])) >= 2]
    C.CACHE.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(ways))
    time.sleep(1.0)  # Overpass etiquette between sites
    return ways


def segments(ways: list[dict], grid: Grid) -> list[dict]:
    """~100 m pieces of every unpaved way, clipped to the tile, in UTM metres."""
    to_utm = grid.to_utm()
    tile = box(*grid.bounds).buffer(-grid.res)
    out = []
    for w in ways:
        tags = w["tags"]
        surface = tags.get("surface")
        if surface in PAVED:
            continue
        line = shp_transform(to_utm.transform, LineString(w["coords"])).intersection(tile)
        for part in getattr(line, "geoms", [line]):
            if part.is_empty or part.geom_type != "LineString" or part.length < 5:
                continue
            n = max(1, math.ceil(part.length / C.SEGMENT_M))
            step = part.length / n
            for i in range(n):
                seg = substring(part, i * step, (i + 1) * step)
                out.append({
                    "id": f"{w['id']}-{len(out)}", "osm_id": w["id"], "highway": tags.get("highway"),
                    "surface": surface, "tracktype": tags.get("tracktype"), "name": tags.get("name"),
                    "surface_confidence": "tagged" if surface or tags.get("tracktype") or tags.get("highway") == "track" else "unknown",
                    "geom": seg,
                })
    return out


def route_mask(segs: list[dict], grid: Grid, half_width_m: float = 3.0) -> np.ndarray:
    """1 within half_width_m of a mapped way, 0 elsewhere. 3 m (a ~6 m road) is the Track mask for Eq 3."""
    if not segs:
        return np.zeros(grid.shape, dtype=np.uint8)
    shapes = [(mapping(s["geom"].buffer(half_width_m)), 1) for s in segs]
    return rasterize(shapes, out_shape=grid.shape, transform=grid.transform, fill=0, all_touched=True, dtype="uint8")


def nearest_flood_gauge(site: Site) -> dict | None:
    """Context only: NWS long-range river flood probabilities at the nearest forecast point."""
    best, best_d = None, float("inf")
    with open(C.FLOOD_CSV, newline="") as f:
        for r in csv.DictReader(f, skipinitialspace=True):
            try:
                lat, lon = float(r["lat"]), float(r["lon"])
            except (KeyError, ValueError):
                continue
            d = _haversine_mi(site.lat, site.lon, lat, lon)
            if d < best_d:
                best, best_d = r, d
    if not best:
        return None
    return {"lid": best["lid"].strip(), "name": best["name"].strip(), "distance_mi": round(best_d, 1),
            "minor": best["minor"].strip(), "moderate": best["moderate"].strip(), "major": best["major"].strip(),
            "interval": best["interval"].strip(), "date_produced": best["date_produced"].strip()}


def _haversine_mi(lat1, lon1, lat2, lon2) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2
    return 3958.8 * 2 * math.asin(math.sqrt(a))
