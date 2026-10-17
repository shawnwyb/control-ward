"""The 60 plants from supabase/seed-sites.sql. Names contain commas and parentheses, so each row is
read with a SQL literal tokenizer rather than by splitting on commas."""
from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

from . import paths

COLUMNS = ("name", "latitude", "longitude", "timezone", "eia_plant_id", "utility", "plant_type",
           "fema_flood_zone", "river_distance_m", "usgs_gauge_id", "usgs_gauge_distance_m")
_TOKEN = re.compile(r"'((?:[^']|'')*)'|(null)|(-?\d+(?:\.\d+)?)", re.IGNORECASE)


@dataclass(frozen=True)
class Site:
    name: str
    latitude: float
    longitude: float
    timezone: str
    eia_plant_id: str
    utility: str | None
    plant_type: str | None
    fema_flood_zone: str | None
    river_distance_m: int | None
    usgs_gauge_id: str | None
    usgs_gauge_distance_m: int | None


def parse_row(row: str) -> list:
    values = []
    pos = 0
    while True:
        m = _TOKEN.search(row, pos)
        if not m:
            break
        if m.group(1) is not None:
            values.append(m.group(1).replace("''", "'"))
        elif m.group(2) is not None:
            values.append(None)
        else:
            values.append(m.group(3))
        pos = m.end()
    return values


def load_sites(path: Path = paths.SEED_SITES) -> list[Site]:
    sites = []
    in_values = False
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.lstrip().startswith("insert into public.sites"):
            in_values = True
            continue
        if not in_values:
            continue
        s = line.strip()
        if not s.startswith("("):
            break
        body = s[1:s.rindex(")")]
        v = parse_row(body)
        if len(v) != len(COLUMNS):
            raise ValueError(f"expected {len(COLUMNS)} values, got {len(v)}: {line!r}")
        rec = dict(zip(COLUMNS, v))
        sites.append(Site(
            name=rec["name"], latitude=float(rec["latitude"]), longitude=float(rec["longitude"]),
            timezone=rec["timezone"], eia_plant_id=rec["eia_plant_id"], utility=rec["utility"],
            plant_type=rec["plant_type"], fema_flood_zone=rec["fema_flood_zone"],
            river_distance_m=None if rec["river_distance_m"] is None else int(float(rec["river_distance_m"])),
            usgs_gauge_id=rec["usgs_gauge_id"],
            usgs_gauge_distance_m=None if rec["usgs_gauge_distance_m"] is None else int(float(rec["usgs_gauge_distance_m"])),
        ))
    if not sites:
        raise ValueError(f"no site rows found in {path}")
    return sites


def by_id(sites: list[Site] | None = None) -> dict[str, Site]:
    return {s.eia_plant_id: s for s in (sites or load_sites())}
