#!/usr/bin/env python3
"""Train the Hazard Index: one calibrated model per hazard family, a past-data-only twin of each,
the 0-10 map, and baseline columns for evaluate.py.

Year roles (each period has one job):
  training years  every year in the data up to TRAIN_LAST_YEAR: models, calibrators, 0-10 map
  SELECT_YEAR     choosing the tree settings by log-loss; nothing is fitted on it
  TEST_YEARS      final test metrics only (evaluate.py)

Per family: pick settings on SELECT_YEAR (trees only), get one out-of-fold prediction for every
training day with GroupKFold by year, fit a Platt calibrator on those, then train the final model on
all training years. The calibrated out-of-fold predictions also feed the 0-10 map.

Inputs:  cache/dataset/site_days.parquet, artifacts/severity.json
Outputs: artifacts/models/<model_version>/ bundle.joblib, metadata.json, tier_map.json,
         predictions.parquet; artifacts/models/latest.json

Usage
  python train.py
Exit codes: 0 ok, 1 error.
"""
from __future__ import annotations

import argparse
import json
import shutil
import sys
import time

import joblib
import numpy as np
import pandas as pd
import sklearn

from hazidx import __version__, config, model, paths, tiermap
from hazidx.features import add_anomalies, monthly_normals
from hazidx.http import sha256_file, utc_now_iso

WEATHER_KEEP = ("wbgt_max", "hi_max", "t_max", "gust_max", "rain_24h", "rain_overnight", "rain_prev7d", "sm07_mean",
                "vpd_max", "dry_days")


def load_weights() -> dict[str, float]:
    sev = json.loads(paths.SEVERITY.read_text())
    return {f: float(v["weight_s"]) for f, v in sev["families"].items()}


def with_anomalies(data: pd.DataFrame, train_years: list[int]) -> tuple[pd.DataFrame, dict]:
    """t_max_anom and hi_max_anom against each plant's monthly normals from the training years only."""
    parts, normals = [], {}
    for eia, g in data.groupby("eia_plant_id", sort=False):
        g = g.set_index("date")
        n = monthly_normals(g[g["year"].isin(train_years)])
        normals[eia] = n
        parts.append(add_anomalies(g, n).reset_index())
    return pd.concat(parts, ignore_index=True), normals


def climatology(train: pd.DataFrame, rows: pd.DataFrame, family: str) -> np.ndarray:
    """Plant-month event rate from the training years, smoothed toward the family's monthly rate."""
    y = f"y_{family}"
    fam_month = train.groupby("month")[y].mean()
    pm = train.groupby(["eia_plant_id", "month"])[y].agg(["sum", "count"])
    a = config.CLIM_PSEUDO_DAYS
    key = pd.MultiIndex.from_arrays([rows["eia_plant_id"], rows["month"]])
    s = pm["sum"].reindex(key).fillna(0).to_numpy()
    n = pm["count"].reindex(key).fillna(0).to_numpy()
    prior = fam_month.reindex(rows["month"]).fillna(train[y].mean()).to_numpy()
    return (s + a * prior) / (n + a)


def train(data: pd.DataFrame, weights: dict[str, float], log=print) -> tuple[dict, pd.DataFrame, dict]:
    years = sorted(int(y) for y in data["year"].unique())
    train_years = [y for y in years if y <= config.TRAIN_LAST_YEAR]
    if len(train_years) < 2:
        raise RuntimeError(f"need at least 2 training years up to {config.TRAIN_LAST_YEAR}, have {train_years}")
    if config.SELECT_YEAR not in years:
        raise RuntimeError(f"model-selection year {config.SELECT_YEAR} is missing")
    data, normals = with_anomalies(data, train_years)
    data = data.sort_values(["eia_plant_id", "date"]).reset_index(drop=True)
    tr = data["year"].isin(train_years).to_numpy()
    sel = (data["year"] == config.SELECT_YEAR).to_numpy()
    grid = model.settings_grid(len(train_years))
    out = data[["eia_plant_id", "date", "year", "month"] + [f"y_{f}" for f in config.FAMILIES] + ["y_any"]
               + ["rule_heat", "rule_wx", "rule_flood", "rule_soil", "rule_max"] + list(WEATHER_KEEP)].copy()
    out["split"] = np.where(tr, "train_oof", np.where(sel, "select", np.where(data["year"].isin(config.TEST_YEARS), "test", "other")))
    families, meta_fam = {}, {}
    oof_cal = {}
    for fam in config.FAMILIES:
        t0 = time.time()
        y_all = data[f"y_{fam}"].to_numpy().astype(int)
        entry, meta = {}, {"positives_train": int(y_all[tr].sum()), "positives_select": int(y_all[sel].sum())}
        params, selection = None, []
        for variant, past_only in (("full", False), ("past_only", True)):
            feats = model.features_for(fam, past_only)
            X = data[feats].to_numpy(float)
            if variant == "full" and fam != "fire":
                best = None
                for p in grid:
                    est = model.make_estimator(fam, feats, p).fit(X[tr], y_all[tr])
                    ll = model.log_loss(y_all[sel], model.raw_proba(est, X[sel]))
                    selection.append({**p, "log_loss_select": ll})
                    if best is None or ll < best[0]:
                        best = (ll, p)
                params = best[1]
            raw_oof = model.oof_raw(fam, feats, params, X[tr], y_all[tr], data.loc[tr, "year"].to_numpy())
            platt = model.Platt.fit(raw_oof, y_all[tr])
            est = model.make_estimator(fam, feats, params).fit(X[tr], y_all[tr])
            fm = model.FamilyModel(fam, feats, params, est, platt)
            entry[variant] = fm
            p_all = fm.predict(X)
            p_all[tr] = platt(raw_oof)          # training rows carry their out-of-fold prediction
            out[("p_" if variant == "full" else "pp_") + fam] = p_all
            if variant == "full":
                oof_cal[fam] = p_all[tr]
        out[f"clim_{fam}"] = climatology(data[tr], data, fam)
        families[fam] = entry
        meta["params"] = params
        meta["selection"] = selection
        meta["platt"] = {v: {"a": entry[v].platt.a, "b": entry[v].platt.b} for v in entry}
        meta["features"] = {v: entry[v].features for v in entry}
        meta_fam[fam] = meta
        log(f"{fam:<6} positives train {meta['positives_train']:>5}  select {meta['positives_select']:>4}  "
            f"settings {params}  ({time.time() - t0:.1f}s)")
    r_oof, _ = model.combine(oof_cal, weights)
    tmap = tiermap.fit(r_oof, data.loc[tr, "rule_max"].to_numpy())
    r_all, top = model.combine({f: out[f"p_{f}"].to_numpy() for f in config.FAMILIES}, weights)
    out["R"] = r_all
    out["top_driver"] = top
    out["score"] = tiermap.apply(r_all, tmap)
    feats_used = sorted({f for fam in config.FAMILIES for f in model.features_for(fam)})
    drift = {f: [float(np.nanpercentile(data.loc[tr, f], config.DRIFT_PCT[0])),
                 float(np.nanpercentile(data.loc[tr, f], config.DRIFT_PCT[1]))] for f in feats_used}
    bundle = {"families": families, "weights": weights, "tier_map": tmap, "normals": normals, "drift": drift,
              "feature_timing": dict(config.FEATURE_TIMING), "train_years": train_years, "package_version": __version__}
    metadata = {
        "created_at": utc_now_iso(), "package_version": __version__, "sklearn": sklearn.__version__,
        "rows": int(len(data)), "plants": int(data["eia_plant_id"].nunique()),
        "years": {"train": train_years, "model_selection": [config.SELECT_YEAR],
                  "test": [y for y in config.TEST_YEARS if y in years],
                  "calibration": f"Platt, out-of-fold, GroupKFold by year, {min(config.MAX_FOLDS, len(train_years))} folds",
                  "tier_map": "out-of-fold predictions, training years",
                  "normals_and_drift": "training years"},
        "calibration_rows_years": sorted(int(y) for y in data.loc[tr, "year"].unique()),
        "tier_map_rows_years": sorted(int(y) for y in data.loc[tr, "year"].unique()),
        "grid": "V2" if len(train_years) >= config.V2_MIN_TRAIN_YEARS else "V1",
        "weights": weights, "families": meta_fam, "tier_map": tmap,
        "plants_per_train_year": {int(y): int(n) for y, n in data[tr].groupby("year")["eia_plant_id"].nunique().items()},
    }
    return bundle, out, metadata


def save(bundle: dict, preds: pd.DataFrame, metadata: dict) -> str:
    tmp = paths.MODELS / "_building"
    if tmp.exists():
        shutil.rmtree(tmp)
    tmp.mkdir(parents=True)
    joblib.dump(bundle, tmp / "bundle.joblib", compress=3)
    ty = bundle["train_years"]
    version = f"{config.MODEL_NAME}-{__version__}+{ty[0]}-{ty[-1]}.{sha256_file(tmp / 'bundle.joblib')[:8]}"
    metadata = {"model_version": version, **metadata}
    (tmp / "metadata.json").write_text(json.dumps(metadata, indent=1, default=float))
    (tmp / "tier_map.json").write_text(json.dumps(bundle["tier_map"], indent=1))
    preds.to_parquet(tmp / "predictions.parquet", index=False)
    final = paths.MODELS / version
    if final.exists():
        shutil.rmtree(final)
    tmp.rename(final)
    (paths.MODELS / "latest.json").write_text(json.dumps({"model_version": version}, indent=1))
    return version


def load_bundle(version: str | None = None) -> tuple[dict, str]:
    """Load a model this project built (bundle.joblib is a pickle: never load one from elsewhere)."""
    version = version or json.loads((paths.MODELS / "latest.json").read_text())["model_version"]
    return joblib.load(paths.MODELS / version / "bundle.joblib"), version


def main(argv: list[str] | None = None) -> int:
    argparse.ArgumentParser(description="Train the Hazard Index models").parse_args(argv)
    try:
        data = pd.read_parquet(paths.SITE_DAYS)
        weights = load_weights()
        print(f"{len(data):,} plant-days, years {sorted(data['year'].unique().tolist())}; weights {weights}")
        bundle, preds, metadata = train(data, weights)
        version = save(bundle, preds, metadata)
    except (RuntimeError, FileNotFoundError, ValueError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1
    tm = bundle["tier_map"]
    print(f"0-10 map {'(fixed fallback points)' if tm['fallback'] else ''}: "
          + ", ".join(f"R {r:.4f} -> {s:g}" for r, s in tm["points"]))
    if tm["removed"]:
        print(f"  removed non-increasing pairs: {tm['removed']}")
    print(f"wrote {paths.MODELS / version}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
