#!/usr/bin/env python3
"""Build one row per plant per local day: weather features, Storm Events labels for the four
families, and the rule subscores recomputed from the same weather.

Inputs:  cache/weather/*.parquet (fetch_weather.py), cache/storm_events/ (fetch_storms.py),
         artifacts/sites_nws.json (fetch_sites.py)
Outputs: cache/dataset/site_days.parquet, cache/dataset/events_matched.parquet,
         artifacts/labels_report.json (check it before training)

Rule columns (from the archive, so only the rules that weather alone can drive):
  rule_heat   heat_score(daily max WBGT, daily max heat index)
  rule_wx     weather_score(0, daily max gust)
  rule_flood  flood_score(max(overnight rain, largest trailing 24-hour rain of the day)) with the
              plant's FEMA-zone and river-distance multipliers
  rule_soil   soil_score(daily max 0-7 cm soil moisture); live uses the 0-1 cm layer
  rule_max    max(rule_heat, rule_wx, rule_flood) rounded to 0.5 (input of the 0-10 map; soil is
              not one of the four families)

Usage
  python build_dataset.py
Exit codes: 0 ok, 1 error.
"""
from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict

import numpy as np
import pandas as pd

from fetch_storms import storm_files
from hazidx import config, labels, paths, rules
from hazidx.features import daily_features
from hazidx.http import utc_now_iso, write_manifest
from hazidx.sites import load_sites

PLAN_ESTIMATES = {"storm": (0.01, 0.015), "heat": (0.005, 0.02), "flood": (0.005, 0.01), "fire": (0.001, 0.003)}


def plant_weather(eia: str) -> tuple[pd.DataFrame | None, list[int]]:
    files = sorted(paths.WEATHER.glob(f"{eia}_*.parquet"))
    years = sorted(int(f.stem.split("_")[1]) for f in files)
    if not files:
        return None, []
    return pd.concat([pd.read_parquet(f) for f in files], ignore_index=True), years


def add_rules(d: pd.DataFrame, site) -> pd.DataFrame:
    d["rule_heat"] = rules.heat_score_np(d["wbgt_max"], d["hi_max"])
    d["rule_wx"] = rules.weather_score_np(d["gust_max"])
    rain = np.fmax(d["rain_overnight"].to_numpy(float), d["rain_trail24_max"].to_numpy(float))
    d["rule_flood"] = rules.flood_rain_score_np(rain, site.fema_flood_zone, site.river_distance_m)
    d["rule_soil"] = rules.soil_score_np(d["sm07_max"])
    d["rule_max"] = rules.round_half_np(np.maximum.reduce([d["rule_heat"], d["rule_wx"], d["rule_flood"]]))
    return d


def build(verbose: bool = True) -> tuple[pd.DataFrame, pd.DataFrame, dict]:
    sites = load_sites()
    nws = json.loads(paths.SITES_NWS.read_text())["sites"]
    files = storm_files()
    if not files:
        raise RuntimeError("no Storm Events files; run fetch_storms.py")
    ev = labels.read_events(list(files.values()))
    if verbose:
        print(f"Storm Events: {len(ev):,} family events from {min(files)}-{max(files)}")
    rows, matched_all, label_only = [], [], []
    for s in sites:
        m = labels.match_events(ev, s, nws[s.eia_plant_id])
        days = labels.event_days(m, s.timezone)
        lab = labels.daily_labels(days)
        m = m.assign(eia_plant_id=s.eia_plant_id)
        matched_all.append(m[["eia_plant_id", "EVENT_ID", "EPISODE_ID", "EVENT_TYPE", "family", "method", "CZ_TYPE",
                              "CZ_FIPS", "CZ_NAME", "YEAR", "begin_utc", "end_utc"]])
        label_only.append(days.assign(eia_plant_id=s.eia_plant_id))
        hourly, years = plant_weather(s.eia_plant_id)
        if hourly is None:
            continue
        d = daily_features(hourly, s.timezone)
        d = d[(d["n_hours"] >= config.MIN_DAY_HOURS) & d.index.year.isin(years)]
        d = d.join(lab, how="left")
        for f in config.FAMILIES:
            d[f"y_{f}"] = d[f"y_{f}"].fillna(0).astype("int8")
        d["y_any"] = d[[f"y_{f}" for f in config.FAMILIES]].max(axis=1).astype("int8")
        d = add_rules(d, s)
        d["eia_plant_id"] = s.eia_plant_id
        d["year"] = d.index.year.astype("int16")
        d["month"] = d.index.month.astype("int8")
        rows.append(d.reset_index())
        if verbose:
            print(f"{s.eia_plant_id:>6} {s.name[:28]:<28} years {years[0]}-{years[-1]} ({len(years)})  days {len(d):>5}  "
                  + "  ".join(f"{f} {d[f'y_{f}'].mean():.3%}" for f in config.FAMILIES))
    if not rows:
        raise RuntimeError("no weather files; run fetch_weather.py")
    data = pd.concat(rows, ignore_index=True)
    matched = pd.concat(matched_all, ignore_index=True)
    days_all = pd.concat(label_only, ignore_index=True)
    return data, matched, report(data, matched, days_all, sites)


def report(data: pd.DataFrame, matched: pd.DataFrame, days_all: pd.DataFrame, sites) -> dict:
    fams = list(config.FAMILIES)
    ycols = [f"y_{f}" for f in fams]
    years = sorted(data["year"].unique().tolist())
    share = data[ycols].mean()
    by_year = data.groupby("year")[ycols].mean()
    by_plant = data.groupby("eia_plant_id")[ycols].mean()
    by_plant_year = data.groupby(["eia_plant_id", "year"])[ycols].mean()
    event_days_by_year = data.groupby("year")[ycols].sum()
    missing = [{"family": f, "year": int(y)} for f in fams for y in years if event_days_by_year.loc[y, f"y_{f}"] == 0]
    zone = matched[matched["method"].isin(["zone_code", "zone_name"])]
    zone_by_year = zone.groupby(["YEAR", "method"]).size().unstack(fill_value=0)
    zone_plant_year = zone.groupby(["eia_plant_id", "YEAR", "method"]).size().unstack(fill_value=0)
    suspects = []
    if "zone_code" in zone_plant_year:
        for eia, g in zone_plant_year.groupby(level=0):
            g = g.droplevel(0)
            code = g.get("zone_code", pd.Series(0, index=g.index))
            for y in range(int(min(config.YEARS)), int(max(config.YEARS)) + 1):
                if code.get(y, 0) == 0 and code.sum() > 0 and g.get("zone_name", pd.Series(dtype=int)).get(y, 0) > 0:
                    suspects.append({"eia_plant_id": eia, "year": y})
    label_days_all = (days_all.drop_duplicates(["eia_plant_id", "date", "family"])
                      .assign(year=lambda x: x["date"].dt.year).groupby(["family", "year"]).size().unstack(fill_value=0))
    names = {s.eia_plant_id: s.name for s in sites}
    return {
        "generated_at": utc_now_iso(),
        "rows": int(len(data)), "plants": int(data["eia_plant_id"].nunique()), "years": [int(y) for y in years],
        "plants_per_year": {int(y): int(n) for y, n in data.groupby("year")["eia_plant_id"].nunique().items()},
        "share_of_days": {f: round(float(share[f"y_{f}"]), 5) for f in fams},
        "share_any": round(float(data["y_any"].mean()), 5),
        "plan_estimate": {f: list(PLAN_ESTIMATES[f]) for f in fams},
        "share_by_year": {f: {int(y): round(float(v), 5) for y, v in by_year[f"y_{f}"].items()} for f in fams},
        "share_by_plant": {eia: {"name": names.get(eia), **{f: round(float(r[f"y_{f}"]), 5) for f in fams}}
                           for eia, r in by_plant.iterrows()},
        "share_by_plant_year": {f"{eia}/{y}": {f: round(float(r[f"y_{f}"]), 5) for f in fams}
                                for (eia, y), r in by_plant_year.iterrows()},
        "event_days_by_year": {f: {int(y): int(v) for y, v in event_days_by_year[f"y_{f}"].items()} for f in fams},
        "every_family_every_year": not missing, "missing_family_years": missing,
        "matches_by_method": {f: {k: int(v) for k, v in g["method"].value_counts().items()}
                              for f, g in matched.groupby("family")},
        "zone_matches_by_year": {int(y): {k: int(v) for k, v in r.items()} for y, r in zone_by_year.iterrows()},
        "zone_code_dropouts": suspects,
        "label_days_all_years": {f: {int(y): int(v) for y, v in r.items()} for f, r in label_days_all.iterrows()},
        "rule_max_distribution": {str(k): int(v) for k, v in data["rule_max"].value_counts().sort_index().items()},
    }


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Build site_days.parquet and labels_report.json")
    ap.parse_args(argv)
    try:
        paths.ensure(paths.DATASET, paths.ARTIFACTS)
        data, matched, rep = build()
        data.to_parquet(paths.SITE_DAYS, index=False)
        write_manifest(paths.SITE_DAYS, len(data), {"years": rep["years"]}, "local", [])
        matched.to_parquet(paths.EVENTS_MATCHED, index=False)
        paths.LABELS_REPORT.write_text(json.dumps(rep, indent=1))
        print(f"wrote {paths.SITE_DAYS} ({len(data):,} rows, {rep['plants']} plants, years {rep['years']})")
        print("share of plant-days with an event: " + ", ".join(f"{f} {v:.3%}" for f, v in rep["share_of_days"].items()))
        print(f"every family has events in every year: {rep['every_family_every_year']}"
              + ("" if rep["every_family_every_year"] else f"  missing {rep['missing_family_years']}"))
        print(f"wrote {paths.LABELS_REPORT}")
        return 0
    except (RuntimeError, FileNotFoundError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
