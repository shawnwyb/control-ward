#!/usr/bin/env python3
"""Fetch data from the USACE National Levee Database (NLD). Two independent services.

A) NLD2 REST API (documented in NLD2_API.pdf, v4.41.0, OpenAPI 3.1.0), `nld2` subcommands:
     base  https://levees.sec.usace.army.mil/api-local
   Public, no key documented (401 exists for restricted features: needs an NLD account and
   clearance per the PDF). The PDF lists ~200 paths but shows parameters and response shapes
   ONLY for /agency, /agency/{id}, /agency-organization/{id}. Query parameters of everything else
   (/systems/query, /geometries/query, /coordinate-lookup, /segments, paging, POST bodies) are NOT
   in the PDF. `nld2 spec` downloads the OpenAPI document and prints them, which is the way to
   find out; pass --spec-url if the default guesses miss (the PDF names a "Download OpenAPI
   Document" link but not its URL).

B) ArcGIS FeatureServer (spatial query by bbox/point/where), `layers` and `fetch` subcommands:
     https://geospatial.sec.usace.army.mil/dls/rest/services/NLD/Public/FeatureServer
   18 layers (0 Boreholes ... 17 Berms), maxRecordCount 2000, native CRS NAD83 (4269). Always
   requests outSR=4326. This is a different server from the NLD2 API and is not described in the PDF.

Usage
  python nld_fetch.py nld2 endpoints
  python nld_fetch.py nld2 hello
  python nld_fetch.py nld2 spec --out nld2_openapi.json
  python nld_fetch.py nld2 get agency
  python nld_fetch.py nld2 get systems/query -p name=Cape --out systems.json   # param name unverified
  python nld_fetch.py nld2 segment-features floodwalls 1234 --out floodwalls.geojson
  python nld_fetch.py nld2 leveed-area 5205000001 --out area.geojson
  python nld_fetch.py nld2 download geojson --body '{"...": "..."}' --out nld.zip   # body schema unverified
  python nld_fetch.py layers
  python nld_fetch.py fetch boreholes --bbox -82.2,26.4,-81.6,26.9 --out boreholes.geojson
  python nld_fetch.py fetch leveed_areas --where "1=1" --format csv --out leveed_areas.csv
  python nld_fetch.py fetch 16 --point -81.87,26.64 --distance-m 5000 --format parquet --out near.parquet
  python nld_fetch.py api <path> -p key=value        # raw GET, NLD2 base by default

Exit codes: 0 ok, 1 error, 2 blocked by network policy (403/407), 3 HTTP 401 (needs account).
Needs: httpx. Parquet output also needs pandas + pyarrow.
Every output file gets a sidecar <out>.manifest.json (URL, params, UTC timestamp, SHA-256, count).
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import random
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator

import httpx

DEFAULT_BASE = "https://geospatial.sec.usace.army.mil/dls/rest/services/NLD/Public/FeatureServer"
# Live service listing, used only if the service metadata call fails.
FALLBACK_LAYERS = {
    "boreholes": 0, "crossings": 1, "levee_stations": 2, "piezometers": 3, "pump_stations": 4,
    "relief_wells": 5, "pipe_gates": 6, "alignment_lines": 7, "pipes": 8, "cross_sections": 9,
    "closure_structures": 10, "embankments": 11, "floodwalls": 12, "frm_lines": 13, "toe_drains": 14,
    "system_routes": 15, "leveed_areas": 16, "berms": 17,
}
UA = "nld_fetch/2.0 (research script)"

# ---- NLD2 API, transcribed from NLD2_API.pdf (v4.41.0). Paths only: the PDF documents no query
# ---- parameters or response schemas except for the three /agency routes. Some tag sections were
# ---- collapsed ("Show More") in the PDF, so this list is a lower bound, not the full API.
NLD2_BASE = "https://levees.sec.usace.army.mil/api-local"
NLD2_ENDPOINTS: dict[str, list[tuple[str, str]]] = {
    "agency": [("GET", "/agency"), ("GET", "/agency/{id}"), ("GET", "/agency-organization/{id}")],
    "attachments": [("GET", "/attachments"), ("GET", "/attachments/{id}")],
    "dashboard": [("GET", p) for p in (
        "/context-hierarchy", "/dashboards", "/metrics/accreditation-status", "/metrics/authorization-status",
        "/metrics/construction-history", "/metrics/inspection-history", "/metrics/inspection-rating",
        "/metrics/lsac-history", "/metrics/lsac-rating", "/metrics/risk-characteristics", "/widgets")],
    "default": [("GET", p) for p in (
        "/steward-organizations", "/sponsor-maintainers", "/test/hello", "/what-can-you-do", "/what-can-you-do/{id}",
        "/emergency-sponsors", "/system-types", "/entity-mapping", "/hsip-data", "/gallery", "/coordinate-lookup",
        "/data-request", "/test-pdfmake", "/test-react-pdf")],
    "download": [("GET", "/download/docs/public"), ("GET", "/download/gallery/{id}"), ("GET", "/download/attachments/{id}"),
                 ("POST", "/download/dataset/csv.zip"), ("POST", "/download/dataset/earth.zip"),
                 ("POST", "/download/dataset/geojson.zip"), ("POST", "/download/dataset/gpkg.zip"),
                 ("POST", "/download/dataset/shapefile.zip"), ("GET", "/download/hsip-counts-{id}.csv"),
                 ("GET", "/download/hsip-layers-{id}.zip"), ("GET", "/download/system-name-history.csv"),
                 ("GET", "/download/risk-processes.csv"), ("GET", "/download/attachment/s3")],
    "features": [("GET", p) for p in (
        "/alignment-lines", "/alignment-lines/{id}", "/boreholes", "/boreholes/{id}", "/centerlines", "/centerlines/{id}",
        "/closure-structures", "/closure-structures/{id}", "/cross-sections", "/cross-sections/{id}", "/floodwalls",
        "/floodwalls/{id}", "/frm-lines", "/frm-lines/{id}", "/berm-lines", "/berm-lines/{id}", "/channels",
        "/channels/{id}", "/geometries/{type}/{id}", "/geometries/query", "/gravity-drains", "/gravity-drains/{id}",
        "/pipes", "/pipes/{id}", "/pipe-gates", "/pipe-gates/{id}", "/levee-crossings", "/levee-crossings/{id}",
        "/leveed-areas", "/leveed-areas/{id}", "/levee-stations", "/levee-stations/{id}", "/piezometers",
        "/piezometers/{id}", "/pump-stations", "/pump-stations/{id}", "/relief-wells", "/relief-wells/{id}",
        "/toedrains", "/toedrains/{id}", "/leveed-areas-{systemId}.geojson", "/levee-stations-{segmentId}.geojson",
        "/embankments-{segmentId}.geojson", "/floodwalls-{segmentId}.geojson", "/alignment-lines-{segmentId}.geojson",
        "/closure-structures-{segmentId}.geojson", "/boreholes-{segmentId}.geojson", "/crossing-points-{segmentId}.geojson",
        "/cross-sections-{segmentId}.geojson", "/encroachments-{segmentId}.geojson", "/gravity-drains-{segmentId}.geojson",
        "/piezometers-{segmentId}.geojson", "/pump-stations-{segmentId}.geojson", "/relief-wells-{segmentId}.geojson",
        "/rehabilitations-{segmentId}.geojson", "/toe-drains-{segmentId}.geojson", "/pipes-{segmentId}.geojson",
        "/pipe-gates-{segmentId}.geojson", "/feature-counts")],
    "fema": [("GET", "/fema-fast/sys-info/{id}")],
    "health": [("GET", "/health")],
    "home": [("GET", "/context-summaries/key/{key}/value/{value}"), ("GET", "/metadata"), ("POST", "/suggestions"),
             ("GET", "/change-log"), ("GET", "/change-log/{id}"), ("GET", "/levees-combined")],
    "lis": [("GET", "/lis"), ("GET", "/lis-checklists"), ("GET", "/lis-lookups")],
    "news-events": [("GET", "/events"), ("GET", "/events/{id}"), ("GET", "/news"), ("GET", "/news/{id}")],
    "portfolios": [("GET", "/portfolio"), ("GET", "/portfolio/{id}"), ("GET", "/portfolio-system-ids/{id}"),
                   ("GET", "/portfolio-systems"), ("GET", "/portfolio-system/{id}")],
    "risk": [("POST", "/consequences"), ("GET", "/high-level-risk-assessment/{id}"), ("GET", "/risk-driver-mitigations"),
             ("GET", "/risk-drivers"), ("GET", "/system/{id}/screenings"), ("GET", "/risk-processes-link")],
    "segments": [("GET", "/segments"), ("GET", "/segments/{id}"), ("GET", "/lst-segments/{id}"),
                 ("GET", "/segments/{segmentId}/sponsorships"), ("GET", "/segments/p2-names"), ("GET", "/segment-miles")],
    "spatial-context": [("GET", "/spatial-context")],
    "system(legacy)": [("GET", "/system/{id}/detail"), ("GET", "/system/{id}/embankment-sections"),
                       ("GET", "/system/{id}/fema-segments"), ("GET", "/system/{id}/high-level-risk-assessments"),
                       ("GET", "/system/{id}/route"), ("GET", "/system/{id}/master-profile"),
                       ("GET", "/system/advancedFields"), ("GET", "/system/fieldValues/{field}"),
                       ("POST", "/system/suggestions"), ("POST", "/system/systems")],
    "system-categories": [("GET", "/system-categories/fed-nonfed"), ("GET", "/system-categories/inspection-rating"),
                          ("GET", "/system-categories/rip-status"), ("GET", "/system-categories/usace-nonusace")],
    "systems": [("GET", p) for p in (
        "/systems/names", "/systems/query", "/systems/p2-names", "/systems/external-risk/{id}", "/systems/upstream-dams",
        "/systems/upstream-dams/search", "/system-gage-overtopping", "/system-gage-overtopping-lines",
        "/system-identity-attributes/{id}")],
}
# /deprecated/api/system/{id}/features/leveed-areas is struck through in the PDF and is deliberately omitted.

# <layer> in /<layer>-{segmentId}.geojson
SEGMENT_GEOJSON = ("levee-stations", "embankments", "floodwalls", "alignment-lines", "closure-structures", "boreholes",
                   "crossing-points", "cross-sections", "encroachments", "gravity-drains", "piezometers",
                   "pump-stations", "relief-wells", "rehabilitations", "toe-drains", "pipes", "pipe-gates")
DATASET_FORMATS = ("csv", "earth", "geojson", "gpkg", "shapefile")  # /download/dataset/{fmt}.zip (earth = KMZ-style, per name only)
# The PDF names a "Download OpenAPI Document" link but not its URL. These are guesses, tried in order.
SPEC_CANDIDATES = ("openapi.json", "openapi", "swagger.json", "api-docs", "docs-json", "v3/api-docs")


class BlockedError(RuntimeError):
    """403/407 or a proxy CONNECT refusal. A policy denial: never retried."""


class NLDError(RuntimeError):
    pass


class NLDAuthError(NLDError):
    """HTTP 401. The PDF says advanced features need an NLD account and clearance."""


def norm(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", str(name).strip().lower()).strip("_")


class NLDClient:
    def __init__(self, base: str = DEFAULT_BASE, timeout: float = 60.0, client: httpx.Client | None = None,
                 sleep=time.sleep, max_tries: int = 6, headers: dict | None = None):
        self.base = base.rstrip("/")
        self.http = client or httpx.Client(timeout=timeout, follow_redirects=True,
                                           headers={"User-Agent": UA, **(headers or {})})
        self.sleep, self.max_tries = sleep, max_tries
        self._layers: dict[str, int] | None = None
        self._meta: dict[int, dict] = {}
        self.log: list[dict] = []  # every request, for the manifest

    # ---------------------------------------------------------------- HTTP
    def _request(self, method: str, url: str, params: dict | None = None, *, json_body: Any = None,
                 arcgis_errors: bool = True, raw: bool = False) -> Any:
        """arcgis_errors: treat a JSON body with an 'error' key as a failure (ArcGIS returns those with
        HTTP 200). Off for NLD2. raw: return bytes instead of parsed JSON. json_body: POST a JSON body
        (params then go in the query string); without it, POST params are form-encoded (ArcGIS style)."""
        last: Exception | None = None
        for attempt in range(1, self.max_tries + 1):
            try:
                if method == "POST" and json_body is not None:
                    r = self.http.post(url, params=params, json=json_body)
                elif method == "POST":
                    r = self.http.post(url, data=params)
                else:
                    r = self.http.get(url, params=params)
            except httpx.ProxyError as exc:
                if "403" in str(exc) or "407" in str(exc):
                    raise BlockedError(f"proxy refused {url}: {exc}") from exc
                last = exc
            except (httpx.TimeoutException, httpx.TransportError) as exc:
                last = exc
            else:
                if r.status_code in (403, 407):
                    raise BlockedError(f"{r.status_code} from {url}")
                if r.status_code == 429 or r.status_code >= 500:
                    last = NLDError(f"HTTP {r.status_code} from {url}")
                    ra = r.headers.get("Retry-After")
                    if ra and ra.isdigit():
                        self.sleep(min(float(ra), 60))
                        continue
                elif r.status_code == 401:
                    raise NLDAuthError(f"401 Unauthorized from {url}: endpoint needs an NLD account/clearance "
                                       "(NLD2_API.pdf); email NLD@usace.army.mil. Pass credentials with -H if you have them.")
                elif r.status_code >= 400:
                    raise NLDError(f"HTTP {r.status_code} from {url}: {r.text[:200]}")
                else:
                    self.log.append({"method": method, "url": str(r.request.url), "params": params or {},
                                     **({"json_body": json_body} if json_body is not None else {})})
                    if raw:
                        return r.content
                    try:
                        body = r.json()
                    except ValueError as exc:
                        raise NLDError(f"non-JSON response from {url}: {r.text[:200]!r}") from exc
                    if arcgis_errors and isinstance(body, dict) and "error" in body:  # ArcGIS reports errors with HTTP 200
                        raise NLDError(f"service error from {url}: {body['error']}")
                    return body
            if attempt < self.max_tries:
                self.sleep(min(60.0, 2 ** (attempt - 1)) * (0.5 + random.random()))
        raise NLDError(f"giving up after {self.max_tries} tries: {url}: {last}")

    # ------------------------------------------------------------- metadata
    def layers(self) -> dict[str, int]:
        if self._layers is None:
            try:
                svc = self._request("GET", self.base, {"f": "pjson"})
                found = {norm(l["name"]): int(l["id"]) for l in svc.get("layers", [])}
                self._layers = found or dict(FALLBACK_LAYERS)
            except BlockedError:
                raise
            except NLDError:
                self._layers = dict(FALLBACK_LAYERS)
        return self._layers

    def resolve(self, layer: str | int) -> int:
        if isinstance(layer, int) or str(layer).isdigit():
            return int(layer)
        key = norm(layer)
        ls = self.layers()
        if key not in ls:
            raise NLDError(f"unknown layer {layer!r}; choose one of {sorted(ls)} or an id")
        return ls[key]

    def meta(self, layer_id: int) -> dict:
        if layer_id not in self._meta:
            self._meta[layer_id] = self._request("GET", f"{self.base}/{layer_id}", {"f": "pjson"})
        return self._meta[layer_id]

    # ---------------------------------------------------------------- query
    def query(self, layer: str | int, *, where: str = "1=1", bbox: tuple | None = None,
              point: tuple | None = None, distance_m: float | None = None, ids: list[int] | None = None,
              fields: str = "*", return_geometry: bool = True, max_features: int | None = None,
              page_size: int | None = None) -> Iterator[dict]:
        """Yield GeoJSON features (WGS84). Pages with resultOffset, or by OBJECTID chunks if the
        layer does not support pagination. Page size never exceeds the layer's own maxRecordCount."""
        lid = self.resolve(layer)
        meta = self.meta(lid)
        url = f"{self.base}/{lid}/query"
        cap = int(meta.get("maxRecordCount") or 2000)
        ps = min(page_size or cap, cap)
        oid = next((f["name"] for f in meta.get("fields", []) if f.get("type") == "esriFieldTypeOID"), None)
        base: dict[str, Any] = {"f": "geojson", "where": where, "outFields": fields, "outSR": 4326,
                                "returnGeometry": str(return_geometry).lower()}
        if bbox:
            base.update(geometry=",".join(map(str, bbox)), geometryType="esriGeometryEnvelope",
                        inSR=4326, spatialRel="esriSpatialRelIntersects")
        elif point:
            base.update(geometry=f"{point[0]},{point[1]}", geometryType="esriGeometryPoint", inSR=4326,
                        spatialRel="esriSpatialRelIntersects", distance=distance_m or 0, units="esriSRUnit_Meter")
        if ids:
            base["objectIds"] = ",".join(map(str, ids))

        paginates = meta.get("advancedQueryCapabilities", {}).get("supportsPagination", True)
        n = 0
        if paginates:
            offset = 0
            while True:
                p = dict(base, resultOffset=offset, resultRecordCount=ps)
                if oid:
                    p["orderByFields"] = oid
                body = self._request("POST", url, p)
                feats = body.get("features", [])
                for ft in feats:
                    yield ft
                    n += 1
                    if max_features and n >= max_features:
                        return
                exceeded = bool(body.get("exceededTransferLimit") or body.get("properties", {}).get("exceededTransferLimit"))
                if not feats or (len(feats) < ps and not exceeded):
                    return
                offset += len(feats)
        else:
            idp = dict(base, returnIdsOnly="true", f="json")
            idp.pop("outSR", None)
            all_ids = self._request("POST", url, idp).get("objectIds") or []
            for i in range(0, len(all_ids), ps):
                p = dict(base)
                p["objectIds"] = ",".join(map(str, all_ids[i:i + ps]))
                for ft in self._request("POST", url, p).get("features", []):
                    yield ft
                    n += 1
                    if max_features and n >= max_features:
                        return


# ------------------------------------------------------------------- output

def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def write_geojson(features: Iterator[dict], path: Path) -> int:
    n = 0
    with open(path, "w", encoding="utf-8") as f:
        f.write('{"type":"FeatureCollection","features":[')
        for ft in features:
            f.write(("," if n else "") + json.dumps(ft, separators=(",", ":")))
            n += 1
        f.write("]}")
    return n


def _rows(features: Iterator[dict]) -> list[dict]:
    rows = []
    for ft in features:
        row = dict(ft.get("properties") or {})
        g = ft.get("geometry")
        if g:
            row["geometry_type"] = g.get("type")
            if g.get("type") == "Point":
                row["lon"], row["lat"] = g["coordinates"][:2]
            else:
                row["geometry_geojson"] = json.dumps(g, separators=(",", ":"))
        rows.append(row)
    return rows


def write_csv(features: Iterator[dict], path: Path) -> int:
    rows = _rows(features)
    cols: list[str] = []
    for r in rows:
        for k in r:
            if k not in cols:
                cols.append(k)
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=cols)
        w.writeheader()
        w.writerows(rows)
    return len(rows)


def write_parquet(features: Iterator[dict], path: Path) -> int:
    try:
        import pandas as pd
    except ImportError as exc:
        raise NLDError("parquet output needs pandas and pyarrow (pip install pandas pyarrow)") from exc
    rows = _rows(features)
    pd.DataFrame(rows).to_parquet(path)
    return len(rows)


WRITERS = {"geojson": write_geojson, "csv": write_csv, "parquet": write_parquet}


def write_manifest(out: Path, client: NLDClient, count: int, note: str = "") -> Path:
    m = {"retrieved_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "file": str(out),
         "sha256": sha256_file(out), "bytes": out.stat().st_size, "feature_count": count,
         "service_base": client.base, "requests": client.log, "note": note}
    mp = out.with_name(out.name + ".manifest.json")
    mp.write_text(json.dumps(m, indent=2))
    return mp


# --------------------------------------------------------------------- NLD2 API

def nld2_url(c: NLDClient, path: str) -> str:
    return f"{c.base}/{path.lstrip('/')}"


def nld2_get(c: NLDClient, path: str, params: dict | None = None) -> Any:
    return c._request("GET", nld2_url(c, path), params, arcgis_errors=False)


def fetch_spec(c: NLDClient, spec_url: str | None = None) -> tuple[str, dict]:
    """Download the OpenAPI document. The PDF gives no URL, so without --spec-url a few common
    locations under the API base are tried. A hit must look like OpenAPI (has 'openapi' and 'paths')."""
    urls = [spec_url] if spec_url else [nld2_url(c, p) for p in SPEC_CANDIDATES]
    tried = []
    for u in urls:
        try:
            body = c._request("GET", u, arcgis_errors=False)
        except NLDAuthError:
            raise
        except NLDError as exc:   # 404, HTML page, etc: try the next candidate. BlockedError is NOT caught.
            tried.append(f"{u} ({str(exc)[:60]})")
            continue
        if isinstance(body, dict) and "openapi" in body and "paths" in body:
            return u, body
        tried.append(f"{u} (JSON but not OpenAPI)")
    raise NLDError("OpenAPI document not found. Open the developer page, copy the 'Download OpenAPI Document' "
                   "link and pass it as --spec-url. Tried: " + "; ".join(tried))


def list_operations(spec: dict) -> list[dict]:
    comps = (spec.get("components") or {}).get("parameters") or {}
    ops = []
    for path, item in (spec.get("paths") or {}).items():
        shared = item.get("parameters") or []
        for method, op in item.items():
            if method.lower() not in ("get", "post", "put", "patch", "delete") or not isinstance(op, dict):
                continue
            plist = []
            for p in shared + (op.get("parameters") or []):
                if "$ref" in p:
                    p = comps.get(p["$ref"].rsplit("/", 1)[-1], {"name": p["$ref"]})
                plist.append({"name": p.get("name"), "in": p.get("in"), "required": bool(p.get("required"))})
            ops.append({"method": method.upper(), "path": path, "tags": op.get("tags"), "params": plist,
                        "has_body": "requestBody" in op, "deprecated": bool(op.get("deprecated"))})
    return ops


def _count(body: Any) -> int:
    if isinstance(body, dict) and isinstance(body.get("features"), list):
        return len(body["features"])
    return len(body) if isinstance(body, list) else 1


def save_json(body: Any, out: Path, c: NLDClient, note: str = "") -> int:
    out.write_text(json.dumps(body, indent=2))
    n = _count(body)
    print(f"wrote {out}; manifest {write_manifest(out, c, n, note)}")
    return n


def _kv(items: list[str]) -> dict:
    bad = [i for i in items if "=" not in i]
    if bad:
        raise NLDError(f"expected KEY=VALUE, got {bad}")
    return dict(i.split("=", 1) for i in items)


def run_nld2(args, c: NLDClient) -> int:
    sub = args.nld2_cmd
    if sub == "endpoints":
        for tag, ops in NLD2_ENDPOINTS.items():
            print(f"[{tag}]")
            for m, p in ops:
                print(f"  {m:<5} {p}")
        return 0
    if sub == "hello":
        for p in ("/test/hello", "/health"):
            print(p, "->", json.dumps(nld2_get(c, p)))
        return 0
    if sub == "spec":
        url, spec = fetch_spec(c, args.spec_url)
        print(f"OpenAPI {spec.get('openapi')} from {url}; info.version={spec.get('info', {}).get('version')}")
        if args.out:
            save_json(spec, args.out, c, f"openapi spec from {url}")
        for o in list_operations(spec):
            ps = ", ".join(f"{p['name']}{'*' if p['required'] else ''}({p['in']})" for p in o["params"])
            print(f"{o['method']:<5} {o['path']}  [{ps}]{' +body' if o['has_body'] else ''}{' DEPRECATED' if o['deprecated'] else ''}")
        return 0
    if sub == "get":
        body = nld2_get(c, args.path, _kv(args.param))
        if args.out:
            save_json(body, args.out, c)
        else:
            print(json.dumps(body, indent=2))
        return 0
    if sub in ("segment-features", "leveed-area"):
        if sub == "segment-features":
            layer = args.layer.strip().lower().replace("_", "-")
            if layer not in SEGMENT_GEOJSON:
                raise NLDError(f"unknown layer {args.layer!r}; documented: {', '.join(SEGMENT_GEOJSON)}")
            path, out = f"/{layer}-{args.segment_id}.geojson", args.out or Path(f"{layer}-{args.segment_id}.geojson")
        else:
            path, out = f"/leveed-areas-{args.system_id}.geojson", args.out or Path(f"leveed-areas-{args.system_id}.geojson")
        n = save_json(nld2_get(c, path), out, c)
        if n == 0:
            print("warning: 0 features (wrong id? segment ids come from /segments, system ids from /systems/query)", file=sys.stderr)
        return 0
    if sub == "download":
        fmt = args.format
        out = args.out or Path(f"nld_dataset_{fmt}.zip")
        try:
            body = json.loads(args.body) if args.body else None
        except ValueError as exc:
            raise NLDError(f"--body is not valid JSON: {exc}") from exc
        data = c._request("POST", nld2_url(c, f"/download/dataset/{fmt}.zip"), _kv(args.param) or None,
                          json_body=body if body is not None else {}, raw=True)
        out.write_bytes(data)
        print(f"wrote {len(data)} bytes to {out}; manifest {write_manifest(out, c, 1, 'binary zip; body schema not in the PDF')}")
        return 0
    raise NLDError(f"unknown nld2 command {sub!r}")


# ---------------------------------------------------------------------- CLI

def _floats(s: str, n: int) -> tuple:
    parts = [float(x) for x in s.split(",")]
    if len(parts) != n:
        raise argparse.ArgumentTypeError(f"expected {n} comma-separated numbers, got {s!r}")
    return tuple(parts)


def main(argv: list[str] | None = None, client: NLDClient | None = None) -> int:
    ap = argparse.ArgumentParser(description="Fetch data from the USACE National Levee Database")
    ap.add_argument("--base", default=DEFAULT_BASE, help="ArcGIS FeatureServer/MapServer base URL")
    ap.add_argument("--nld2-base", default=NLD2_BASE, help="NLD2 REST API base URL (from NLD2_API.pdf)")
    ap.add_argument("-H", "--header", action="append", default=[], dest="gheaders", metavar="'Name: value'",
                    help="extra header for every request (the PDF documents no auth scheme; use only if NLD issued you one)")
    sub = ap.add_subparsers(dest="cmd", required=True)

    n2 = sub.add_parser("nld2", help="NLD2 REST API at levees.sec.usace.army.mil/api-local")
    n2s = n2.add_subparsers(dest="nld2_cmd", required=True)
    n2s.add_parser("endpoints", help="list the paths transcribed from the PDF")
    n2s.add_parser("hello", help="GET /test/hello and /health (the PDF's suggested first call)")
    sp = n2s.add_parser("spec", help="download the OpenAPI document and list every operation with its parameters")
    sp.add_argument("--spec-url", help="URL of the 'Download OpenAPI Document' link (not given in the PDF)")
    sp.add_argument("--out", type=Path, help="also save the spec here")
    g = n2s.add_parser("get", help="GET any NLD2 path")
    g.add_argument("path", help="e.g. agency, agency/1, systems/names")
    g.add_argument("-p", "--param", action="append", default=[], metavar="KEY=VALUE")
    g.add_argument("--out", type=Path)
    sf = n2s.add_parser("segment-features", help="GET /<layer>-{segmentId}.geojson")
    sf.add_argument("layer", help="one of: " + ", ".join(SEGMENT_GEOJSON))
    sf.add_argument("segment_id")
    sf.add_argument("--out", type=Path)
    la = n2s.add_parser("leveed-area", help="GET /leveed-areas-{systemId}.geojson")
    la.add_argument("system_id")
    la.add_argument("--out", type=Path)
    dl = n2s.add_parser("download", help="POST /download/dataset/{format}.zip (request body schema is NOT in the PDF)")
    dl.add_argument("format", choices=DATASET_FORMATS)
    dl.add_argument("--body", help="JSON request body; take the schema from `nld2 spec`")
    dl.add_argument("-p", "--param", action="append", default=[], metavar="KEY=VALUE")
    dl.add_argument("--out", type=Path)

    sub.add_parser("layers", help="list layers and their fields from live metadata")

    f = sub.add_parser("fetch", help="download features from one layer")
    f.add_argument("layer", help="layer name (e.g. boreholes, leveed_areas) or numeric id")
    f.add_argument("--where", default="1=1", help="SQL where clause, e.g. \"SYSTEM_ID='5205000001'\" (field names: run `layers`)")
    f.add_argument("--bbox", type=lambda s: _floats(s, 4), help="xmin,ymin,xmax,ymax in lon/lat (EPSG:4326)")
    f.add_argument("--point", type=lambda s: _floats(s, 2), help="lon,lat; use with --distance-m")
    f.add_argument("--distance-m", type=float, help="search radius in metres around --point")
    f.add_argument("--ids", type=lambda s: [int(x) for x in s.split(",")], help="OBJECTIDs, comma separated")
    f.add_argument("--fields", default="*", help="comma-separated outFields (default all)")
    f.add_argument("--no-geometry", action="store_true")
    f.add_argument("--max", type=int, dest="max_features", help="stop after N features")
    f.add_argument("--format", choices=list(WRITERS), default="geojson")
    f.add_argument("--out", type=Path, help="output path (default <layer>.<format>)")

    a = sub.add_parser("api", help="raw GET (same as `nld2 get`, but with --api-base and -H per call)")
    a.add_argument("--api-base", default=NLD2_BASE, help=f"default {NLD2_BASE}")
    a.add_argument("path", help="endpoint path, e.g. agency/1")
    a.add_argument("-p", "--param", action="append", default=[], metavar="KEY=VALUE")
    a.add_argument("-H", "--header", action="append", default=[], metavar="'Name: value'",
                   help="extra header, e.g. an API key if the docs require one")
    a.add_argument("--out", type=Path, help="save JSON here instead of printing")

    # argparse reads "-82.2,26.4,..." (a western longitude) as a flag; glue such values to their option.
    raw = list(sys.argv[1:] if argv is None else argv)
    argv2: list[str] = []
    i = 0
    while i < len(raw):
        if raw[i] in ("--bbox", "--point") and i + 1 < len(raw) and raw[i + 1].startswith("-"):
            argv2.append(f"{raw[i]}={raw[i + 1]}")
            i += 2
        else:
            argv2.append(raw[i])
            i += 1
    args = ap.parse_args(argv2)
    try:
        gh = {k.strip(): v.strip() for k, v in (h.split(":", 1) for h in args.gheaders)}
        if args.cmd == "nld2":
            return run_nld2(args, client or NLDClient(args.nld2_base, headers=gh))
        if args.cmd == "api":
            hdrs = {**gh, **{k.strip(): v.strip() for k, v in (h.split(":", 1) for h in args.header)}}
            c = client or NLDClient(args.api_base, headers=hdrs)
            params = _kv(args.param)
            body = c._request("GET", f"{args.api_base.rstrip('/')}/{args.path.lstrip('/')}", params, arcgis_errors=False)
            text = json.dumps(body, indent=2)
            if args.out:
                args.out.write_text(text)
                print(f"wrote {args.out}; manifest {write_manifest(args.out, c, 1)}")
            else:
                print(text)
            return 0

        c = client or NLDClient(args.base)
        if args.cmd == "layers":
            for name, lid in sorted(c.layers().items(), key=lambda kv: kv[1]):
                m = c.meta(lid)
                cols = ", ".join(fl["name"] for fl in m.get("fields", [])[:12])
                print(f"{lid:>3}  {name:<20} {m.get('geometryType', '?'):<26} maxRecordCount={m.get('maxRecordCount')}  fields: {cols}")
            return 0

        out = args.out or Path(f"{norm(args.layer)}.{args.format}")
        feats = c.query(args.layer, where=args.where, bbox=args.bbox, point=args.point, distance_m=args.distance_m,
                        ids=args.ids, fields=args.fields, return_geometry=not args.no_geometry,
                        max_features=args.max_features)
        n = WRITERS[args.format](feats, out)
        print(f"wrote {n} features to {out}; manifest {write_manifest(out, c, n)}")
        if n == 0:
            print("warning: 0 features returned (check --where field names with `layers`, or widen --bbox)", file=sys.stderr)
        return 0
    except BlockedError as exc:
        print(f"BLOCKED (policy denial, not retried): {exc}", file=sys.stderr)
        return 2
    except NLDAuthError as exc:
        print(f"UNAUTHORIZED: {exc}", file=sys.stderr)
        return 3
    except NLDError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
