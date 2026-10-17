#!/usr/bin/env python3
"""Download hourly ERA5 weather (Open-Meteo archive, model era5_seamless) for the 60 plants, one
file per plant and UTC calendar year. Resumable and budget-aware: newest years first, existing
files are skipped, and the run stops before it would spend more than --budget weighted calls.

  archive: https://archive-api.open-meteo.com/v1/archive

Open-Meteo counts one call per location for up to 10 variables and 2 weeks of data, plus a fraction
beyond either limit, so one plant-year with 9 variables costs about 26 weighted calls and the full
60 plants x 11 years about 17,000. The free tier allows 600 a minute, 5,000 an hour and 10,000 a
day, so the full download takes 2 days. Every call is recorded in cache/weather/ledger.jsonl and
the run paces itself below the minute and hour limits.

Usage
  python fetch_weather.py run                       # day 1: budget 8,500 calls, 2025 back to ~2020
  python fetch_weather.py run --budget 10000        # day 2, after the daily quota resets
  python fetch_weather.py run --years 2024 --plants 56407 --budget 100
  python fetch_weather.py status

Exit codes: 0 ok (finished or budget reached), 1 error, 2 blocked by network policy,
3 daily quota used up (files already written are kept; run again to continue).
Every file gets a sidecar <file>.manifest.json (query, request log, SHA-256, row count).
"""
from __future__ import annotations

import argparse
import sys
import time
from datetime import date
from pathlib import Path
from typing import Callable

import pandas as pd

from hazidx import config, paths
from hazidx.features import hourly_from_json
from hazidx.http import (BlockedError, Client, FetchError, Ledger, QuotaError, openmeteo_weight,
                         write_manifest)
from hazidx.sites import Site, load_sites

HOURLY_RETRY_WAIT = 600   # seconds to wait after an hourly-limit answer
HOURLY_RETRIES = 8


def weather_file(cache: Path, eia: str, year: int) -> Path:
    return cache / f"{eia}_{year}.parquet"


def year_days(year: int) -> int:
    return (date(year + 1, 1, 1) - date(year, 1, 1)).days


def task_weight(year: int) -> float:
    return openmeteo_weight(1, len(config.ARCHIVE_VARS), year_days(year))


def plan_tasks(sites: list[Site], years, cache: Path) -> list[tuple[Site, int]]:
    """Missing (plant, year) pairs, newest year first, plants in seed order."""
    return [(s, y) for y in sorted(years, reverse=True) for s in sites
            if not weather_file(cache, s.eia_plant_id, y).exists()]


def archive_params(site: Site, year: int) -> dict:
    return {
        "latitude": f"{site.latitude:.4f}", "longitude": f"{site.longitude:.4f}",
        "start_date": f"{year}-01-01", "end_date": f"{year}-12-31",
        "hourly": ",".join(config.ARCHIVE_VARS), "models": config.ARCHIVE_MODEL,
        "timezone": "UTC", **config.UNITS,
    }


def hourly_frame(body: dict) -> pd.DataFrame:
    try:
        return hourly_from_json(body, config.ARCHIVE_VARS)
    except ValueError as exc:
        raise FetchError(str(exc)) from exc


class Pacer:
    def __init__(self, ledger: Ledger, sleep: Callable, clock: Callable):
        self.ledger, self.sleep, self.clock = ledger, sleep, clock

    def wait_for(self, weight: float) -> None:
        for window, cap in ((60, config.MINUTELY_PACE), (3600, config.HOURLY_PACE)):
            while True:
                entries = [e for e in self.ledger.entries() if e["t"] >= self.clock() - window]
                used = sum(e["weight"] for e in entries)
                if used + weight <= cap or not entries:
                    break
                # Sleep until enough of the oldest calls leave the window.
                need, freed, wake = used + weight - cap, 0.0, self.clock() + 1
                for e in sorted(entries, key=lambda e: e["t"]):
                    freed += e["weight"]
                    wake = e["t"] + window + 1
                    if freed >= need:
                        break
                self.sleep(max(1.0, wake - self.clock()))


def run(args, client: Client, sleep: Callable, clock: Callable) -> int:
    cache: Path = args.cache_dir
    cache.mkdir(parents=True, exist_ok=True)
    sites = load_sites()
    if args.plants:
        wanted = set(args.plants)
        sites = [s for s in sites if s.eia_plant_id in wanted]
    tasks = plan_tasks(sites, args.years, cache)
    ledger = Ledger(cache / "ledger.jsonl", clock=clock)
    pacer = Pacer(ledger, sleep, clock)
    total = sum(task_weight(y) for _, y in tasks)
    print(f"{len(tasks)} plant-years missing ({total:,.0f} weighted calls); budget {args.budget:,.0f}")
    spent = 0.0
    done = 0
    for site, year in tasks:
        w = task_weight(year)
        if spent + w > args.budget:
            print(f"budget reached after {done} files ({spent:,.0f} calls); run again to continue")
            return 0
        params = archive_params(site, year)
        pacer.wait_for(w)
        for attempt in range(HOURLY_RETRIES + 1):
            try:
                body = client.get_json(config.ARCHIVE_URL, params)
                break
            except QuotaError as exc:
                if exc.kind == "hourly" and attempt < HOURLY_RETRIES:
                    print(f"hourly limit reached; waiting {HOURLY_RETRY_WAIT}s", file=sys.stderr)
                    sleep(HOURLY_RETRY_WAIT)
                    continue
                raise
        ledger.add(w, f"archive {site.eia_plant_id} {year}")
        spent += w
        df = hourly_frame(body)
        expected = year_days(year) * 24
        if len(df) != expected:
            raise FetchError(f"{site.eia_plant_id} {year}: {len(df)} hours, expected {expected}")
        out = weather_file(cache, site.eia_plant_id, year)
        tmp = out.with_suffix(".tmp")
        df.to_parquet(tmp, index=False)
        tmp.replace(out)
        query = {"eia_plant_id": site.eia_plant_id, "year": year, "weight": w,
                 "grid_latitude": body.get("latitude"), "grid_longitude": body.get("longitude"),
                 "elevation": body.get("elevation"), **params}
        write_manifest(out, len(df), query, config.ARCHIVE_URL, client.log[-1:])
        done += 1
        missing = int(df[list(config.ARCHIVE_VARS)].isna().any(axis=1).sum())
        print(f"[{done}/{len(tasks)}] {site.eia_plant_id} {year}: {len(df)} hours"
              f"{f', {missing} with gaps' if missing else ''}  (spent {spent:,.0f})", flush=True)
    print(f"finished: {done} files, {spent:,.0f} weighted calls")
    return 0


def status(args, clock: Callable) -> int:
    cache: Path = args.cache_dir
    sites = load_sites()
    ledger = Ledger(cache / "ledger.jsonl", clock=clock)
    print(f"{'year':<6}{'plants':>8}{'missing calls':>15}")
    remaining = 0.0
    for y in sorted(args.years, reverse=True):
        have = sum(weather_file(cache, s.eia_plant_id, y).exists() for s in sites)
        miss = (len(sites) - have) * task_weight(y)
        remaining += miss
        print(f"{y:<6}{have:>5}/{len(sites):<2}{miss:>15,.0f}")
    used_h, used_d = ledger.used_since(3600), ledger.used_since(86400)
    print(f"to download: {remaining:,.0f} weighted calls")
    print(f"used by this project: {used_h:,.0f} in the last hour, {used_d:,.0f} in the last 24 hours")
    print(f"left today (if nobody else on this address used any): {max(0, config.DAILY_LIMIT - used_d):,.0f}")
    return 0


def main(argv: list[str] | None = None, client: Client | None = None, sleep: Callable = time.sleep,
         clock: Callable = time.time) -> int:
    ap = argparse.ArgumentParser(description="Download Open-Meteo ERA5 weather for the 60 plants")
    ap.add_argument("--cache-dir", type=Path, default=paths.WEATHER, dest="cache_dir")
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run", help="download missing plant-years, newest first")
    r.add_argument("--budget", type=float, default=config.DAY1_BUDGET, help="weighted calls for this run")
    r.add_argument("--years", type=int, nargs="+", default=list(config.YEARS))
    r.add_argument("--plants", nargs="+", help="EIA plant ids (default: all 60)")
    s = sub.add_parser("status", help="coverage and calls used")
    s.add_argument("--years", type=int, nargs="+", default=list(config.YEARS))
    args = ap.parse_args(argv)
    try:
        if args.cmd == "status":
            return status(args, clock)
        return run(args, client or Client(sleep=sleep), sleep, clock)
    except BlockedError as exc:
        print(f"BLOCKED (policy denial, not retried): {exc}", file=sys.stderr)
        return 2
    except QuotaError as exc:
        print(f"QUOTA: {exc}. Files written so far are kept; run again after the quota resets.",
              file=sys.stderr)
        return 3
    except FetchError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
