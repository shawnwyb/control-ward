#!/usr/bin/env python3
"""Fetch tide predictions and station metadata from NOAA CO-OPS. Public, no API key.

  predictions: https://api.tidesandcurrents.noaa.gov/api/prod/datagetter (product=predictions)
  stations:    https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations.json

NOAA documents query-duration limits (10 years per call for interval=hilo, 1 year per call for
every other interval) but does not enforce them server-side. This script still splits a longer
--begin/--end range into calendar-year chunks at those limits and merges the results into one
output + one manifest, both out of politeness (NOAA's own docs ask for throttled, modest calls)
and so the chunking logic is exercised and testable rather than relying on an unenforced cap.

NOAA error responses (a JSON body shaped {"error": {"message": ...}}) can arrive on HTTP 200 OR
HTTP 400 depending on the error (confirmed for invalid station ids, bad date ordering, and
subordinate-station/interval mismatches) -- the error-body check here runs before any status-code
branching, not gated behind a particular status.

Usage
  python tide_fetch.py predictions 8724580 --begin 20260101 --end 20260110 --interval hilo
  python tide_fetch.py predictions 8724580 --begin 20230101 --end 20260101 --interval h --format parquet --out tides.parquet
  python tide_fetch.py stations --query "key west"
  python tide_fetch.py stations --state FL --format csv --out fl_stations.csv

Exit codes: 0 ok, 1 error (bad args, NOAA error body, HTTP error after retries), 2 blocked by
network policy (403/407, never retried).
Needs: httpx, python-dateutil. Parquet output also needs pandas + pyarrow.
Every file output gets a sidecar <out>.manifest.json (query, request log, UTC timestamp, SHA-256, row count).
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import random
import sys
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterator

import httpx
from dateutil.relativedelta import relativedelta

PREDICTIONS_BASE = "https://api.tidesandcurrents.noaa.gov/api/prod/datagetter"
MDAPI_STATIONS_BASE = "https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations.json"
DEFAULT_APPLICATION = "swamphacks2026_tide_fetch"
UA = "tide_fetch/1.0 (research script)"

DATUMS = ("CRD", "IGLD", "LWD", "MHHW", "MHW", "MTL", "MSL", "MLW", "MLLW", "NAVD", "STND")
UNITS = ("english", "metric")
TIME_ZONES = ("gmt", "lst", "lst_ldt")
INTERVALS = ("h", "hilo", "1", "5", "6", "10", "15", "30", "60")
HILO_MAX_YEARS = 10
OTHER_MAX_YEARS = 1

ROW_FIELDS = ("station", "datetime", "value", "type", "datum", "units", "time_zone", "interval")
STATION_FIELDS = ("id", "name", "state", "lat", "lng", "type", "reference_id", "timezonecorr")


class BlockedError(RuntimeError):
    """403/407 or a proxy CONNECT refusal. A policy denial: never retried."""


class TideError(RuntimeError):
    pass


def _format_dt(t: str, time_zone: str) -> str:
    """NOAA's "t" is "YYYY-MM-DD HH:MM" (no seconds). gmt gets a Z suffix (unambiguous UTC);
    lst/lst_ldt stay naive since a fixed UTC offset isn't knowable without per-station tz data."""
    iso = t.replace(" ", "T")
    if iso.count(":") == 1:
        iso += ":00"
    return iso + "Z" if time_zone == "gmt" else iso


class TideClient:
    def __init__(self, predictions_base: str = PREDICTIONS_BASE, stations_base: str = MDAPI_STATIONS_BASE,
                 timeout: float = 30.0, client: httpx.Client | None = None, sleep=time.sleep,
                 max_tries: int = 6, chunk_delay: float = 0.25):
        self.predictions_base = predictions_base.rstrip("/")
        self.stations_base = stations_base
        self.http = client or httpx.Client(timeout=timeout, follow_redirects=True, headers={"User-Agent": UA})
        self.sleep, self.max_tries, self.chunk_delay = sleep, max_tries, chunk_delay
        self.log: list[dict] = []  # every successful request, for the manifest

    # ---------------------------------------------------------------- HTTP
    def _request(self, url: str, params: dict) -> dict:
        last: Exception | None = None
        for attempt in range(1, self.max_tries + 1):
            try:
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
                body: Any = None
                try:
                    body = r.json()
                except ValueError:
                    pass
                if isinstance(body, dict) and "error" in body:
                    # NOAA's quirk: error bodies arrive on HTTP 200 AND HTTP 400, so this check
                    # runs before any status-code branching below, not gated behind one status.
                    err = body["error"]
                    msg = err.get("message", err) if isinstance(err, dict) else err
                    raise TideError(f"NOAA error from {url}: {msg}")
                if r.status_code == 429 or r.status_code >= 500:
                    last = TideError(f"HTTP {r.status_code} from {url}")
                    ra = r.headers.get("Retry-After")
                    if ra and ra.isdigit():
                        self.sleep(min(float(ra), 60))
                        continue
                elif r.status_code >= 400:
                    raise TideError(f"HTTP {r.status_code} from {url}: {r.text[:200]}")
                else:
                    self.log.append({"method": "GET", "url": str(r.request.url), "params": params})
                    if body is None:
                        raise TideError(f"non-JSON response from {url}: {r.text[:200]!r}")
                    return body
            if attempt < self.max_tries:
                self.sleep(min(60.0, 2 ** (attempt - 1)) * (0.5 + random.random()))
        raise TideError(f"giving up after {self.max_tries} tries: {url}: {last}")

    # ------------------------------------------------------------- chunking
    def _date_chunks(self, begin: date, end: date, interval: str) -> list[tuple[date, date]]:
        """Partition [begin, end] into calendar-year spans at NOAA's documented per-call cap
        (10 years for hilo, 1 year otherwise). No overlap, no gap; one chunk if the range fits."""
        if begin > end:
            raise TideError(f"--begin {begin:%Y%m%d} is after --end {end:%Y%m%d}")
        years = HILO_MAX_YEARS if interval == "hilo" else OTHER_MAX_YEARS
        chunks: list[tuple[date, date]] = []
        cur = begin
        while cur <= end:
            candidate_end = cur + relativedelta(years=years) - timedelta(days=1)
            chunk_end = min(candidate_end, end)
            chunks.append((cur, chunk_end))
            cur = chunk_end + timedelta(days=1)
        return chunks

    # ---------------------------------------------------------------- fetch
    def predictions(self, station: str, begin: date, end: date, *, interval: str, datum: str, units: str,
                     time_zone: str, application: str) -> tuple[list[tuple[date, date]], Iterator[dict]]:
        chunks = self._date_chunks(begin, end, interval)

        def _rows() -> Iterator[dict]:
            for i, (c_begin, c_end) in enumerate(chunks):
                params = {
                    "product": "predictions", "station": station,
                    "begin_date": c_begin.strftime("%Y%m%d"), "end_date": c_end.strftime("%Y%m%d"),
                    "datum": datum, "units": units, "time_zone": time_zone, "interval": interval,
                    "format": "json", "application": application,
                }
                body = self._request(self.predictions_base, params)
                for p in body.get("predictions", []):
                    yield {
                        "station": station, "datetime": _format_dt(p["t"], time_zone),
                        "value": float(p["v"]), "type": p.get("type", ""),
                        "datum": datum, "units": units, "time_zone": time_zone, "interval": interval,
                    }
                if i < len(chunks) - 1:
                    self.sleep(self.chunk_delay)

        return chunks, _rows()

    def stations(self, type_: str = "tidepredictions") -> list[dict]:
        body = self._request(self.stations_base, {"type": type_})
        return body.get("stations", [])


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
        raise TideError("parquet output needs pandas and pyarrow (pip install pandas pyarrow)") from exc
    data = list(rows)
    pd.DataFrame(data, columns=list(fieldnames)).to_parquet(path)
    return len(data)


WRITERS = {"json": write_json, "csv": write_csv, "parquet": write_parquet}


def write_manifest(out: Path, client: TideClient, count: int, query: dict, service_base: str, note: str = "") -> Path:
    m = {
        "retrieved_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "file": str(out),
        "sha256": sha256_file(out), "bytes": out.stat().st_size, "row_count": count,
        "service_base": service_base, "query": query, "requests": client.log, "note": note,
    }
    mp = out.with_name(out.name + ".manifest.json")
    mp.write_text(json.dumps(m, indent=2))
    return mp


# --------------------------------------------------------------------- commands

def run_predictions(args, c: TideClient) -> int:
    try:
        begin = datetime.strptime(args.begin, "%Y%m%d").date()
        end = datetime.strptime(args.end, "%Y%m%d").date()
    except ValueError as exc:
        raise TideError(f"--begin/--end must be YYYYMMDD: {exc}") from exc

    chunks, rows = c.predictions(args.station, begin, end, interval=args.interval, datum=args.datum,
                                  units=args.units, time_zone=args.time_zone, application=args.application)
    out = args.out or Path(f"{args.station}_{args.interval}_{args.begin}_{args.end}.{args.format}")
    n = WRITERS[args.format](rows, out)
    query = {"station": args.station, "begin": args.begin, "end": args.end, "datum": args.datum,
             "units": args.units, "time_zone": args.time_zone, "interval": args.interval,
             "application": args.application, "chunks": len(chunks)}
    manifest = write_manifest(out, c, n, query, c.predictions_base)
    plural = "s" if len(chunks) != 1 else ""
    print(f"wrote {n} rows to {out} ({len(chunks)} request{plural}); manifest {manifest}")
    if n == 0:
        print("warning: 0 rows returned (check --station, --datum, and --interval compatibility)", file=sys.stderr)
    return 0


def run_stations(args, c: TideClient) -> int:
    stations = c.stations(args.type)
    q, st = (args.query or "").strip().lower(), (args.state or "").strip().upper()
    rows = []
    for s in stations:
        if st and str(s.get("state") or "").upper() != st:
            continue
        if q and q not in str(s.get("name") or "").lower() and q not in str(s.get("id") or "") \
                and q not in str(s.get("state") or "").lower():
            continue
        rows.append({k: s.get(k) for k in STATION_FIELDS})

    if args.format == "table":
        if not rows:
            print("no stations matched", file=sys.stderr)
            return 0
        print(f"{'id':<10} {'name':<30} {'state':<6} {'lat':>10} {'lng':>10}")
        for r in rows:
            print(f"{r['id']:<10} {str(r['name'])[:30]:<30} {str(r['state'] or ''):<6} {r['lat']:>10} {r['lng']:>10}")
        return 0

    out = args.out or Path(f"stations.{args.format}")
    n = write_json(iter(rows), out) if args.format == "json" else write_csv(iter(rows), out, fieldnames=STATION_FIELDS)
    query = {"type": args.type, "query": args.query or "", "state": args.state or ""}
    manifest = write_manifest(out, c, n, query, c.stations_base)
    print(f"wrote {n} stations to {out}; manifest {manifest}")
    return 0


# --------------------------------------------------------------------- CLI

def main(argv: list[str] | None = None, client: TideClient | None = None) -> int:
    ap = argparse.ArgumentParser(description="Fetch NOAA CO-OPS tide predictions and station metadata")
    ap.add_argument("--base", default=PREDICTIONS_BASE, help="predictions datagetter base URL")
    ap.add_argument("--stations-base", default=MDAPI_STATIONS_BASE, dest="stations_base",
                    help="mdapi stations metadata base URL")
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("predictions", help="fetch tide predictions for a station")
    p.add_argument("station", help="7-digit NOAA station id")
    p.add_argument("--begin", required=True, metavar="YYYYMMDD")
    p.add_argument("--end", required=True, metavar="YYYYMMDD")
    p.add_argument("--datum", default="MLLW", choices=DATUMS)
    p.add_argument("--units", default="english", choices=UNITS)
    p.add_argument("--time-zone", default="gmt", choices=TIME_ZONES, dest="time_zone")
    p.add_argument("--interval", default="h", choices=INTERVALS)
    p.add_argument("--format", default="json", choices=list(WRITERS))
    p.add_argument("--out", type=Path)
    p.add_argument("--application", default=DEFAULT_APPLICATION)
    p.add_argument("--max-tries", type=int, default=6, dest="max_tries")
    p.add_argument("--chunk-delay", type=float, default=0.25, dest="chunk_delay")

    s = sub.add_parser("stations", help="search NOAA station metadata (mdapi)")
    s.add_argument("--query", help="case-insensitive substring match against name/id/state")
    s.add_argument("--state", help="exact 2-letter state match")
    s.add_argument("--type", default="tidepredictions", help="mdapi station type filter")
    s.add_argument("--format", default="table", choices=("table", "json", "csv"))
    s.add_argument("--out", type=Path)

    args = ap.parse_args(argv)
    try:
        if args.cmd == "predictions":
            c = client or TideClient(args.base, args.stations_base, max_tries=args.max_tries,
                                      chunk_delay=args.chunk_delay)
            return run_predictions(args, c)
        c = client or TideClient(args.base, args.stations_base)
        return run_stations(args, c)
    except BlockedError as exc:
        print(f"BLOCKED (policy denial, not retried): {exc}", file=sys.stderr)
        return 2
    except TideError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
