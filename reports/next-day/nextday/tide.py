"""Tide section for plants near a NOAA tide station. Predictions are astronomical tide only: they do not
include storm surge, river level or rain. The map shading is a simple bathtub estimate from a 10 m ground
model (see shade). It never says an area is dry."""
from __future__ import annotations

import json
from datetime import datetime, timedelta
from pathlib import Path

import numpy as np

from hazidx import localtime
from hazidx.sites import Site

from . import paths, stations
from .fetch import Fetcher, SourceUnavailable

COOPS = "https://api.tidesandcurrents.noaa.gov/api/prod/datagetter"
MDAPI = "https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations"
FT_PER_M = 3.28084
NEAR_HIGH_MIN = 60        # "near high water" = within this many minutes of a predicted high
DEM_MARGIN_M = 0.3        # assumed ground-model error; ground within this margin above the high-tide level is "marginal"
MIN_POLY_CELLS = 12       # drop shaded patches smaller than this many 10 m cells (about 0.12 ha)
LABEL = ("Estimate from predicted tide and a 10 m ground model. It ignores storm surge, river level, rain, drains, "
         "levees and ground-model error. Ground not shaded is not guaranteed dry.")
FMT = "%Y-%m-%d %H:%M"


def _local(s: str) -> datetime:
    return datetime.strptime(s, FMT)


def _iso(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M")


def fetch_hilo(f: Fetcher, station: str, for_date: str) -> list[dict]:
    d0 = datetime.fromisoformat(for_date) - timedelta(days=1)
    d1 = datetime.fromisoformat(for_date) + timedelta(days=1)
    data = f.get_json(f"coops_hilo_{station}", COOPS, {
        "product": "predictions", "application": "controlward_next_day_report", "station": station, "datum": "MLLW",
        "time_zone": "lst_ldt", "units": "metric", "interval": "hilo", "format": "json",
        "begin_date": d0.strftime("%Y%m%d"), "end_date": d1.strftime("%Y%m%d")})
    if "predictions" not in data:
        raise SourceUnavailable(f"CO-OPS gave no predictions for station {station}: {data.get('error', {}).get('message', 'no reason given')}")
    return [{"t": p["t"], "v": float(p["v"]), "type": p["type"]} for p in data["predictions"]]


def fetch_datums(f: Fetcher, station: str) -> dict[str, float]:
    data = f.get_json(f"coops_datums_{station}", f"{MDAPI}/{station}/datums.json", {"units": "metric"})
    return {d["name"]: float(d["value"]) for d in data.get("datums", []) if d.get("value") is not None}


def to_navd88(v_mllw: float, datums: dict[str, float]) -> float | None:
    """Water level above NAVD88 (m) from a prediction above MLLW (m). Datums are heights above the station datum."""
    if "MLLW" not in datums or "NAVD88" not in datums:
        return None
    return v_mllw + datums["MLLW"] - datums["NAVD88"]


def windows(hilo: list[dict], for_date: str) -> dict:
    """Rising (low -> next high) and falling (high -> next low) spans, and 'near high water' spans, clipped to the day."""
    day0 = datetime.fromisoformat(for_date)
    day1 = day0 + timedelta(days=1)

    def clip(a: datetime, b: datetime):
        a, b = max(a, day0), min(b, day1)
        return {"start": _iso(a), "end": _iso(b)} if a < b else None

    rising, falling, near = [], [], []
    for cur, nxt in zip(hilo, hilo[1:]):
        a, b = _local(cur["t"]), _local(nxt["t"])
        w = clip(a, b)
        if w and cur["type"] == "L" and nxt["type"] == "H":
            rising.append({**w, "from_m": cur["v"], "to_m": nxt["v"]})
        elif w and cur["type"] == "H" and nxt["type"] == "L":
            falling.append({**w, "from_m": cur["v"], "to_m": nxt["v"]})
    for e in hilo:
        if e["type"] == "H":
            t = _local(e["t"])
            w = clip(t - timedelta(minutes=NEAR_HIGH_MIN), t + timedelta(minutes=NEAR_HIGH_MIN))
            if w:
                near.append({**w, "peak": _iso(t), "peak_m": e["v"]})
    return {"rising": rising, "falling": falling, "near_high": near}


def shade(eia: str, high_navd88: float, mllw_navd88: float, terrain_dir: Path = paths.MUD_CACHE) -> dict | None:
    """GeoJSON of ground that tide can reach, from the cached 10 m NAVD88 elevation tile of the mud model.

    Classes: 'wet' is ground above the lowest tide (MLLW) and below the day's highest predicted tide, connected to
    the edge of the tile; 'low_spot' is the same height but cut off from the edge in the ground model; 'marginal'
    is connected ground up to DEM_MARGIN_M above the high-tide level. Ground at or below MLLW, and cells filled with
    exactly 0.0, are open water and are not shaded. Connection to the tile edge is only a rough test for a link to the sea."""
    f = Path(terrain_dir) / f"terrain_{eia}.npz"
    if not f.is_file():
        return None
    from affine import Affine
    from pyproj import Transformer
    from rasterio import features
    from scipy import ndimage
    from shapely.geometry import mapping, shape
    import shapely

    z = np.load(f, allow_pickle=True)
    dem, grid = z["dem"].astype("float64"), json.loads(str(z["grid"]))
    res = float(grid["res"])
    proj = Transformer.from_crs(f"EPSG:{grid['epsg']}", "EPSG:4326", always_xy=True)
    to_ll = lambda a: np.column_stack(proj.transform(a[:, 0], a[:, 1]))
    affine = Affine(res, 0, grid["left"], 0, -res, grid["top"])
    # The tile stores open water as exactly 0.0 (hydro-flattened fill). Real ground is almost never exactly 0.0 m,
    # so those cells count as water, not as ground the tide can reach. Without this a bay shades as a flat rectangle.
    fill = dem == 0.0
    above_water = (dem > mllw_navd88) & ~fill
    reach = above_water & (dem < high_navd88)
    marginal = above_water & (dem >= high_navd88) & (dem < high_navd88 + DEM_MARGIN_M)
    structure = np.ones((3, 3), dtype=int)

    def edge_connected(mask: np.ndarray, extra: np.ndarray | None = None) -> np.ndarray:
        both = mask | extra if extra is not None else mask
        lab, _ = ndimage.label(both, structure=structure)
        border = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
        return np.isin(lab, list(border)) & both

    # open water counts as connected: the sea is what feeds the tide
    water = ~above_water
    connected = edge_connected(reach | marginal | water)
    kinds = {"wet": reach & connected, "marginal": marginal & connected, "low_spot": reach & ~connected}
    out = []
    for kind, mask in kinds.items():
        for geom, val in features.shapes(mask.astype("uint8"), mask=mask, transform=affine):
            poly = shape(geom)
            if poly.area < MIN_POLY_CELLS * res * res:
                continue
            poly = shapely.transform(poly.simplify(res * 3), to_ll)
            if poly.is_empty:
                continue
            g = mapping(poly)
            g["coordinates"] = json.loads(json.dumps(g["coordinates"]), parse_float=lambda x: round(float(x), 4))
            out.append({"type": "Feature", "geometry": g, "properties": {"kind": kind}})
    return {"type": "FeatureCollection", "properties": {"label": LABEL, "high_navd88_m": round(high_navd88, 2),
            "mllw_navd88_m": round(mllw_navd88, 2), "margin_m": DEM_MARGIN_M, "kinds": list(kinds)}, "features": out}


def build(f: Fetcher, site: Site, for_date: str, mapping_: dict | None = None,
          terrain_dir: Path = paths.MUD_CACHE) -> tuple[dict, dict | None]:
    entry = (mapping_ if mapping_ is not None else stations.load()).get(site.eia_plant_id, {})
    if "station" not in entry:
        near = (entry.get("candidates") or [{}])[0]
        why = (f"The nearest NOAA tide station is {near['distance_km']} km away ({near['name']})."
               if near.get("distance_km") is not None else "No NOAA tide station is mapped to this site.")
        return {"status": "not_applicable", "reason": f"Not a tidal site. {why}"}, None
    st = entry["station"]
    try:
        hilo = fetch_hilo(f, st, for_date)
    except SourceUnavailable as e:
        return {"status": "missing", "reason": str(e), "station": {"id": st, "name": entry["station_name"]}}, None
    try:
        datums = fetch_datums(f, st)
    except SourceUnavailable:
        datums = {}
    events = []
    for e in hilo:
        navd = to_navd88(e["v"], datums)
        events.append({"t": _iso(_local(e["t"])), "type": e["type"], "m_mllw": round(e["v"], 3),
                       "ft_mllw": round(e["v"] * FT_PER_M, 2), "m_navd88": None if navd is None else round(navd, 3)})
    on_day = [e for e in events if e["t"].startswith(for_date)]
    highs = [e for e in on_day if e["type"] == "H"] or [e for e in events if e["type"] == "H"]
    top = max(highs, key=lambda e: e["m_mllw"]) if highs else None
    section = {
        "status": "ok",
        "station": {"id": st, "name": entry["station_name"], "distance_km": entry["distance_km"],
                    "reviewed": bool(entry.get("reviewed")), "url": f"https://tidesandcurrents.noaa.gov/stationhome.html?id={st}"},
        "time_zone": "Local time at the station (standard or daylight)", "events": events, **windows(hilo, for_date),
        "highest": top, "datum": "MLLW (mean lower low water), metres and feet above it",
        "navd88_available": "NAVD88" in datums and "MLLW" in datums,
        "caveats": [LABEL] + ([] if entry.get("reviewed") else ["The tide station was chosen by distance and has not been confirmed by a person."]),
        "shading_file": None,
    }
    geo = None
    if top and section["navd88_available"]:
        high = to_navd88(top["m_mllw"], datums)
        low = to_navd88(0.0, datums)
        geo = shade(site.eia_plant_id, high, low, terrain_dir)
        if geo is None:
            section["shading_reason"] = "No ground-model tile is cached for this site."
        elif geo["features"]:
            section["shading_file"] = "tide_shading.geojson"
        else:
            section["shading_reason"] = "No ground inside the tile lies between the lowest and the highest predicted tide."
    elif top:
        section["shading_reason"] = "NOAA publishes no NAVD88 datum for this station, so ground height cannot be compared with the tide."
    return section, geo
