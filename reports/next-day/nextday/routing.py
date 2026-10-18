"""Road graph for detour planning. The browser runs the shortest-path search (src/features/nextday/route.ts), so a
manager can pick any two points without a new build.

Roads come from OpenStreetMap (Overpass) within RADIUS_M of the site. Each edge carries the mud model's flag for
each equipment class where the model rated the way. Ways the model did not rate (paved roads, private haul roads
missing from OpenStreetMap) get flag NOT_RATED: a detour may use them, and the report says so. Edges inside the
tide shading are marked wet so a detour can avoid them at high tide."""
from __future__ import annotations

import json
import math
from pathlib import Path

import shapely
from shapely.geometry import LineString, Point, shape
from shapely.strtree import STRtree

from hazidx.sites import Site

from . import paths
from .fetch import Fetcher, SourceUnavailable
from .mud import EQUIPMENT, PASSES

OVERPASS = "https://overpass-api.de/api/interpreter"
RADIUS_M = 2500
MAX_EDGES = 30000
NOT_RATED = 3                  # flag value for edges the mud model did not rate; 0 ok, 1 inspect, 2 hold
MATCH_M = 30.0                 # an edge takes the flag of the nearest rated segment of the same way within this distance
HIGHWAYS = ("motorway", "trunk", "primary", "secondary", "tertiary", "unclassified", "residential", "service", "track",
            "road", "living_street", "motorway_link", "trunk_link", "primary_link", "secondary_link", "tertiary_link")
ONEWAY, PRIVATE, TIDE_WET = 1, 2, 4     # bits in an edge's flags field
CAVEATS = [
    "Roads come from OpenStreetMap. Private haul roads, gates, closures, weight limits and truck heights are often missing.",
    "Only unpaved ways are rated by the mud model. A detour can use paved roads that are not rated.",
    "A detour is a suggestion from map data. Check it on the ground.",
]


def query(lat: float, lon: float) -> str:
    hw = "|".join(HIGHWAYS)
    return (f'[out:json][timeout:60];way(around:{RADIUS_M},{lat:.5f},{lon:.5f})["highway"~"^({hw})$"]'
            f'["access"!~"^(no)$"];out geom;')


def _metres(a: tuple[float, float], b: tuple[float, float]) -> float:
    kx = math.cos(math.radians((a[1] + b[1]) / 2)) * 111_320.0
    return math.hypot((b[0] - a[0]) * kx, (b[1] - a[1]) * 110_540.0)


def _planar(g, lat0: float):
    kx = math.cos(math.radians(lat0))
    return shapely.transform(g, lambda a: a * [kx * 111_320.0, 110_540.0])


def load_rated(run_dir: Path, eia: str, horizon: str) -> dict[int, list[tuple[LineString, list[int]]]]:
    """OSM way id -> [(segment line, [flag per equipment class])], from the mud model's full segment file."""
    f = Path(run_dir) / "segments" / f"{eia}.geojson"
    out: dict[int, list] = {}
    if not f.is_file():
        return out
    for ft in json.loads(f.read_text(encoding="utf-8"))["features"]:
        p = ft["properties"]
        flags = []
        for k in EQUIPMENT:
            v = p["r"].get(f"{k}|{PASSES}|{horizon}")
            flags.append(NOT_RATED if v is None else int(v[0]))
        out.setdefault(int(p["osm_id"]), []).append((shape(ft["geometry"]), flags))
    return out


def build_graph(elements: list[dict], rated: dict[int, list], tide_wet: list | None, lat0: float) -> dict:
    nodes: dict[int, int] = {}
    coords: list[list[float]] = []
    edges: list[list[int]] = []
    wet_tree = STRtree([_planar(g, lat0) for g in tide_wet]) if tide_wet else None
    wet_geoms = [_planar(g, lat0) for g in tide_wet] if tide_wet else []

    def node(nid: int, lon: float, lat: float) -> int:
        if nid not in nodes:
            nodes[nid] = len(coords)
            coords.append([round(lon, 5), round(lat, 5)])
        return nodes[nid]

    for way in elements:
        if way.get("type") != "way" or len(way.get("nodes", [])) < 2 or len(way.get("geometry", [])) != len(way["nodes"]):
            continue
        tags = way.get("tags", {})
        bits = (ONEWAY if tags.get("oneway") in ("yes", "true", "1") or tags.get("junction") == "roundabout" else 0) \
            | (PRIVATE if tags.get("access") in ("private", "permit", "customers", "delivery") else 0)
        segs = rated.get(int(way["id"]), [])
        pts = [(g["lon"], g["lat"]) for g in way["geometry"]]
        ids = [node(n, *p) for n, p in zip(way["nodes"], pts)]
        for (a, pa), (b, pb) in zip(zip(ids, pts), zip(ids[1:], pts[1:])):
            if a == b:
                continue
            mid = ((pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2)
            flags = [NOT_RATED] * len(EQUIPMENT)
            if segs:
                m = _planar(Point(mid), lat0)
                best = min(segs, key=lambda s: _planar(s[0], lat0).distance(m))
                if _planar(best[0], lat0).distance(m) <= MATCH_M:
                    flags = best[1]
            wet = 0
            if wet_tree is not None:
                m = _planar(Point(mid), lat0)
                wet = TIDE_WET if any(wet_geoms[i].contains(m) for i in wet_tree.query(m)) else 0
            edges.append([a, b, max(1, round(_metres(pa, pb))), *flags, bits | wet])
    return {"nodes": coords, "edges": edges}


def build(f: Fetcher, site: Site, for_date: str, mud_section: dict, tide_geo: dict | None,
          run_dir: Path | None = None, elements: list[dict] | None = None) -> tuple[dict, dict | None]:
    if mud_section.get("status") not in ("ok", "stale"):
        return {"status": "not_applicable", "reason": "Detours need the mud model's route ratings, which are not available."}, None
    try:
        if elements is None:
            data = f.get_json(f"overpass_roads_{site.eia_plant_id}", OVERPASS, {"data": query(site.latitude, site.longitude)})
            elements = data.get("elements", [])
    except SourceUnavailable as e:
        return {"status": "missing", "reason": str(e)}, None
    if not elements:
        return {"status": "not_applicable", "reason": "OpenStreetMap has no drivable roads within 2.5 km of the site."}, None
    from .mud import latest_run
    run_dir = run_dir or latest_run()
    rated = load_rated(run_dir, site.eia_plant_id, mud_section["horizon"]["key"]) if run_dir else {}
    wet = [shape(ft["geometry"]) for ft in (tide_geo or {}).get("features", []) if ft["properties"].get("kind") == "wet"]
    g = build_graph(elements, rated, wet, site.latitude)
    if len(g["edges"]) > MAX_EDGES:
        return {"status": "missing", "reason": f"The road graph has {len(g['edges'])} edges, over the limit of {MAX_EDGES}."}, None
    graph = {"format": 1, "equipment": list(EQUIPMENT), "flags": ["ok", "inspect", "hold", "not rated"],
             "edge": "[from, to, metres, flag per equipment..., bits: 1 one-way, 2 private, 4 tide-wet]", **g}
    rated_edges = sum(1 for e in g["edges"] if e[3] != NOT_RATED)
    return {"status": "ok", "graph_file": "road_graph.json", "edges": len(g["edges"]), "rated_edges": rated_edges,
            "radius_m": RADIUS_M, "tide_wet_edges": sum(1 for e in g["edges"] if e[-1] & TIDE_WET),
            "caveats": CAVEATS, "source": {"name": "OpenStreetMap contributors", "url": "https://www.openstreetmap.org/copyright"}}, graph
