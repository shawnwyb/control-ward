"""SSURGO soils through data/soil-data/ssurgo_fetch.py: one plant-level row per site plus a per-cell map-unit raster.

The plant row is the fetcher's own `plants` command (250 m buffer, 1000 m fallback). The raster reuses its
SDAClient and SoilFetcher: one spatial query returns the map-unit polygons clipped to the tile, and each map unit
is aggregated exactly as the fetcher aggregates a plant buffer (aggregate_plant with that unit covering 100 %).
"""
from __future__ import annotations

import csv
import importlib.util
import json
import subprocess
import sys

import numpy as np
from rasterio.features import rasterize
from shapely import wkt as shapely_wkt
from shapely.geometry import box, mapping
from shapely.ops import transform as shp_transform

from . import config as C
from .sites import Site
from .terrain import Grid

PLANT_CSV = C.CACHE / "soil_plants_hosted.csv"


def _fetcher_module():
    spec = importlib.util.spec_from_file_location("ssurgo_fetch", C.SOIL_DIR / "ssurgo_fetch.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def plant_rows(sites: list[Site], force: bool = False) -> dict[str, dict]:
    """Run `ssurgo_fetch.py plants` from its own directory for every site that isn't cached yet."""
    have = _read_plant_csv()
    missing = [s.eia for s in sites if s.eia not in have]
    if missing or force:
        ids = [s.eia for s in sites] if force else missing
        out = C.CACHE / "soil_plants_new.csv"
        C.CACHE.mkdir(parents=True, exist_ok=True)
        cmd = [sys.executable, "ssurgo_fetch.py", "plants", "--out", str(out)]
        for i in ids:
            cmd += ["--plant-id", i]
        subprocess.run(cmd, cwd=C.SOIL_DIR, check=True)
        with open(out, newline="") as f:
            for row in csv.DictReader(f):
                have[row["plant_id"]] = row
        with open(PLANT_CSV, "w", newline="") as f:
            rows = list(have.values())
            w = csv.DictWriter(f, fieldnames=list(rows[0]))
            w.writeheader()
            w.writerows(rows)
    return {s.eia: have.get(s.eia) for s in sites}


def _read_plant_csv() -> dict[str, dict]:
    if not PLANT_CSV.exists():
        return {}
    with open(PLANT_CSV, newline="") as f:
        return {r["plant_id"]: r for r in csv.DictReader(f)}


def _tile_polygons(ssurgo, sql_client, tile_wgs84) -> list[dict]:
    """Map-unit polygons clipped to the tile. Splits the tile in four if SDA says the query is too heavy."""
    wkt = tile_wgs84.wkt
    sql = ("SELECT mukey, mupolygongeo.STIntersection(geometry::STGeomFromText('{w}', 4326)).STAsText() AS wkt "
           "FROM mupolygon WHERE mupolygongeo.STIntersects(geometry::STGeomFromText('{w}', 4326)) = 1").format(w=wkt)
    try:
        return sql_client.query(sql)
    except ssurgo.QueryTooBigError:
        minx, miny, maxx, maxy = tile_wgs84.bounds
        mx, my = (minx + maxx) / 2, (miny + maxy) / 2
        quads = [box(minx, miny, mx, my), box(mx, miny, maxx, my), box(minx, my, mx, maxy), box(mx, my, maxx, maxy)]
        return [r for q in quads for r in _tile_polygons(ssurgo, sql_client, q)]


def prepare_tile_soils(site: Site, grid: Grid, force: bool = False) -> dict:
    """Map-unit index raster plus one property row per map unit, cached as cache/soils_<eia>.npz/.json."""
    npz, js = C.CACHE / f"soils_{site.eia}.npz", C.CACHE / f"soils_{site.eia}.json"
    if npz.exists() and js.exists() and not force:
        return load_tile_soils(site)
    ssurgo = _fetcher_module()
    client = ssurgo.SDAClient()
    to_wgs, to_utm = grid.to_wgs84(), grid.to_utm()
    tile_utm = box(*grid.bounds)
    tile_wgs = shp_transform(to_wgs.transform, tile_utm.segmentize(250.0))
    polys = _tile_polygons(ssurgo, client, tile_wgs)
    mukeys = sorted({str(r["mukey"]).strip() for r in polys if r.get("mukey")})
    fetcher = ssurgo.SoilFetcher(client, depth_cm=30.0, batch=50)
    fetcher.ensure_mukeys(mukeys)
    units = [ssurgo.aggregate_plant({mk: 1.0}, fetcher.mapunits, fetcher.components, fetcher.ratings) for mk in mukeys]
    index = {mk: i for i, mk in enumerate(mukeys)}
    shapes = []
    for r in polys:
        if not r.get("wkt"):
            continue
        geom = shp_transform(to_utm.transform, shapely_wkt.loads(r["wkt"]))
        if not geom.is_empty:
            shapes.append((mapping(geom), index[str(r["mukey"]).strip()]))
    raster = (rasterize(shapes, out_shape=grid.shape, transform=grid.transform, fill=-1, dtype="int32")
              if shapes else np.full(grid.shape, -1, dtype=np.int32))
    np.savez_compressed(npz, mukey_index=raster)
    js.write_text(json.dumps({"mukeys": mukeys, "units": units, "vintages": fetcher.vintages()}))
    return load_tile_soils(site)


def load_tile_soils(site: Site) -> dict:
    with np.load(C.CACHE / f"soils_{site.eia}.npz") as z:
        index = z["mukey_index"]
    meta = json.loads((C.CACHE / f"soils_{site.eia}.json").read_text())
    return {"index": index, **meta}
