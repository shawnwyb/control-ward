#!/usr/bin/env python3
"""Score today ("now") and tomorrow for all 60 plants from the live Open-Meteo forecast, with the
trained Hazard Index. Writes a CSV and an upsert_ml_scores-shaped payload file. Nothing is written
to any database.

Requests (about 220 weighted calls a run):
  forecast  https://api.open-meteo.com/v1/forecast, default model, all plants in one request, the
            core variables plus soil layers, 31 past days (30-day rain, dry days) and 3 forecast days
  soil      https://api.open-meteo.com/v1/ecmwf for soil_moisture_0_to_7cm and _7_to_28cm, the layers
            the ERA5 training data has. If it fails, 0-7 cm is estimated from the default model's
            layers as (s01 + 2*s13 + 4*s39) / 7 and 7-28 cm from s927; `soil_source` says which.
The raw responses are saved under cache/dryrun_raw/, so --from-raw can score them again offline.

Days: `now` is today's local date at the plant and `tomorrow` the next local date (the windows
evaluate_site uses). A horizon with fewer than 20 hours of data is skipped with a warning.
`forecast_hours` is the number of target-day hours that are forecast rather than observed.

Usage
  python dryrun.py
  python dryrun.py --site-map site_ids.csv          # payload with site_id (CSV columns: id,eia_plant_id)
  python dryrun.py --from-raw 20261017T220000Z      # rescore saved responses, no network
  python dryrun.py --date 2026-10-18                # 18 Oct as `now`, 19 Oct as `tomorrow` for every plant
  python dryrun.py --replay 2024-08-14 --plants 56407   # a past day from the ERA5 archive cache, no network

Exit codes: 0 ok, 1 error, 2 blocked by network policy, 3 API quota used up.
"""
from __future__ import annotations

import argparse
import csv
import json
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import pandas as pd

from hazidx import config, localtime, model, paths, rules, tiermap
from hazidx.features import add_anomalies, daily_features, hourly_from_json
from hazidx.http import BlockedError, Client, FetchError, Ledger, QuotaError, openmeteo_weight
from hazidx.sites import load_sites
from train import load_bundle

CORE = ("temperature_2m", "relative_humidity_2m", "wind_speed_10m", "wind_gusts_10m", "shortwave_radiation",
        "precipitation", "pressure_msl")
LAYERS = ("soil_moisture_0_to_1cm", "soil_moisture_1_to_3cm", "soil_moisture_3_to_9cm", "soil_moisture_9_to_27cm")
SOIL = ("soil_moisture_0_to_7cm", "soil_moisture_7_to_28cm")
PAST_DAYS, FORECAST_DAYS, SOIL_PAST_DAYS = 31, 3, 2
RAW_DIR = paths.CACHE / "dryrun_raw"
CSV_COLUMNS = ("eia_plant_id", "horizon", "score", "model_version", "site_name", "timezone", "local_date",
               "top_driver", "r_raw", "p_heat", "p_storm", "p_flood", "p_fire", "wbgt_max_f", "hi_max_f",
               "gust_max_mph", "rain_24h_mm", "rain_prev7d_mm", "sm07_mean", "rule_max_fc", "risk_preview",
               "soil_source", "forecast_hours", "drift_flags", "forecast_model", "run_at_utc")


def _coords(sites) -> dict:
    return {"latitude": ",".join(f"{s.latitude:.4f}" for s in sites),
            "longitude": ",".join(f"{s.longitude:.4f}" for s in sites)}


def forecast_params(sites) -> dict:
    return {**_coords(sites), "hourly": ",".join(CORE + LAYERS), "past_days": PAST_DAYS,
            "forecast_days": FORECAST_DAYS, "timezone": "UTC", **config.UNITS}


def soil_params(sites) -> dict:
    return {**_coords(sites), "hourly": ",".join(SOIL), "past_days": SOIL_PAST_DAYS,
            "forecast_days": FORECAST_DAYS, "timezone": "UTC"}


def as_list(body) -> list[dict]:
    return body if isinstance(body, list) else [body]


def fetch(client: Client, sites, ledger: Ledger) -> tuple[list[dict], list[dict] | None, list[str]]:
    notes = []
    body = client.get_json(config.FORECAST_URL, forecast_params(sites))
    w = openmeteo_weight(len(sites), len(CORE) + len(LAYERS), PAST_DAYS + FORECAST_DAYS)
    ledger.add(w, "dryrun forecast")
    notes.append(f"forecast best_match: {len(sites)} sites, {w:.0f} weighted calls")
    try:
        soil = client.get_json(config.ECMWF_URL, soil_params(sites))
        ws = openmeteo_weight(len(sites), len(SOIL), SOIL_PAST_DAYS + FORECAST_DAYS)
        ledger.add(ws, "dryrun soil")
        notes.append(f"soil ecmwf_ifs: {len(sites)} sites, {ws:.0f} weighted calls")
        soil_list = as_list(soil)
    except (FetchError, QuotaError) as exc:
        notes.append(f"soil request failed ({exc}); using the default model's layers")
        soil_list = None
    return as_list(body), soil_list, notes


def plant_hourly(loc: dict, soil_loc: dict | None) -> tuple[pd.DataFrame, str]:
    h = hourly_from_json(loc, CORE + LAYERS)
    source = "best_match_layers"
    if soil_loc is not None:
        s = hourly_from_json(soil_loc, SOIL)
        if s[list(SOIL)].notna().any().all():
            h = h.merge(s, on="time", how="left")
            source = "ecmwf_ifs"
    if source != "ecmwf_ifs":
        h["soil_moisture_0_to_7cm"] = (h["soil_moisture_0_to_1cm"] + 2 * h["soil_moisture_1_to_3cm"]
                                       + 4 * h["soil_moisture_3_to_9cm"]) / 7
        h["soil_moisture_7_to_28cm"] = h["soil_moisture_9_to_27cm"]
    return h, source


def score_rows(daily: pd.DataFrame, bundle: dict, weights: dict) -> pd.DataFrame:
    """Calibrated family probabilities, R, top driver and 0-10 score for daily feature rows."""
    out = pd.DataFrame(index=daily.index)
    probs = {}
    for fam in config.FAMILIES:
        fm: model.FamilyModel = bundle["families"][fam]["full"]
        probs[fam] = fm.predict(daily[fm.features].to_numpy(float))
        out[f"p_{fam}"] = probs[fam]
    r, top = model.combine(probs, weights)
    out["r_raw"] = r
    out["top_driver"] = top
    out["score"] = tiermap.apply(r, bundle["tier_map"])
    return out


def drift_flags(row: pd.Series, drift: dict) -> str:
    flags = []
    for feat, (lo, hi) in drift.items():
        v = row.get(feat)
        if v is None or pd.isna(v):
            continue
        if v < lo:
            flags.append(f"{feat}<p{config.DRIFT_PCT[0]:g}")
        elif v > hi:
            flags.append(f"{feat}>p{config.DRIFT_PCT[1]:g}")
    return ";".join(flags)


def rule_max_fc(row: pd.Series, site) -> float:
    """Highest of the rules the live engine can compute from Open-Meteo alone (heat, gust, rain, soil)."""
    rain = np.nanmax([row.get("rain_overnight", np.nan), row.get("rain_trail24_max", np.nan), -1.0])
    vals = [rules.heat_score(row.get("wbgt_max"), row.get("hi_max")), rules.weather_score(0, row.get("gust_max")),
            rules.flood_score(None if rain < 0 else float(rain), zone=site.fema_flood_zone, river_m=site.river_distance_m),
            rules.soil_score(row.get("s01_max"))]
    return float(tiermap.round_tenth([min(10.0, max(vals))])[0])


def forecast_hours(day: str, tz: str, now_ms: int | None) -> int:
    start, end = localtime.day_bounds(day, tz)
    hours = list(range(start, end, 3_600_000))
    if now_ms is None:
        return 0
    return sum(1 for t in hours if t >= now_ms)


def build_rows(sites, hourly_by_site: dict, soil_source: dict, now_ms: int | None, days_for, bundle, version,
               forecast_model: str, run_at: str, warn=print) -> list[dict]:
    rows = []
    for s in sites:
        h = hourly_by_site.get(s.eia_plant_id)
        if h is None:
            warn(f"warning: no data for {s.eia_plant_id}")
            continue
        d = daily_features(h, s.timezone)
        d = add_anomalies(d, bundle["normals"].get(s.eia_plant_id, {}))
        for horizon, day in days_for(s):
            key = pd.Timestamp(day)
            if key not in d.index or d.loc[key, "n_hours"] < config.MIN_DAY_HOURS:
                n = 0 if key not in d.index else int(d.loc[key, "n_hours"])
                warn(f"warning: {s.eia_plant_id} {horizon} {day}: {n} hours of data, skipped")
                continue
            feat = d.loc[[key]]
            sc = score_rows(feat, bundle, bundle["weights"]).iloc[0]
            row = feat.iloc[0]
            rmax = rule_max_fc(row, s)
            rows.append({
                "eia_plant_id": s.eia_plant_id, "horizon": horizon, "score": float(sc["score"]), "model_version": version,
                "site_name": s.name, "timezone": s.timezone, "local_date": day, "top_driver": sc["top_driver"],
                "r_raw": round(float(sc["r_raw"]), 4),
                **{f"p_{f}": round(float(sc[f"p_{f}"]), 4) for f in config.FAMILIES},
                "wbgt_max_f": _r(row["wbgt_max"]), "hi_max_f": _r(row["hi_max"]), "gust_max_mph": _r(row["gust_max"]),
                "rain_24h_mm": _r(row["rain_24h"]), "rain_prev7d_mm": _r(row["rain_prev7d"]),
                "sm07_mean": _r(row["sm07_mean"], 3), "rule_max_fc": rmax,
                "risk_preview": max(float(sc["score"]), rmax), "soil_source": soil_source.get(s.eia_plant_id, ""),
                "forecast_hours": forecast_hours(day, s.timezone, now_ms), "drift_flags": drift_flags(row, bundle["drift"]),
                "forecast_model": forecast_model, "run_at_utc": run_at,
            })
    return rows


def _r(v, d=1):
    return None if v is None or pd.isna(v) else round(float(v), d)


def write_outputs(rows: list[dict], stem: str, site_map: dict | None, out_dir: Path = paths.DRYRUN) -> tuple[Path, Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    out = out_dir / f"{stem}.csv"
    with open(out, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=CSV_COLUMNS)
        w.writeheader()
        for r in rows:
            w.writerow({k: ("" if r[k] is None else r[k]) for k in CSV_COLUMNS})
    payload = []
    for r in rows:
        ident = {"site_id": site_map[r["eia_plant_id"]]} if site_map else {"eia_plant_id": r["eia_plant_id"]}
        payload.append({**ident, "horizon": r["horizon"], "score": r["score"], "model_version": r["model_version"]})
    pf = out_dir / f"{stem}.payload.json"
    pf.write_text("[\n" + ",\n".join("  " + json.dumps(p) for p in payload) + "\n]\n")
    return out, pf


def read_site_map(path: Path) -> dict:
    with open(path, newline="", encoding="utf-8") as f:
        return {r["eia_plant_id"].strip(): r["id"].strip() for r in csv.DictReader(f)}


def replay_hourly(eia: str, day: date) -> pd.DataFrame | None:
    files = [paths.WEATHER / f"{eia}_{y}.parquet" for y in sorted({(day - timedelta(days=40)).year, day.year,
                                                                   (day + timedelta(days=2)).year})]
    if not all(f.exists() for f in files):
        return None
    h = pd.concat([pd.read_parquet(f) for f in files], ignore_index=True)
    return h


def main(argv: list[str] | None = None, client: Client | None = None, now: datetime | None = None,
         bundle: dict | None = None) -> int:
    ap = argparse.ArgumentParser(description="Live Hazard Index scores for today and tomorrow (no database writes)")
    ap.add_argument("--model-version", dest="version")
    ap.add_argument("--site-map", type=Path, help="CSV with id,eia_plant_id; the payload then uses site_id")
    ap.add_argument("--from-raw", dest="from_raw", help="stamp of saved responses in cache/dryrun_raw/")
    ap.add_argument("--replay", help="YYYY-MM-DD: score that day and the next from the ERA5 archive cache")
    ap.add_argument("--plants", nargs="+", help="EIA plant ids (default: all 60)")
    ap.add_argument("--date", type=date.fromisoformat,
                    help="YYYY-MM-DD: score this date as `now` and the next as `tomorrow` for every plant, "
                         "instead of each plant's local today (live and --from-raw runs)")
    ap.add_argument("--out-dir", type=Path, default=paths.DRYRUN, dest="out_dir")
    ap.add_argument("--raw-dir", type=Path, default=RAW_DIR, dest="raw_dir")
    ap.add_argument("--ledger", type=Path, default=paths.WEATHER_LEDGER)
    args = ap.parse_args(argv)
    try:
        bundle, version = (bundle, args.version or "test") if bundle is not None else load_bundle(args.version)
        sites = load_sites()
        if args.plants:
            sites = [s for s in sites if s.eia_plant_id in set(args.plants)]
        site_map = read_site_map(args.site_map) if args.site_map else None
        run_at_dt = now or datetime.now(timezone.utc)
        run_at = run_at_dt.strftime("%Y-%m-%dT%H:%M:%SZ")
        print(f"model {version}   run {run_at}")
        if args.replay:
            day = date.fromisoformat(args.replay)
            hourly = {s.eia_plant_id: replay_hourly(s.eia_plant_id, day) for s in sites}
            hourly = {k: v for k, v in hourly.items() if v is not None}
            soil = {k: "era5_archive" for k in hourly}
            days_for = lambda s: [("now", day.isoformat()), ("tomorrow", (day + timedelta(days=1)).isoformat())]
            rows = build_rows(sites, hourly, soil, None, days_for, bundle, version, config.ARCHIVE_MODEL, run_at)
            stem = f"replay_{day:%Y%m%d}" + (f"_{'-'.join(args.plants)}" if args.plants else "")
        else:
            if args.from_raw:
                stamp = args.from_raw
                raw = json.loads((args.raw_dir / f"{stamp}.json").read_text())
                body, soil_list = raw["forecast"], raw["soil"]
                now_ms = int(datetime.strptime(stamp, "%Y%m%dT%H%M%SZ").replace(tzinfo=timezone.utc).timestamp() * 1000)
                run_at = datetime.fromtimestamp(now_ms / 1000, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
                print(f"rescoring saved responses {stamp}")
            else:
                stamp = run_at_dt.strftime("%Y%m%dT%H%M%SZ")
                now_ms = int(run_at_dt.timestamp() * 1000)
                c = client or Client()
                body, soil_list, notes = fetch(c, sites, Ledger(args.ledger))
                print("   ".join(notes))
                args.raw_dir.mkdir(parents=True, exist_ok=True)
                (args.raw_dir / f"{stamp}.json").write_text(json.dumps({"run_at": run_at, "forecast": body, "soil": soil_list}))
            if len(body) != len(sites):
                raise FetchError(f"forecast returned {len(body)} locations for {len(sites)} sites")
            hourly, soil = {}, {}
            for i, s in enumerate(sites):
                h, src = plant_hourly(body[i], soil_list[i] if soil_list and i < len(soil_list) else None)
                hourly[s.eia_plant_id], soil[s.eia_plant_id] = h, src
            def days_for(s):
                today = args.date.isoformat() if args.date else localtime.local_date(now_ms, s.timezone)
                return [("now", today), ("tomorrow", localtime.add_days(today, 1))]
            rows = build_rows(sites, hourly, soil, now_ms, days_for, bundle, version, "best_match", run_at)
            stem = f"ml_scores_{stamp}" + (f"_for{args.date:%Y%m%d}" if args.date else "")
        out, pf = write_outputs(rows, stem, site_map, args.out_dir)
        print(f"wrote {out} ({len(rows)} rows)")
        print(f"wrote {pf} ({len(rows)} rows)")
        return 0
    except BlockedError as exc:
        print(f"BLOCKED (policy denial, not retried): {exc}", file=sys.stderr)
        return 2
    except QuotaError as exc:
        print(f"QUOTA: {exc}", file=sys.stderr)
        return 3
    except (FetchError, FileNotFoundError, KeyError, ValueError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
