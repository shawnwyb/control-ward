#!/usr/bin/env python3
"""Fetch SSURGO soil properties from USDA NRCS Soil Data Access (SDA) for EIA-860M power plants.
Public, no API key.

  query service: https://SDMDataAccess.sc.egov.usda.gov/Tabular/post.rest  (POST, T-SQL over SSURGO)

`plants` writes one flat row per plant, built from three SSURGO levels:
  map unit (mupolygon, mapunit, muaggatt) -> component (component, cointerp) -> horizon (chorizon,
  chfrags, chunified).
A bare point at a plant usually lands on "Urban land" (a component with no horizon data), so each
plant is a circular buffer (--radius-m, default 250 m, built as a lon/lat ellipse so the radius is
true metres). Each map unit is weighted by its share of the buffer area, and each component by that
share x comppct_r. Horizon properties are depth-weighted over 0..--depth-cm (default 30, the top-30 cm
digital soil layers used by Jones & Arp 2019, see models/mud-trafficability/). Plants whose buffer
has less than --min-coverage of soil with data are retried once at --fallback-radius-m, and the
larger buffer is kept only if it raises the coverage.

SDA quirks handled here (all confirmed against the live service 2026-10-17):
  - errors arrive as HTTP 400 with an XML <ServiceExceptionReport>, even when JSON was requested;
  - an empty result is `{}` on HTTP 200, with no header row even under JSON+COLUMNNAME;
  - every value is a string or null, some space-padded (majcompflag "No "), so values are stripped;
  - a heavy query fails with "...timed out" or "Memory limit"; the batch is split in half and retried;
  - at most 100,000 rows per query, so property queries go in mukey chunks.

Usage
  python ssurgo_fetch.py plants --state FL
  python ssurgo_fetch.py plants --plant-id 136 --plant-id 613 --format json
  python ssurgo_fetch.py plants --state FL --state GA --radius-m 500 --format parquet --out se_soils.parquet
  python ssurgo_fetch.py query "SELECT TOP 5 areasymbol, saverest FROM sacatalog WHERE areasymbol LIKE 'FL%'"
  python ssurgo_fetch.py query --file my_query.sql --format csv --out result.csv

Exit codes: 0 ok, 1 error (bad args, SDA exception, HTTP error after retries), 2 blocked by network
policy (403/407, never retried).
Needs: httpx; `plants` also needs pandas + openpyxl (the EIA-860M workbook); parquet also needs pyarrow.
Every file output gets a sidecar <out>.manifest.json (query args, request log, UTC timestamp, SHA-256,
row count, and for `plants` the SSURGO survey-area vintages that were used).
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import html
import json
import math
import random
import re
import sys
import time
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Iterable, Iterator

import httpx

SDA_URL = "https://SDMDataAccess.sc.egov.usda.gov/Tabular/post.rest"
UA = "ssurgo_fetch/1.0 (research script)"
DEFAULT_XLSX = Path("../power-plants/august_generator2026.xlsx")
PLANT_SHEETS = ("Operating", "Planned", "Retired", "Canceled or Postponed", "Operating_PR", "Planned_PR", "Retired_PR")
M_PER_DEG = 111_320.0  # metres per degree of latitude (and of longitude at the equator)
BUFFER_VERTICES = 32

# mukeys per property query. The interpretation query returns ~25 rule rows per component, so it
# gets the smallest chunk to stay far below SDA's 100,000-row cap.
MAPUNIT_CHUNK, HORIZON_CHUNK, INTERP_CHUNK = 500, 300, 150

# output column -> chorizon column (or SQL alias). Units are SSURGO's: %, g/cm3, um/s, cm/cm.
HORIZON_PROPS = {
    "sand_pct": "sandtotal_r", "silt_pct": "silttotal_r", "clay_pct": "claytotal_r", "om_pct": "om_r",
    "bulk_density_g_cm3": "dbthirdbar_r", "coarse_frag_pct": "fragvol_sum", "ksat_um_s": "ksat_r",
    "awc_cm_cm": "awc_r", "liquid_limit": "ll_r", "plasticity_index": "pi_r",
}
# a horizon "has data" if one of these is populated; Urban land / Pits often have none of them
DATA_COLUMNS = ("sandtotal_r", "silttotal_r", "claytotal_r", "om_r")

FOR_RULES = {"FOR - Soil Rutting Hazard": "rutting_hazard", "FOR - Harvest Equipment Operability": "harvest_equip_operability"}
MIL_RULE = re.compile(r"^MIL - Trafficability Veh\. Type (\d) (1-pass wet season|50-passes wet season|dry season) \(DOD\)$")
MIL_SUFFIX = {"1-pass wet season": "wet1", "50-passes wet season": "wet50", "dry season": "dry"}
MIL_COLS = tuple(f"mil_traf_t{t}_{s}" for t in range(1, 8) for s in MIL_SUFFIX.values())
RATING_COLS = ("rutting_hazard", "harvest_equip_operability") + MIL_COLS

ROW_FIELDS = (
    "plant_id", "plant_name", "state", "county", "technology", "lat", "lon", "radius_m_used",
    "mapped_frac", "soil_coverage_frac", "urban_frac", "water_frac",
    "dominant_mukey", "dominant_muname", "dominant_component", "areasymbol", "survey_saverest",
    *HORIZON_PROPS, "uscs_surface",
    "drainage_class", "hydrologic_group", "wt_depth_annual_min_cm", "flood_freq", "pond_freq_pct", "slope_pct",
    "rutting_hazard", "rutting_hazard_class", *RATING_COLS[1:],
)


class BlockedError(RuntimeError):
    """403/407 or a proxy CONNECT refusal. A policy denial: never retried."""


class SDAError(RuntimeError):
    pass


class QueryTooBigError(SDAError):
    """SDA gave up on the query itself (timeout / memory). Retrying the same SQL won't help; a smaller batch may."""


def _service_exception(text: str) -> str | None:
    m = re.search(r"<ServiceException(?:\s[^>]*)?>(.*?)</ServiceException>", text, re.S)  # not <ServiceExceptionReport>
    return html.unescape(m.group(1)).strip() if m else None


def _num(v: Any) -> float | None:
    if v is None:
        return None
    try:
        return float(str(v).strip())
    except ValueError:
        return None


def _str(v: Any) -> str | None:
    if v is None:
        return None
    s = str(v).strip()
    return s or None


def _round(v: float | None, nd: int) -> float | None:
    return None if v is None else round(v, nd)


def _dominant(weights: dict[str, float]) -> str | None:
    return max(weights, key=weights.get) if weights else None


class SDAClient:
    def __init__(self, url: str = SDA_URL, timeout: float = 120.0, client: httpx.Client | None = None,
                 sleep=time.sleep, max_tries: int = 6, chunk_delay: float = 0.25):
        self.url = url
        self.http = client or httpx.Client(timeout=timeout, follow_redirects=True, headers={"User-Agent": UA})
        self.sleep, self.max_tries, self.chunk_delay = sleep, max_tries, chunk_delay
        self.log: list[dict] = []  # every successful request, for the manifest (SQL hashed, not inlined: it can be ~40 KB of WKT)

    def query(self, sql: str) -> list[dict]:
        if self.log and self.chunk_delay:
            self.sleep(self.chunk_delay)
        last: Exception | None = None
        for attempt in range(1, self.max_tries + 1):
            t0 = time.monotonic()
            try:
                r = self.http.post(self.url, json={"query": sql, "format": "JSON+COLUMNNAME"})
            except httpx.ProxyError as exc:
                if "403" in str(exc) or "407" in str(exc):
                    raise BlockedError(f"proxy refused {self.url}: {exc}") from exc
                last = exc
            except (httpx.TimeoutException, httpx.TransportError) as exc:
                last = exc
            else:
                if r.status_code in (403, 407):
                    raise BlockedError(f"{r.status_code} from {self.url}")
                if r.status_code >= 400:
                    # SDA reports query errors as XML on HTTP 400 regardless of the requested format.
                    msg = _service_exception(r.text) or f"HTTP {r.status_code}: {r.text[:200]}"
                    low = msg.lower()
                    if "timed out" in low or "memory limit" in low:
                        raise QueryTooBigError(msg)
                    if r.status_code != 429 and r.status_code < 500:
                        raise SDAError(msg)
                    last = SDAError(msg)
                    ra = r.headers.get("Retry-After")
                    if ra and ra.isdigit():
                        self.sleep(min(float(ra), 60))
                        continue
                else:
                    try:
                        body = r.json()
                    except ValueError:
                        raise SDAError(_service_exception(r.text) or f"non-JSON response: {r.text[:200]!r}") from None
                    rows = _table_rows(body)
                    self.log.append({"method": "POST", "url": self.url, "sql_sha256": hashlib.sha256(sql.encode()).hexdigest(),
                                     "sql_chars": len(sql), "rows": len(rows), "seconds": round(time.monotonic() - t0, 2)})
                    return rows
            if attempt < self.max_tries:
                self.sleep(min(60.0, 2 ** (attempt - 1)) * (0.5 + random.random()))
        raise SDAError(f"giving up after {self.max_tries} tries: {self.url}: {last}")


def _table_rows(body: Any) -> list[dict]:
    """{"Table": [[header...], [row...], ...]} -> list of dicts. An empty result is `{}`."""
    table = body.get("Table") if isinstance(body, dict) else None
    if not table:
        return []
    header = table[0]
    return [dict(zip(header, row)) for row in table[1:]]


def run_batched(client: SDAClient, items: list, size: int, build_sql: Callable[[list], str], label: str) -> list[dict]:
    batches = [items[i:i + size] for i in range(0, len(items), size)]
    rows: list[dict] = []
    for i, batch in enumerate(batches, 1):
        if len(batches) > 1:
            print(f"  {label}: batch {i}/{len(batches)}", file=sys.stderr)
        rows.extend(_run_split(client, batch, build_sql))
    return rows


def _run_split(client: SDAClient, items: list, build_sql: Callable[[list], str]) -> list[dict]:
    try:
        return client.query(build_sql(items))
    except QueryTooBigError:
        if len(items) == 1:
            raise
        mid = len(items) // 2
        print(f"  query too heavy for SDA, splitting {len(items)} -> {mid} + {len(items) - mid}", file=sys.stderr)
        return _run_split(client, items[:mid], build_sql) + _run_split(client, items[mid:], build_sql)


# ---------------------------------------------------------------------- SQL

def buffer_wkt(lon: float, lat: float, radius_m: float, n: int = BUFFER_VERTICES) -> str:
    """A radius_m circle around (lon, lat) as a WGS84 polygon: an ellipse in degrees, a circle in metres."""
    dlat = radius_m / M_PER_DEG
    dlon = radius_m / (M_PER_DEG * math.cos(math.radians(lat)))
    pts = [(lon + dlon * math.cos(2 * math.pi * k / n), lat + dlat * math.sin(2 * math.pi * k / n)) for k in range(n)]
    pts.append(pts[0])
    return "POLYGON((" + ", ".join(f"{x:.6f} {y:.6f}" for x, y in pts) + "))"


def mapunit_area_sql(batch: list[tuple[int, str]]) -> str:
    """Share of each buffer covered by each map unit. Areas are in degrees^2; only their ratio is used."""
    values = ", ".join(f"({int(pid)}, '{wkt}')" for pid, wkt in batch)
    return ("SELECT p.pid, m.mukey, SUM(m.mupolygongeo.STIntersection(p.g).STArea()) / MAX(p.g.STArea()) AS frac "
            "FROM (SELECT pid, geometry::STGeomFromText(wkt, 4326) AS g FROM (VALUES " + values + ") v(pid, wkt)) p "
            "JOIN mupolygon m ON m.mupolygongeo.STIntersects(p.g) = 1 GROUP BY p.pid, m.mukey")


def _keys(mukeys: list[str]) -> str:
    for k in mukeys:
        if not k.isdigit():
            raise SDAError(f"refusing non-numeric mukey {k!r}")
    return ",".join(f"'{k}'" for k in mukeys)


def mapunit_attr_sql(mukeys: list[str]) -> str:
    return ("SELECT mu.mukey, mu.muname, a.wtdepannmin, a.flodfreqdcd, a.pondfreqprs, a.slopegraddcp, "
            "l.areasymbol, s.saverest FROM mapunit mu LEFT JOIN muaggatt a ON a.mukey = mu.mukey "
            "JOIN legend l ON l.lkey = mu.lkey LEFT JOIN sacatalog s ON s.areasymbol = l.areasymbol "
            f"WHERE mu.mukey IN ({_keys(mukeys)})")


def horizon_sql(mukeys: list[str], depth_cm: float) -> str:
    """Every component, with its horizons that start above depth_cm (none for Urban land, Water, ...)."""
    cols = ", ".join(f"h.{c}" for c in HORIZON_PROPS.values() if c != "fragvol_sum")
    return ("SELECT c.mukey, c.cokey, c.compname, c.compkind, c.comppct_r, c.drainagecl, c.hydgrp, "
            f"h.hzdept_r, h.hzdepb_r, {cols}, "
            "(SELECT SUM(f.fragvol_r) FROM chfrags f WHERE f.chkey = h.chkey) AS fragvol_sum, "
            "(SELECT TOP 1 u.unifiedcl FROM chunified u WHERE u.chkey = h.chkey AND u.rvindicator = 'Yes') AS uscs "
            f"FROM component c LEFT JOIN chorizon h ON h.cokey = c.cokey AND h.hzdept_r < {depth_cm:g} "
            f"WHERE c.mukey IN ({_keys(mukeys)})")


def interp_sql(mukeys: list[str]) -> str:
    rules = ",".join(f"'{r}'" for r in FOR_RULES)
    return ("SELECT c.mukey, c.cokey, i.mrulename, i.interphr, i.interphrc FROM component c "
            "JOIN cointerp i ON i.cokey = c.cokey AND i.ruledepth = 0 "
            f"WHERE c.mukey IN ({_keys(mukeys)}) AND (i.mrulename IN ({rules}) OR i.mrulename LIKE 'MIL - Trafficability%')")


def rating_column(rule: str) -> str | None:
    if rule in FOR_RULES:
        return FOR_RULES[rule]
    m = MIL_RULE.match(rule)
    return f"mil_traf_t{m.group(1)}_{MIL_SUFFIX[m.group(2)]}" if m else None


# -------------------------------------------------------------- aggregation

def component_props(horizons: list[dict], depth_cm: float) -> dict[str, Any]:
    """Depth-weighted mean of each property over 0..depth_cm, using only horizons that report it.
    A missing chfrags row means no coarse fragments, but only on a horizon that has other data."""
    out: dict[str, Any] = {}
    for col, src in HORIZON_PROPS.items():
        num = den = 0.0
        for h in horizons:
            if h["hzdept_r"] is None or h["hzdepb_r"] is None:
                continue
            thick = min(h["hzdepb_r"], depth_cm) - max(h["hzdept_r"], 0.0)
            v = h[src]
            if v is None and src == "fragvol_sum" and any(h[c] is not None for c in DATA_COLUMNS):
                v = 0.0
            if thick <= 0 or v is None:
                continue
            num += thick * v
            den += thick
        out[col] = num / den if den else None
    top = sorted((h for h in horizons if h["uscs"] and h["hzdept_r"] is not None), key=lambda h: h["hzdept_r"])
    out["uscs_surface"] = top[0]["uscs"] if top else None
    out["has_data"] = any(h[c] is not None for h in horizons for c in DATA_COLUMNS)
    return out


def aggregate_plant(fracs: dict[str, float], mapunits: dict[str, dict], components: dict[str, list[dict]],
                    ratings: dict[str, dict[str, tuple[float | None, str | None]]]) -> dict[str, Any]:
    """fracs: mukey -> share of the buffer. Component weight = share x comppct_r / 100."""
    num: dict[str, float] = defaultdict(float)
    den: dict[str, float] = defaultdict(float)
    cats: dict[str, dict[str, float]] = defaultdict(lambda: defaultdict(float))
    names: dict[str, float] = defaultdict(float)
    coverage = urban = water = 0.0

    def add(col: str, v: float | None, w: float) -> None:
        if v is not None:
            num[col] += w * v
            den[col] += w

    for mukey, frac in fracs.items():
        mu = mapunits.get(mukey, {})
        add("wt_depth_annual_min_cm", mu.get("wtdepannmin"), frac)
        add("pond_freq_pct", mu.get("pondfreqprs"), frac)
        add("slope_pct", mu.get("slopegraddcp"), frac)
        if mu.get("flodfreqdcd"):
            cats["flood_freq"][mu["flodfreqdcd"]] += frac
        for c in components.get(mukey, ()):
            w = frac * (c["comppct_r"] or 0.0) / 100.0
            if w <= 0:
                continue
            name = c["compname"] or ""
            names[name] += w
            if name.lower().startswith("urban land"):
                urban += w
            elif name.lower() == "water" or name.lower().startswith("water,"):
                water += w
            p = c["props"]
            if p["has_data"]:
                coverage += w
            for col in HORIZON_PROPS:
                add(col, p[col], w)
            for col, v in (("drainage_class", c["drainagecl"]), ("hydrologic_group", c["hydgrp"]), ("uscs_surface", p["uscs_surface"])):
                if v:
                    cats[col][v] += w
            for col, (fuzzy, cls) in ratings.get(c["cokey"], {}).items():
                add(col, fuzzy, w)
                if col == "rutting_hazard" and cls and cls != "Not rated":
                    cats["rutting_hazard_class"][cls] += w

    dom = max(fracs, key=fracs.get) if fracs else None
    mu = mapunits.get(dom, {}) if dom else {}
    out: dict[str, Any] = {
        "mapped_frac": _round(min(sum(fracs.values()), 1.0), 4), "soil_coverage_frac": round(coverage, 4),
        "urban_frac": round(urban, 4), "water_frac": round(water, 4),
        "dominant_mukey": dom, "dominant_muname": mu.get("muname"), "dominant_component": _dominant(names),
        "areasymbol": mu.get("areasymbol"), "survey_saverest": mu.get("saverest"),
    }
    for col in (*HORIZON_PROPS, "wt_depth_annual_min_cm", "pond_freq_pct", "slope_pct", *RATING_COLS):
        out[col] = _round(num[col] / den[col], 3) if den[col] else None
    for col in ("uscs_surface", "drainage_class", "hydrologic_group", "flood_freq", "rutting_hazard_class"):
        out[col] = _dominant(cats[col])
    return out


class SoilFetcher:
    """Caches map-unit, component and rating data by mukey across the main pass and the fallback pass."""

    def __init__(self, client: SDAClient, depth_cm: float, batch: int):
        self.client, self.depth_cm, self.batch = client, depth_cm, batch
        self.mapunits: dict[str, dict] = {}
        self.components: dict[str, list[dict]] = defaultdict(list)
        self.ratings: dict[str, dict[str, tuple[float | None, str | None]]] = defaultdict(dict)
        self._fetched: set[str] = set()

    def buffer_fracs(self, plants: list[dict], radius_m: float) -> dict[int, dict[str, float]]:
        items = [(p["plant_id"], buffer_wkt(p["lon"], p["lat"], radius_m)) for p in plants]
        rows = run_batched(self.client, items, self.batch, mapunit_area_sql, f"map units within {radius_m:g} m")
        out: dict[int, dict[str, float]] = {p["plant_id"]: {} for p in plants}
        for r in rows:
            mukey, frac = _str(r["mukey"]), _num(r["frac"])
            if mukey and frac:
                out[int(r["pid"])][mukey] = frac
        return out

    def ensure_mukeys(self, mukeys: Iterable[str]) -> None:
        new = sorted(set(mukeys) - self._fetched)
        if not new:
            return
        for r in run_batched(self.client, new, MAPUNIT_CHUNK, mapunit_attr_sql, "map-unit attributes"):
            flood = _str(r["flodfreqdcd"])
            self.mapunits[r["mukey"]] = {
                # SSURGO's flooding class "None" means never floods, but pandas reads the string "None" as missing.
                "muname": _str(r["muname"]), "wtdepannmin": _num(r["wtdepannmin"]),
                "flodfreqdcd": "No flooding" if flood == "None" else flood,
                "pondfreqprs": _num(r["pondfreqprs"]), "slopegraddcp": _num(r["slopegraddcp"]),
                "areasymbol": _str(r["areasymbol"]), "saverest": _str(r["saverest"]),
            }

        comps: dict[str, dict] = {}
        horizons: dict[str, list[dict]] = defaultdict(list)
        rows = run_batched(self.client, new, HORIZON_CHUNK, lambda ks: horizon_sql(ks, self.depth_cm), "components + horizons")
        for r in rows:
            cokey = r["cokey"]
            if cokey not in comps:
                comps[cokey] = {"cokey": cokey, "compname": _str(r["compname"]), "compkind": _str(r["compkind"]),
                                "comppct_r": _num(r["comppct_r"]), "drainagecl": _str(r["drainagecl"]), "hydgrp": _str(r["hydgrp"])}
                self.components[r["mukey"]].append(comps[cokey])
            if r["hzdept_r"] is not None:
                h = {c: _num(r[c]) for c in ("hzdept_r", "hzdepb_r", *HORIZON_PROPS.values())}
                h["uscs"] = _str(r["uscs"])
                horizons[cokey].append(h)
        for cokey, c in comps.items():
            c["props"] = component_props(horizons[cokey], self.depth_cm)

        for r in run_batched(self.client, new, INTERP_CHUNK, interp_sql, "interpretations"):
            col = rating_column(_str(r["mrulename"]) or "")
            if col:
                self.ratings[r["cokey"]][col] = (_num(r["interphr"]), _str(r["interphrc"]))
        self._fetched.update(new)

    def row(self, plant: dict, fracs: dict[str, float], radius_m: float) -> dict[str, Any]:
        return {**{k: plant[k] for k in ("plant_id", "plant_name", "state", "county", "technology", "lat", "lon")},
                "radius_m_used": radius_m, **aggregate_plant(fracs, self.mapunits, self.components, self.ratings)}

    def vintages(self) -> dict[str, str | None]:
        return dict(sorted({m["areasymbol"]: m["saverest"] for m in self.mapunits.values() if m["areasymbol"]}.items()))


# ------------------------------------------------------------------- plants

def load_plants(xlsx: Path, sheet: str, states: list[str], plant_ids: list[int], limit: int | None) -> list[dict]:
    """One record per EIA-860M plant (the sheet has one row per generator)."""
    try:
        import pandas as pd
    except ImportError as exc:
        raise SDAError("`plants` needs pandas and openpyxl (pip install -r requirements.txt)") from exc
    if not xlsx.exists():
        raise SDAError(f"{xlsx} not found (run from data/soil-data/, or pass --xlsx)")
    cols = ["Plant ID", "Plant Name", "Plant State", "County", "Technology", "Latitude", "Longitude"]
    df = pd.read_excel(xlsx, sheet_name=sheet, header=2, usecols=cols)
    df["Plant ID"] = pd.to_numeric(df["Plant ID"], errors="coerce")
    df = df.dropna(subset=["Plant ID", "Latitude", "Longitude"])
    if states:
        df = df[df["Plant State"].astype(str).str.upper().isin({s.upper() for s in states})]
    if plant_ids:
        df = df[df["Plant ID"].astype(int).isin(set(plant_ids))]
    plants = []
    for pid, g in df.groupby("Plant ID", sort=True):
        first = g.iloc[0]
        plants.append({
            "plant_id": int(pid), "plant_name": first["Plant Name"], "state": first["Plant State"],
            "county": first["County"], "technology": "; ".join(sorted(g["Technology"].dropna().astype(str).unique())),
            "lat": float(first["Latitude"]), "lon": float(first["Longitude"]),
        })
    return plants[:limit] if limit else plants


# ------------------------------------------------------------------- output

def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def write_json(rows: Iterator[dict], path: Path) -> int:
    n = 0
    with open(path, "w", encoding="utf-8") as f:
        f.write("[")
        for row in rows:
            f.write(("," if n else "") + json.dumps(row, separators=(",", ":")))
            n += 1
        f.write("]")
    return n


def write_csv(rows: Iterator[dict], path: Path, fieldnames: tuple[str, ...] = ROW_FIELDS) -> int:
    n = 0
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        for row in rows:
            w.writerow(row)
            n += 1
    return n


def write_parquet(rows: Iterator[dict], path: Path, fieldnames: tuple[str, ...] = ROW_FIELDS) -> int:
    try:
        import pandas as pd
    except ImportError as exc:
        raise SDAError("parquet output needs pandas and pyarrow (pip install pandas pyarrow)") from exc
    data = list(rows)
    pd.DataFrame(data, columns=list(fieldnames)).to_parquet(path)
    return len(data)


WRITERS = {"csv": write_csv, "json": write_json, "parquet": write_parquet}


def write_manifest(out: Path, client: SDAClient, count: int, query: dict, extra: dict | None = None, note: str = "") -> Path:
    m = {
        "retrieved_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "file": str(out),
        "sha256": sha256_file(out), "bytes": out.stat().st_size, "row_count": count,
        "service_base": client.url, "query": query, **(extra or {}), "requests": client.log, "note": note,
    }
    mp = out.with_name(out.name + ".manifest.json")
    mp.write_text(json.dumps(m, indent=2))
    return mp


# --------------------------------------------------------------------- commands

def run_plants(args, c: SDAClient) -> int:
    plants = load_plants(args.xlsx, args.sheet, args.state, args.plant_id, args.limit)
    if not plants:
        raise SDAError("no plants matched (check --state / --plant-id / --sheet)")
    print(f"{len(plants)} plants from {args.xlsx} [{args.sheet}]", file=sys.stderr)

    f = SoilFetcher(c, args.depth_cm, args.batch)
    fracs = f.buffer_fracs(plants, args.radius_m)
    f.ensure_mukeys(mk for d in fracs.values() for mk in d)
    rows = {p["plant_id"]: f.row(p, fracs[p["plant_id"]], args.radius_m) for p in plants}

    retried = improved = 0
    if args.fallback_radius_m > args.radius_m:
        low = [p for p in plants if rows[p["plant_id"]]["soil_coverage_frac"] < args.min_coverage]
        if low:
            print(f"{len(low)} plants under {args.min_coverage:g} soil coverage; retrying at {args.fallback_radius_m:g} m", file=sys.stderr)
            fracs2 = f.buffer_fracs(low, args.fallback_radius_m)
            f.ensure_mukeys(mk for d in fracs2.values() for mk in d)
            for p in low:
                r2 = f.row(p, fracs2[p["plant_id"]], args.fallback_radius_m)
                retried += 1
                if r2["soil_coverage_frac"] > rows[p["plant_id"]]["soil_coverage_frac"]:
                    rows[p["plant_id"]] = r2
                    improved += 1

    if args.state:
        tag = "-".join(s.upper() for s in args.state)
    else:
        tag = f"{len(args.plant_id)}ids" if args.plant_id else "all"
    out = args.out or Path(f"soil_plants_{tag}_{args.radius_m:g}m.{args.format}")
    n = WRITERS[args.format](iter(rows.values()), out)
    query = {"xlsx": str(args.xlsx), "sheet": args.sheet, "state": args.state, "plant_id": args.plant_id, "limit": args.limit,
             "radius_m": args.radius_m, "fallback_radius_m": args.fallback_radius_m, "min_coverage": args.min_coverage,
             "depth_cm": args.depth_cm, "batch": args.batch}
    extra = {"fallback": {"retried": retried, "improved": improved}, "survey_vintages": f.vintages()}
    manifest = write_manifest(out, c, n, query, extra)
    print(f"wrote {n} rows to {out} ({len(c.log)} requests); manifest {manifest}")
    empty = [r["plant_id"] for r in rows.values() if r["soil_coverage_frac"] == 0]
    if empty:
        print(f"warning: {len(empty)} plants have no soil data in any buffer: {empty[:20]}{' ...' if len(empty) > 20 else ''}",
              file=sys.stderr)
    return 0


def run_query(args, c: SDAClient) -> int:
    if args.file:
        sql = args.file.read_text()
    elif args.sql:
        sql = args.sql
    else:
        raise SDAError("give SQL as an argument or with --file")
    rows = c.query(sql)
    if not args.out:
        print(json.dumps(rows, indent=1))
        return 0
    fields = tuple(rows[0]) if rows else ()
    n = write_csv(iter(rows), args.out, fieldnames=fields) if args.format == "csv" else write_json(iter(rows), args.out)
    manifest = write_manifest(args.out, c, n, {"sql": sql})
    print(f"wrote {n} rows to {args.out}; manifest {manifest}")
    return 0


# --------------------------------------------------------------------- CLI

def main(argv: list[str] | None = None, client: SDAClient | None = None) -> int:
    ap = argparse.ArgumentParser(description="Fetch SSURGO soil data from USDA Soil Data Access")
    ap.add_argument("--url", default=SDA_URL, help="SDA post.rest endpoint")
    ap.add_argument("--max-tries", type=int, default=6, dest="max_tries")
    ap.add_argument("--chunk-delay", type=float, default=0.25, dest="chunk_delay", help="seconds between SDA requests")
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("plants", help="one row of soil properties per EIA-860M power plant")
    p.add_argument("--xlsx", type=Path, default=DEFAULT_XLSX, help="EIA-860M generator workbook")
    p.add_argument("--sheet", default="Operating", choices=PLANT_SHEETS)
    p.add_argument("--state", action="append", default=[], help="2-letter plant state, repeatable")
    p.add_argument("--plant-id", action="append", type=int, default=[], dest="plant_id", help="EIA plant id, repeatable")
    p.add_argument("--limit", type=int, help="stop after N plants (after filtering)")
    p.add_argument("--radius-m", type=float, default=250.0, dest="radius_m")
    p.add_argument("--fallback-radius-m", type=float, default=1000.0, dest="fallback_radius_m",
                   help="retry radius for low-coverage plants; 0 disables")
    p.add_argument("--min-coverage", type=float, default=0.2, dest="min_coverage",
                   help="buffer share of soil with horizon data below which the fallback runs")
    p.add_argument("--depth-cm", type=float, default=30.0, dest="depth_cm", help="horizon averaging depth")
    p.add_argument("--batch", type=int, default=50, help="plants per spatial query")
    p.add_argument("--format", default="csv", choices=list(WRITERS))
    p.add_argument("--out", type=Path)

    q = sub.add_parser("query", help="run raw SQL against SDA (prints JSON unless --out)")
    q.add_argument("sql", nargs="?")
    q.add_argument("--file", type=Path, help="read the SQL from a file")
    q.add_argument("--format", default="json", choices=("json", "csv"))
    q.add_argument("--out", type=Path)

    args = ap.parse_args(argv)
    try:
        c = client or SDAClient(args.url, max_tries=args.max_tries, chunk_delay=args.chunk_delay)
        if args.cmd == "plants":
            if args.radius_m <= 0 or args.depth_cm <= 0 or args.batch < 1:
                raise SDAError("--radius-m and --depth-cm must be > 0, --batch >= 1")
            return run_plants(args, c)
        return run_query(args, c)
    except BlockedError as exc:
        print(f"BLOCKED (policy denial, not retried): {exc}", file=sys.stderr)
        return 2
    except SDAError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
