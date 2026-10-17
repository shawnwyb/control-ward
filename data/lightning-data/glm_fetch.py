#!/usr/bin/env python3
"""Fetch historical lightning flash detections from NOAA GOES-East GLM. Public, no API key.

  https://noaa-goes19.s3.amazonaws.com/GLM-L2-LCFA/<year>/<day-of-year>/<hour>/*.nc

Ports the exact decode this repo's LIVE pipeline uses (supabase/functions/_shared/glm.ts,
geo.ts, types.ts), so results match what that pipeline would have recorded -- for any past
date instead of "now". That pipeline only ingests from whenever it was deployed onward; this
script is how you look further back (e.g. "what happened yesterday").

GLM is a satellite optical-flash sensor, not a ground-strike network: it reports detected
flashes with a quality flag (0 = good, filtered by default here, same as the live pipeline).

Usage
  python glm_fetch.py flashes --lat 27.95 --lon -82.46 --radius-mi 25
  python glm_fetch.py flashes --lat 27.95 --lon -82.46 --begin 2026-10-10 --end 2026-10-16 \
      --format parquet --out tampa_week.parquet

Data volume: NOAA publishes one file every 20 seconds, ~260KB each, REGARDLESS of --radius-mi
(filtering happens after download, server-side there's no spatial query). A full day is
~4,320 files / ~1.1GB transient download. Narrow with --hour-start/--hour-end for a faster run.

Exit codes: 0 ok, 1 error, 2 blocked by network policy (403/407, never retried).
Needs: httpx, h5py. Parquet output also needs pandas + pyarrow.

Per-file GETs are NOT individually logged in the manifest (there can be thousands per run);
only the per-hour listing calls are. A file that 404s between listing and fetch (rare, but
possible at the live edge of the archive) is skipped with a stderr warning, not a fatal
error -- unlike the other fetch scripts in data/, one file here is one of thousands, not one
of a handful of logical chunks, so losing it shouldn't abort the whole run.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import math
import random
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterator

import h5py
import httpx

GLM_BUCKET = "https://noaa-goes19.s3.amazonaws.com"
FILE_SECONDS = 20
# Packing from the GLM L2 product spec: offsets are int16 seconds with scale 3.8147554e-4 and offset 9.5.
TIME_SCALE = 3.8147554e-4
TIME_OFFSET = 9.5
J2000_NOON_UTC = datetime(2000, 1, 1, 12, tzinfo=timezone.utc)
EARTH_RADIUS_MI = 3958.7613
DEFAULT_RADIUS_MI = 25.0  # matches docs/api-contract.md's lightning "info" threshold (10mi=stop_work, 25mi=info)
UA = "glm_fetch/1.0 (research script)"

KEY_RE = re.compile(r"<Key>([^<]+\.nc)</Key>")
ROW_FIELDS = ("lat", "lon", "struck_at", "source", "satellite")


class BlockedError(RuntimeError):
    """403/407 or a proxy CONNECT refusal. A policy denial: never retried."""


class GLMError(RuntimeError):
    pass


class _FileNotFound(Exception):
    """A listed file 404'd by the time it was fetched. Caught and skipped, not fatal."""


def haversine_mi(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    rad = math.pi / 180
    a = (math.sin((lat2 - lat1) * rad / 2) ** 2
         + math.cos(lat1 * rad) * math.cos(lat2 * rad) * math.sin((lon2 - lon1) * rad / 2) ** 2)
    return 2 * EARTH_RADIUS_MI * math.asin(math.sqrt(a))


class GLMClient:
    def __init__(self, bucket: str = GLM_BUCKET, timeout: float = 30.0, client: httpx.Client | None = None,
                 sleep=time.sleep, max_tries: int = 6, concurrency: int = 8):
        self.bucket = bucket.rstrip("/")
        self.http = client or httpx.Client(timeout=timeout, follow_redirects=True, headers={"User-Agent": UA})
        self.sleep, self.max_tries, self.concurrency = sleep, max_tries, concurrency
        self.log: list[dict] = []  # per-hour listing requests only; see module docstring

    # ---------------------------------------------------------------- HTTP
    def _request(self, url: str, *, binary: bool) -> Any:
        last: Exception | None = None
        for attempt in range(1, self.max_tries + 1):
            try:
                r = self.http.get(url)
            except httpx.ProxyError as exc:
                if "403" in str(exc) or "407" in str(exc):
                    raise BlockedError(f"proxy refused {url}: {exc}") from exc
                last = exc
            except (httpx.TimeoutException, httpx.TransportError) as exc:
                last = exc
            else:
                if r.status_code in (403, 407):
                    raise BlockedError(f"{r.status_code} from {url}")
                if r.status_code == 404:
                    raise _FileNotFound(url)
                if r.status_code == 429 or r.status_code >= 500:
                    last = GLMError(f"HTTP {r.status_code} from {url}")
                    ra = r.headers.get("Retry-After")
                    if ra and ra.isdigit():
                        self.sleep(min(float(ra), 60))
                        continue
                elif r.status_code >= 400:
                    raise GLMError(f"HTTP {r.status_code} from {url}: {r.text[:200]}")
                else:
                    return r.content if binary else r.text
            if attempt < self.max_tries:
                self.sleep(min(60.0, 2 ** (attempt - 1)) * (0.5 + random.random()))
        raise GLMError(f"giving up after {self.max_tries} tries: {url}: {last}")

    # ------------------------------------------------------------- listing
    def _hour_prefixes(self, begin: date, end: date, hour_start: int, hour_end: int) -> list[str]:
        prefixes = []
        d = begin
        while d <= end:
            doy = d.timetuple().tm_yday
            for h in range(hour_start, hour_end + 1):
                prefixes.append(f"GLM-L2-LCFA/{d.year}/{doy:03d}/{h:02d}/")
            d += timedelta(days=1)
        return prefixes

    def _list_hour(self, prefix: str) -> list[str]:
        url = f"{self.bucket}/?list-type=2&prefix={prefix}"
        text = self._request(url, binary=False)
        self.log.append({"method": "GET", "url": url})
        return KEY_RE.findall(text)

    # ---------------------------------------------------------------- parse
    def _parse_file(self, data: bytes, *, lat: float, lon: float, radius_mi: float, margin_deg: float,
                     quality_only: bool) -> Iterator[dict]:
        try:
            f = h5py.File(io.BytesIO(data), "r")
        except OSError as exc:
            raise GLMError(f"unreadable GLM file ({len(data)} bytes): {exc}") from exc
        flash_lat = f["flash_lat"][...]
        flash_lon = f["flash_lon"][...]
        offset = f["flash_time_offset_of_first_event"][...]
        quality = f["flash_quality_flag"][...]
        start = J2000_NOON_UTC + timedelta(seconds=float(f["product_time"][()]))
        for i in range(len(flash_lat)):
            if quality_only and quality[i] != 0:  # 0 = good quality
                continue
            flat, flon = float(flash_lat[i]), float(flash_lon[i])
            if abs(flat - lat) > margin_deg or abs(flon - lon) > margin_deg:
                continue
            if haversine_mi(lat, lon, flat, flon) > radius_mi:
                continue
            seconds = min(max(float(offset[i]) * TIME_SCALE + TIME_OFFSET, 0.0), FILE_SECONDS)
            struck_at = start + timedelta(seconds=seconds)
            yield {
                "lat": round(flat, 4), "lon": round(flon, 4),
                "struck_at": struck_at.strftime("%Y-%m-%dT%H:%M:%S.") + f"{struck_at.microsecond // 1000:03d}Z",
                "source": "goes-glm", "satellite": "GOES-19",
            }

    # ---------------------------------------------------------------- fetch
    def flashes(self, begin: date, end: date, *, hour_start: int, hour_end: int, lat: float, lon: float,
                radius_mi: float, quality_only: bool) -> tuple[dict, Iterator[dict]]:
        prefixes = self._hour_prefixes(begin, end, hour_start, hour_end)
        stats = {"files_listed": 0, "rows_matched": 0}
        # Cheap bbox prefilter before the exact haversine check below; generous enough to never
        # falsely exclude a real match even near the poleward edge of GOES-East coverage, where a
        # degree of longitude is shortest (~69*cos(lat) miles).
        margin_deg = radius_mi / 20.0 + 0.25

        def _rows() -> Iterator[dict]:
            for prefix in prefixes:
                keys = self._list_hour(prefix)
                stats["files_listed"] += len(keys)
                matched_here = 0
                with ThreadPoolExecutor(max_workers=self.concurrency) as pool:
                    futures = {pool.submit(self._request, f"{self.bucket}/{key}", binary=True): key for key in keys}
                    for fut in as_completed(futures):
                        key = futures[fut]
                        try:
                            data = fut.result()
                        except _FileNotFound:
                            print(f"warning: {key} 404'd between listing and fetch, skipping", file=sys.stderr)
                            continue
                        for row in self._parse_file(data, lat=lat, lon=lon, radius_mi=radius_mi,
                                                     margin_deg=margin_deg, quality_only=quality_only):
                            stats["rows_matched"] += 1
                            matched_here += 1
                            yield row
                print(f"{prefix}: {len(keys)} files, {matched_here} matched", file=sys.stderr)

        return stats, _rows()


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


def write_csv(rows: Iterator[dict], path: Path) -> int:
    n = 0
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=ROW_FIELDS)
        w.writeheader()
        for row in rows:
            w.writerow(row)
            n += 1
    return n


def write_parquet(rows: Iterator[dict], path: Path) -> int:
    try:
        import pandas as pd
    except ImportError as exc:
        raise GLMError("parquet output needs pandas and pyarrow (pip install pandas pyarrow)") from exc
    data = list(rows)
    pd.DataFrame(data, columns=list(ROW_FIELDS)).to_parquet(path)
    return len(data)


WRITERS = {"json": write_json, "csv": write_csv, "parquet": write_parquet}


def write_manifest(out: Path, client: GLMClient, count: int, query: dict, note: str = "") -> Path:
    m = {
        "retrieved_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "file": str(out),
        "sha256": sha256_file(out), "bytes": out.stat().st_size, "row_count": count,
        "service_base": client.bucket, "query": query, "requests": client.log, "note": note,
    }
    mp = out.with_name(out.name + ".manifest.json")
    mp.write_text(json.dumps(m, indent=2))
    return mp


# --------------------------------------------------------------------- commands

def run_flashes(args, c: GLMClient) -> int:
    stats, rows = c.flashes(args.begin, args.end, hour_start=args.hour_start, hour_end=args.hour_end,
                             lat=args.lat, lon=args.lon, radius_mi=args.radius_mi,
                             quality_only=not args.include_all_quality)
    out = args.out or Path(f"glm_{args.begin}_{args.end}_{args.lat}_{args.lon}.{args.format}")
    n = WRITERS[args.format](rows, out)
    query = {"begin": args.begin.isoformat(), "end": args.end.isoformat(), "hour_start": args.hour_start,
             "hour_end": args.hour_end, "lat": args.lat, "lon": args.lon, "radius_mi": args.radius_mi,
             "quality_only": not args.include_all_quality, "files_listed": stats["files_listed"],
             "rows_matched": stats["rows_matched"]}
    note = "per-file GETs are not individually logged (thousands/day); only hour-listing calls are."
    manifest = write_manifest(out, c, n, query, note)
    print(f"wrote {n} rows to {out} ({stats['files_listed']} files scanned); manifest {manifest}")
    return 0


# --------------------------------------------------------------------- CLI

def _parse_date(s: str) -> date:
    try:
        return datetime.strptime(s, "%Y-%m-%d").date()
    except ValueError as exc:
        raise argparse.ArgumentTypeError(f"expected YYYY-MM-DD, got {s!r}") from exc


def main(argv: list[str] | None = None, client: GLMClient | None = None) -> int:
    yesterday = (datetime.now(timezone.utc) - timedelta(days=1)).date()
    ap = argparse.ArgumentParser(description="Fetch historical NOAA GOES-East GLM lightning flash detections")
    ap.add_argument("--bucket", default=GLM_BUCKET)
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("flashes", help="fetch flashes near a point for a past UTC date range")
    p.add_argument("--lat", type=float, required=True)
    p.add_argument("--lon", type=float, required=True)
    p.add_argument("--radius-mi", type=float, default=DEFAULT_RADIUS_MI, dest="radius_mi")
    p.add_argument("--begin", type=_parse_date, default=yesterday, metavar="YYYY-MM-DD")
    p.add_argument("--end", type=_parse_date, default=yesterday, metavar="YYYY-MM-DD")
    p.add_argument("--hour-start", type=int, default=0, dest="hour_start")
    p.add_argument("--hour-end", type=int, default=23, dest="hour_end")
    p.add_argument("--include-all-quality", action="store_true", dest="include_all_quality")
    p.add_argument("--format", default="json", choices=list(WRITERS))
    p.add_argument("--out", type=Path)
    p.add_argument("--max-tries", type=int, default=6, dest="max_tries")
    p.add_argument("--concurrency", type=int, default=8)

    args = ap.parse_args(argv)
    try:
        if args.end < args.begin:
            raise GLMError(f"--end {args.end} is before --begin {args.begin}")
        if not (0 <= args.hour_start <= args.hour_end <= 23):
            raise GLMError("--hour-start/--hour-end must satisfy 0 <= start <= end <= 23, "
                            f"got {args.hour_start}/{args.hour_end}")
        c = client or GLMClient(args.bucket, max_tries=args.max_tries, concurrency=args.concurrency)
        return run_flashes(args, c)
    except BlockedError as exc:
        print(f"BLOCKED (policy denial, not retried): {exc}", file=sys.stderr)
        return 2
    except GLMError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
