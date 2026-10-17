"""The 60 hosted sites, read from supabase/seed-sites.sql (the file scripts/load-sites.mjs wrote from EIA-860M).

No database access: the hosted UUIDs aren't needed because the ml_scores push joins on eia_plant_id.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

from . import config as C

_VALUE = re.compile(r"'((?:[^']|'')*)'|(null)|(-?\d+(?:\.\d+)?)")


@dataclass(frozen=True)
class Site:
    eia: str
    name: str
    lat: float
    lon: float
    timezone: str
    utility: str | None
    plant_type: str | None


def _values(tuple_text: str) -> list:
    out = []
    for s, null, n in _VALUE.findall(tuple_text):
        out.append(None if null else (s.replace("''", "'") if n == "" else float(n) if "." in n else int(n)))
    return out


def load_sites(path: Path = C.SEED_SITES, eia: list[str] | None = None, limit: int | None = None) -> list[Site]:
    text = path.read_text()
    m = re.search(r"insert into public\.sites\(([^)]*)\) values\s*(.*?)\s*on conflict", text, re.S)
    if not m:
        raise ValueError(f"no insert into public.sites in {path}")
    cols = [c.strip() for c in m.group(1).split(",")]
    sites = []
    for tup in re.findall(r"^\s*\((.*)\),?\s*$", m.group(2), re.M):
        row = dict(zip(cols, _values(tup)))
        sites.append(Site(str(row["eia_plant_id"]), row["name"], float(row["latitude"]), float(row["longitude"]),
                          row["timezone"], row.get("utility"), row.get("plant_type")))
    if eia:
        wanted = set(eia)
        sites = [s for s in sites if s.eia in wanted]
        missing = wanted - {s.eia for s in sites}
        if missing:
            raise ValueError(f"not among the hosted sites in {path.name}: {sorted(missing)}")
    return sites[:limit] if limit else sites
