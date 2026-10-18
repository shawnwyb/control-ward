"""Levees section from the USACE National Levee Database (NLD), through data/flood-data/nld_fetch.py.

The database lists mapped levees, floodwalls, closure structures and pump stations. It does not say whether a
levee will hold on the report day, and it can miss local or non-USACE levees. The report therefore never uses a
levee to remove tide or flood shading. The inspection rating comes from the NLD2 route
system-categories/inspection-rating; 'Not Rated' means USACE has not rated the system, not that it is sound."""
from __future__ import annotations

import math
import re
from typing import Any

from hazidx.sites import Site
from shapely.geometry import Point, mapping, shape
import shapely

from .fetch import Fetcher, SourceUnavailable

NLD2_BASE = "https://levees.sec.usace.army.mil/api-local"
AREA_KM = 10.0       # leveed-area polygons that touch a box of this half-width around the site
LINE_KM = 15.0       # levee lines, floodwalls, closure structures and pump stations in a box of this half-width
MAP_KM = 10.0        # only parts of the data within this distance of the site go into the map file
SIMPLIFY_DEG = {"leveed_areas": 0.0004, "alignment_lines": 0.0002, "floodwalls": 0.0002}  # about 44 m and 22 m
LAYERS = (("leveed_areas", AREA_KM), ("alignment_lines", LINE_KM), ("floodwalls", LINE_KM),
          ("closure_structures", LINE_KM), ("pump_stations", LINE_KM))
KIND = {"leveed_areas": "area", "alignment_lines": "levee", "floodwalls": "floodwall",
        "closure_structures": "closure", "pump_stations": "pump"}
KEEP = ("SYSTEM_ID", "SYSTEM_NAME", "SEGMENT_NAME", "SYSTEM_TYPE", "ALIGN_TYPE", "FEMA_ACCREDITATION_RATING",
        "FLOOD_SOURCES", "LEVEED_AREA_SQ_MI", "WARNING_SYSTEM", "OVERTOPPING_ACE", "REHAB_PROGRAM_STATUS")
CAVEATS = [
    "The National Levee Database maps levees. It does not say whether a levee will hold on the report day.",
    "Local or non-USACE levees can be missing from the database.",
    "'Not rated' means USACE has no inspection rating for the system. It does not mean the levee is sound.",
    "Tide and flood shading in this report ignores levees on purpose. Treat a leveed area as able to flood.",
]


def box(lat: float, lon: float, km: float) -> tuple[float, float, float, float]:
    d_lat = km / 111.32
    d_lon = km / (111.32 * max(math.cos(math.radians(lat)), 0.05))
    return (round(lon - d_lon, 5), round(lat - d_lat, 5), round(lon + d_lon, 5), round(lat + d_lat, 5))


def fetch_layers(f: Fetcher, site: Site, client: Any = None) -> dict[str, list[dict]]:
    """layer -> GeoJSON features near the site. Raises SourceUnavailable if NLD cannot be reached."""
    out = {}
    for layer, km in LAYERS:
        def produce(layer=layer, km=km):
            nonlocal client
            if client is None:
                import nld_fetch
                client = nld_fetch.NLDClient()
            try:
                return list(client.query(layer, bbox=box(site.latitude, site.longitude, km)))
            except Exception as e:  # nld_fetch raises NLDError, BlockedError, NLDAuthError and httpx errors
                raise SourceUnavailable(f"NLD layer {layer}: {e}") from e
        out[layer] = f.cached(f"nld_{site.eia_plant_id}_{layer}", produce,
                              url=f"https://geospatial.sec.usace.army.mil/dls/rest/services/NLD/Public/FeatureServer ({layer})")
    return out


def fetch_ratings(f: Fetcher) -> dict[str, str]:
    """system id -> inspection rating category."""
    data = f.get_json("nld2_inspection_rating", f"{NLD2_BASE}/system-categories/inspection-rating")
    return {sid: cat for cat, ids in data.items() for sid in re.findall(r"\d+", ids if isinstance(ids, str) else " ".join(map(str, ids)))}


def _flat(geom: dict) -> dict:
    """Drop z values and round to 4 decimals (about 11 m)."""
    def walk(c):
        if isinstance(c[0], (int, float)):
            return [round(c[0], 4), round(c[1], 4)]
        return [walk(x) for x in c]
    return {"type": geom["type"], "coordinates": walk(geom["coordinates"])}


def summarize(site: Site, layers: dict[str, list[dict]], ratings: dict[str, str] | None) -> tuple[dict, dict | None]:
    kx = math.cos(math.radians(site.latitude))
    def planar(g):   # degrees scaled so that 1 unit is about 111.32 km in both directions
        return shapely.transform(g, lambda a: a * [kx, 1.0])
    here = planar(Point(site.longitude, site.latitude))
    features, systems = [], {}

    def system(props: dict) -> dict:
        sid = str(props.get("SYSTEM_ID") or "")
        s = systems.setdefault(sid, {"id": sid, "name": props.get("SYSTEM_NAME"), "inside": False, "nearest_km": None})
        return s

    counts = {"closure_structures": 0, "pump_stations": 0}
    nearest_levee = None
    for layer, feats in layers.items():
        for ft in feats:
            if not ft.get("geometry"):
                continue
            props = {k: ft["properties"].get(k) for k in KEEP if ft["properties"].get(k) not in (None, "")}
            geom = shape(ft["geometry"])
            dist_km = round(float(planar(geom).distance(here)) * 111.32, 2)
            s = system(ft["properties"])
            if layer == "leveed_areas":
                if geom.contains(Point(site.longitude, site.latitude)):
                    s["inside"] = True
                for k, name in (("fema_accreditation", "FEMA_ACCREDITATION_RATING"), ("flood_sources", "FLOOD_SOURCES"),
                                ("leveed_area_sq_mi", "LEVEED_AREA_SQ_MI"), ("warning_system", "WARNING_SYSTEM"),
                                ("rehab_program_status", "REHAB_PROGRAM_STATUS")):
                    if props.get(name) is not None:
                        s[k] = props[name]
            else:
                if layer in counts:
                    counts[layer] += 1
                if layer in ("alignment_lines", "floodwalls"):
                    nearest_levee = dist_km if nearest_levee is None else min(nearest_levee, dist_km)
            if s["nearest_km"] is None or dist_km < s["nearest_km"]:
                s["nearest_km"] = dist_km
            if dist_km > MAP_KM:
                continue
            g = geom.simplify(SIMPLIFY_DEG[layer]) if layer in SIMPLIFY_DEG else geom
            if g.is_empty:
                continue
            features.append({"type": "Feature", "geometry": _flat(mapping(g)),
                             "properties": {"kind": KIND[layer], "system": props.get("SYSTEM_NAME"), **{k: v for k, v in props.items() if k in ("SEGMENT_NAME", "FEMA_ACCREDITATION_RATING")}}})
    for sid, s in systems.items():
        s["inspection_rating"] = (ratings or {}).get(sid, "Not Rated" if ratings is not None else None)
    ordered = sorted(systems.values(), key=lambda s: (not s["inside"], s["nearest_km"] if s["nearest_km"] is not None else 1e9))
    inside = any(s["inside"] for s in ordered)
    if not any(layers.values()):
        return {"status": "not_applicable", "reason": f"No levee, floodwall or leveed area in the National Levee Database within {LINE_KM:.0f} km.",
                "caveats": CAVEATS[1:2]}, None
    section = {
        "status": "ok", "inside_leveed_area": inside, "nearest_levee_km": nearest_levee, "systems": ordered[:6],
        "closure_structures": counts["closure_structures"], "pump_stations": counts["pump_stations"],
        "inspection_rating_known": ratings is not None, "map_file": "levees.geojson" if features else None, "caveats": CAVEATS,
        "source": {"name": "USACE National Levee Database", "url": "https://levees.sec.usace.army.mil/"},
    }
    if ratings is None:
        section["inspection_rating_note"] = "The NLD inspection-rating list could not be read."
    geo = {"type": "FeatureCollection", "properties": {"kinds": sorted(set(KIND.values()))}, "features": features} if features else None
    return section, geo


def build(f: Fetcher, site: Site, client: Any = None) -> tuple[dict, dict | None]:
    try:
        layers = fetch_layers(f, site, client)
    except SourceUnavailable as e:
        return {"status": "missing", "reason": str(e)}, None
    try:
        ratings = fetch_ratings(f)
    except SourceUnavailable:
        ratings = None
    return summarize(site, layers, ratings)
