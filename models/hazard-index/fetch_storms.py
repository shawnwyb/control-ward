#!/usr/bin/env python3
"""Download NOAA Storm Events "details" yearly files (2015-2025) from NCEI. Public, no API key.

  index: https://www.ncei.noaa.gov/pub/data/swdi/stormevents/csvfiles/

NCEI republishes a year under a new creation date (the _cYYYYMMDD suffix) when it revises it, so the
newest file for each year is picked from the directory listing. Existing files are kept unless
--refresh is given.

Usage
  python fetch_storms.py                 # 2015-2025 into cache/storm_events/
  python fetch_storms.py --years 2024 2025

Exit codes: 0 ok, 1 error, 2 blocked by network policy.
Every file gets a sidecar <file>.manifest.json (URL, SHA-256, row count).
"""
from __future__ import annotations

import argparse
import gzip
import re
import sys
from pathlib import Path

from hazidx import config, paths
from hazidx.http import BlockedError, Client, FetchError, write_manifest

INDEX_URL = "https://www.ncei.noaa.gov/pub/data/swdi/stormevents/csvfiles/"
_NAME = re.compile(r"StormEvents_details-ftp_v1\.0_d(\d{4})_c(\d{8})\.csv\.gz")


def newest_files(listing: str) -> dict[int, str]:
    best: dict[int, tuple[str, str]] = {}
    for m in _NAME.finditer(listing):
        year, created = int(m.group(1)), m.group(2)
        if year not in best or created > best[year][0]:
            best[year] = (created, m.group(0))
    return {y: name for y, (_, name) in best.items()}


def storm_files(cache: Path = paths.STORMS) -> dict[int, Path]:
    """The newest downloaded file for each year."""
    out: dict[int, tuple[str, Path]] = {}
    for p in cache.glob("StormEvents_details-*.csv.gz"):
        m = _NAME.fullmatch(p.name)
        if m and (int(m.group(1)) not in out or m.group(2) > out[int(m.group(1))][0]):
            out[int(m.group(1))] = (m.group(2), p)
    return {y: p for y, (_, p) in sorted(out.items())}


def main(argv: list[str] | None = None, client: Client | None = None) -> int:
    ap = argparse.ArgumentParser(description="Download NOAA Storm Events details files")
    ap.add_argument("--years", type=int, nargs="+", default=list(config.YEARS))
    ap.add_argument("--cache-dir", type=Path, default=paths.STORMS, dest="cache_dir")
    ap.add_argument("--refresh", action="store_true", help="download again even if the file exists")
    args = ap.parse_args(argv)
    c = client or Client(timeout=300.0)
    try:
        args.cache_dir.mkdir(parents=True, exist_ok=True)
        names = newest_files(c.get(INDEX_URL).text)
        missing = [y for y in args.years if y not in names]
        if missing:
            raise FetchError(f"no details file listed for {missing}")
        for y in sorted(args.years):
            out = args.cache_dir / names[y]
            if out.exists() and not args.refresh:
                print(f"{y}: have {out.name}")
                continue
            r = c.get(INDEX_URL + names[y])
            tmp = out.with_suffix(".tmp")
            tmp.write_bytes(r.content)
            with gzip.open(tmp, "rt", encoding="latin-1") as f:
                rows = sum(1 for _ in f) - 1
            tmp.replace(out)
            write_manifest(out, rows, {"year": y}, INDEX_URL, c.log[-1:])
            print(f"{y}: wrote {out.name} ({rows:,} events, {out.stat().st_size / 1e6:.1f} MB)")
        return 0
    except BlockedError as exc:
        print(f"BLOCKED (policy denial, not retried): {exc}", file=sys.stderr)
        return 2
    except FetchError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
