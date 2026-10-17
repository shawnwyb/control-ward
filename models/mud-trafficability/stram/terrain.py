"""Site grid, USGS 3DEP elevation, flow accumulation and cartographic depth-to-water (DTW).

DTW (Murphy et al. 2009; White et al. 2012) is the least slope-weighted path cost from a cell to the nearest flow
channel, in metres of elevation. A channel is any cell whose upslope area reaches the flow initiation area (FIA).
"""
from __future__ import annotations

import io
import json
from dataclasses import asdict, dataclass

import httpx
import numpy as np
import rasterio
from affine import Affine
from pyproj import Transformer
from skimage.graph import MCP_Geometric

from . import config as C
from .net import get_with_retry
from .sites import Site

DEM_URL = "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage"


@dataclass(frozen=True)
class Grid:
    epsg: int
    left: float
    top: float
    res: float
    n: int

    @property
    def transform(self) -> Affine:
        return Affine(self.res, 0.0, self.left, 0.0, -self.res, self.top)

    @property
    def shape(self) -> tuple[int, int]:
        return (self.n, self.n)

    @property
    def bounds(self) -> tuple[float, float, float, float]:
        span = self.res * self.n
        return (self.left, self.top - span, self.left + span, self.top)

    def to_utm(self) -> Transformer:
        return Transformer.from_crs(4326, self.epsg, always_xy=True)

    def to_wgs84(self) -> Transformer:
        return Transformer.from_crs(self.epsg, 4326, always_xy=True)

    def cell_of(self, x: float, y: float) -> tuple[int, int] | None:
        col, row = ~self.transform * (x, y)
        r, c = int(row), int(col)
        return (r, c) if 0 <= r < self.n and 0 <= c < self.n else None


def utm_epsg(lat: float, lon: float) -> int:
    return (32600 if lat >= 0 else 32700) + int((lon + 180) // 6) + 1


def site_grid(site: Site) -> Grid:
    epsg = utm_epsg(site.lat, site.lon)
    x, y = Transformer.from_crs(4326, epsg, always_xy=True).transform(site.lon, site.lat)
    half = C.TILE_RADIUS_M
    return Grid(epsg, round(x - half), round(y + half), C.GRID_RES_M, int(2 * half / C.GRID_RES_M))


def fetch_dem(grid: Grid, client: httpx.Client) -> np.ndarray:
    xmin, ymin, xmax, ymax = grid.bounds
    params = {
        "bbox": f"{xmin},{ymin},{xmax},{ymax}", "bboxSR": grid.epsg, "imageSR": grid.epsg,
        "size": f"{grid.n},{grid.n}", "format": "tiff", "pixelType": "F32", "noData": "-9999",
        "interpolation": "RSP_BilinearInterpolation", "f": "image",
    }
    r = get_with_retry(client, DEM_URL, params=params)
    if not r.headers.get("content-type", "").startswith("image"):
        raise RuntimeError(f"3DEP returned {r.headers.get('content-type')}: {r.text[:200]}")
    with rasterio.open(io.BytesIO(r.content)) as src:
        dem = src.read(1).astype(np.float64)
    dem[(dem < -1000) | ~np.isfinite(dem)] = np.nan
    if np.isnan(dem).all():
        raise RuntimeError("3DEP returned no elevation for this tile")
    dem[np.isnan(dem)] = np.nanmin(dem)  # offshore or survey gaps: treat as the lowest ground in the tile
    return dem


def flow_accumulation(dem: np.ndarray, grid: Grid) -> np.ndarray:
    """D8 upslope cell counts after filling pits and depressions and resolving flats (pysheds)."""
    import pyproj
    if not hasattr(np, "in1d"):  # pysheds 0.5 still calls np.in1d, which numpy 2.4 removed
        np.in1d = np.isin
    from pysheds.grid import Grid as PGrid
    from pysheds.sview import Raster, ViewFinder

    vf = ViewFinder(affine=grid.transform, shape=dem.shape, crs=pyproj.Proj(f"EPSG:{grid.epsg}"), nodata=np.nan)
    raster = Raster(dem.astype(np.float64), viewfinder=vf)
    pg = PGrid.from_raster(raster)
    filled = pg.resolve_flats(pg.fill_depressions(pg.fill_pits(raster)))
    return np.asarray(pg.accumulation(pg.flowdir(filled)), dtype=np.float64)


def depth_to_water(dem: np.ndarray, acc: np.ndarray, res: float, fia_ha: float) -> np.ndarray:
    """DTW in metres for one flow initiation area."""
    gy, gx = np.gradient(dem, res)
    slope = np.hypot(gx, gy) + 1e-4  # rise over run; the epsilon keeps flats finite and breaks ties
    channels = acc * res * res >= fia_ha * 10_000.0
    if not channels.any():
        channels = acc >= acc.max()
    costs, _ = MCP_Geometric(slope, sampling=(res, res)).find_costs(np.argwhere(channels))
    return costs.astype(np.float32)


def prepare_terrain(site: Site, client: httpx.Client, force: bool = False) -> dict:
    """DEM and one DTW layer per FIA, cached as cache/terrain_<eia>.npz."""
    path = C.CACHE / f"terrain_{site.eia}.npz"
    if path.exists() and not force:
        return load_terrain(site)
    grid = site_grid(site)
    dem = fetch_dem(grid, client)
    acc = flow_accumulation(dem, grid)
    dtw = np.stack([depth_to_water(dem, acc, grid.res, f) for f in C.FIA_HA])
    C.CACHE.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(path, dem=dem.astype(np.float32), dtw_m=dtw, acc=acc.astype(np.float32),
                        grid=json.dumps(asdict(grid)), fia_ha=np.array(C.FIA_HA))
    return load_terrain(site)


def load_terrain(site: Site) -> dict:
    with np.load(C.CACHE / f"terrain_{site.eia}.npz") as z:
        grid = Grid(**json.loads(str(z["grid"])))
        return {"grid": grid, "dem": z["dem"], "acc": z["acc"],
                "dtw_m": {float(f): z["dtw_m"][i] for i, f in enumerate(z["fia_ha"])}}
