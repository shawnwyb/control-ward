#!/usr/bin/env python3
"""Test metrics for a trained model (test years only), written next to it as metrics.json plus figures.

Per family (full model, past-data-only model, and the baselines):
  ROC-AUC, PR-AUC (average precision), Brier score, Brier skill score against plant-month
  climatology, a reliability table, 90% ranges from resampling plants, and the forecast-dependent
  share = (full PR-AUC - past-only PR-AUC) / (full PR-AUC - climatology PR-AUC), reported only when
  the full model beats climatology.
For the combined index: ROC-AUC and PR-AUC for "any event" next to the rule maximum, a table of
index tier against rule tier, and escalation precision (days when the index is more than 2 points
above the rule maximum, against other days at the same rule tier).

Usage
  python evaluate.py                    # the model named in artifacts/models/latest.json
  python evaluate.py --model-version hazidx-0.1.0+2020-2022.3f9a1c2e
Exit codes: 0 ok, 1 error.
"""
from __future__ import annotations

import argparse
import json
import sys
import warnings

import numpy as np
import pandas as pd
from sklearn.metrics import average_precision_score, brier_score_loss, roc_auc_score

from hazidx import config, paths, plots, tiermap

RULE_FOR = {"heat": "rule_heat", "storm": "rule_wx", "flood": "rule_flood", "fire": None}


def _auc(y, s):
    return float(roc_auc_score(y, s)) if 0 < y.sum() < len(y) else None


def _ap(y, s):
    return float(average_precision_score(y, s)) if y.sum() > 0 else None


def _bss(y, p, ref):
    b_ref = brier_score_loss(y, ref)
    return float(1 - brier_score_loss(y, p) / b_ref) if b_ref > 0 else None


def reliability(y: np.ndarray, p: np.ndarray, bins: int = 10) -> list[dict]:
    """Quantile bins of the predicted probability (rare events: equal-width bins would be empty)."""
    order = np.argsort(p)
    out = []
    for chunk in np.array_split(order, bins):
        if len(chunk):
            out.append({"p_mean": float(p[chunk].mean()), "observed": float(y[chunk].mean()), "days": int(len(chunk)),
                        "events": int(y[chunk].sum())})
    return out


def bootstrap(df: pd.DataFrame, fn, n: int = config.BOOTSTRAP, seed: int = config.SEED) -> list[float] | None:
    """90% range of fn(df) over resamples of plants (whole plants, with replacement)."""
    rng = np.random.default_rng(seed)
    groups = {k: g.index.to_numpy() for k, g in df.groupby("eia_plant_id")}
    keys = list(groups)
    vals = []
    for _ in range(n):
        idx = np.concatenate([groups[k] for k in rng.choice(keys, len(keys))])
        v = fn(df.loc[idx])
        if v is not None:
            vals.append(v)
    return [float(np.percentile(vals, 5)), float(np.percentile(vals, 95))] if len(vals) >= n // 2 else None


def family_metrics(test: pd.DataFrame, fam: str, base_rate: float, boot: bool = True) -> dict:
    y = test[f"y_{fam}"].to_numpy()
    p, pp, clim = test[f"p_{fam}"].to_numpy(), test[f"pp_{fam}"].to_numpy(), test[f"clim_{fam}"].to_numpy()
    rule_col = RULE_FOR[fam]
    rule = test[rule_col].to_numpy() if rule_col else None
    base = np.full(len(y), base_rate)
    m = {
        "events": int(y.sum()), "days": int(len(y)), "event_rate": float(y.mean()), "train_base_rate": base_rate,
        "roc_auc": {"full": _auc(y, p), "past_only": _auc(y, pp), "climatology": _auc(y, clim),
                    "rule": _auc(y, rule) if rule is not None else None},
        "pr_auc": {"full": _ap(y, p), "past_only": _ap(y, pp), "climatology": _ap(y, clim), "base_rate": float(y.mean()),
                   "rule": _ap(y, rule) if rule is not None else None},
        "brier": {"full": float(brier_score_loss(y, p)), "past_only": float(brier_score_loss(y, pp)),
                  "climatology": float(brier_score_loss(y, clim)), "base_rate": float(brier_score_loss(y, base))},
        "brier_skill": {"full": _bss(y, p, clim), "past_only": _bss(y, pp, clim)},
        "mean_predicted": {"full": float(p.mean()), "past_only": float(pp.mean()), "climatology": float(clim.mean())},
        "reliability": {"full": reliability(y, p), "past_only": reliability(y, pp)},
    }
    full, past, cl = m["pr_auc"]["full"], m["pr_auc"]["past_only"], m["pr_auc"]["climatology"]
    m["forecast_dependent_share"] = (float((full - past) / (full - cl)) if None not in (full, past, cl) and full > cl
                                     else None)
    m["beats_climatology"] = bool(full is not None and cl is not None and full > cl and (m["brier_skill"]["full"] or 0) > 0)
    if boot and y.sum() > 0:
        m["ranges_90"] = {
            "roc_auc_full": bootstrap(test, lambda d: _auc(d[f"y_{fam}"].to_numpy(), d[f"p_{fam}"].to_numpy())),
            "pr_auc_full": bootstrap(test, lambda d: _ap(d[f"y_{fam}"].to_numpy(), d[f"p_{fam}"].to_numpy())),
            "pr_auc_climatology": bootstrap(test, lambda d: _ap(d[f"y_{fam}"].to_numpy(), d[f"clim_{fam}"].to_numpy())),
            "brier_skill_full": bootstrap(test, lambda d: _bss(d[f"y_{fam}"].to_numpy(), d[f"p_{fam}"].to_numpy(),
                                                               d[f"clim_{fam}"].to_numpy())),
        }
    return m


def index_metrics(test: pd.DataFrame) -> dict:
    y = test["y_any"].to_numpy()
    score, rule = test["score"].to_numpy(), test["rule_max"].to_numpy()
    it, rt = tiermap.tier(score), tiermap.tier(rule)
    order = ["none", "watch", "warning", "stop"]
    counts = pd.crosstab(pd.Categorical(it, order), pd.Categorical(rt, order), dropna=False)
    rates = pd.crosstab(pd.Categorical(it, order), pd.Categorical(rt, order), values=y, aggfunc="mean", dropna=False)
    esc = score > rule + config.ESCALATION_POINTS
    same = []
    for t in order:
        n_esc = int((esc & (rt == t)).sum())
        other = (~esc) & (rt == t)
        if n_esc and other.sum():
            same.append((n_esc, float(y[other].mean())))
    same_rate = float(sum(n * r for n, r in same) / sum(n for n, _ in same)) if same else None
    return {
        "roc_auc_any_event": _auc(y, test["R"].to_numpy()), "rule_max_roc_auc_any_event": _auc(y, rule),
        "pr_auc_any_event": _ap(y, test["R"].to_numpy()), "rule_max_pr_auc_any_event": _ap(y, rule),
        "any_event_rate": float(y.mean()),
        "tier_table": {"rows": "index tier", "columns": "rule tier",
                       "days": {r: {c: int(counts.loc[r, c]) for c in order} for r in order},
                       "event_rate": {r: {c: (None if pd.isna(rates.loc[r, c]) else float(rates.loc[r, c])) for c in order}
                                      for r in order}},
        "escalation": {"points": config.ESCALATION_POINTS, "days": int(esc.sum()),
                       "event_rate": float(y[esc].mean()) if esc.any() else None,
                       "same_rule_tier_event_rate": same_rate},
        "score_distribution": {t: int((it == t).sum()) for t in order},
        "top_driver_share": {k: float(v) for k, v in test["top_driver"].value_counts(normalize=True).items()},
    }


def per_plant(test: pd.DataFrame) -> dict:
    out = {}
    for eia, g in test.groupby("eia_plant_id"):
        out[eia] = {f: {"events": int(g[f"y_{f}"].sum()), "observed": float(g[f"y_{f}"].mean()),
                        "predicted": float(g[f"p_{f}"].mean())} for f in config.FAMILIES}
    return out


def figures(test: pd.DataFrame, metrics: dict, tmap: dict, oof: pd.DataFrame, outdir) -> list[str]:
    import matplotlib.pyplot as plt
    plots.style()
    outdir.mkdir(parents=True, exist_ok=True)
    written = []
    # Reliability: one panel per family, full and past-only models against the diagonal.
    fig, axes = plt.subplots(1, 4, figsize=(13, 3.4))
    for ax, fam in zip(axes, config.FAMILIES):
        rel = metrics["families"][fam]["reliability"]
        top = max([b["p_mean"] for v in rel.values() for b in v] + [b["observed"] for v in rel.values() for b in v] + [1e-3])
        ax.plot([0, top], [0, top], color=plots.GRID, linewidth=1)
        for (name, label), color in zip((("full", "full model"), ("past_only", "past-data only")), plots.SERIES):
            b = rel[name]
            ax.plot([x["p_mean"] for x in b], [x["observed"] for x in b], color=color, marker="o", markersize=6,
                    markeredgecolor=plots.SURFACE, markeredgewidth=1.5, label=label)
        ax.set_title(fam)
        ax.set_xlabel("predicted probability")
        if fam == "heat":
            ax.set_ylabel("observed event rate")
    axes[0].legend(loc="upper left")
    fig.suptitle("Reliability on the test years (10 quantile bins)", color=plots.TEXT, fontsize=11, x=0.01, ha="left")
    fig.tight_layout()
    fig.savefig(outdir / "reliability.png")
    plt.close(fig)
    written.append("reliability.png")
    # PR-AUC by family: full, past-only, climatology.
    fig, ax = plt.subplots(figsize=(7, 3.4))
    x = np.arange(len(config.FAMILIES))
    for i, ((key, label), color) in enumerate(zip((("full", "full model"), ("past_only", "past-data only"),
                                                    ("climatology", "climatology")), plots.SERIES)):
        vals = [metrics["families"][f]["pr_auc"][key] or 0 for f in config.FAMILIES]
        ax.bar(x + (i - 1) * 0.26, vals, width=0.24, color=color, label=label)
    ax.set_xticks(x, config.FAMILIES)
    ax.set_ylabel("PR-AUC (test years)")
    ax.legend(loc="upper right")
    ax.set_title("Precision-recall skill by family")
    ax.grid(axis="x", visible=False)
    fig.tight_layout()
    fig.savefig(outdir / "pr_auc.png")
    plt.close(fig)
    written.append("pr_auc.png")
    # The 0-10 map with the (median R, rule level) pairs it was fitted on.
    fig, ax = plt.subplots(figsize=(6, 3.6))
    pts = np.array(tmap["points"])
    grid = np.linspace(0, pts[-1, 0] * 1.15, 400)
    ax.plot(grid, np.interp(grid, pts[:, 0], pts[:, 1]), color=plots.SERIES[0], label="0-10 map (scores round to 0.1)")
    if tmap["pairs"]:
        pr = np.array(tmap["pairs"])
        ax.plot(pr[:, 0], pr[:, 1], linestyle="none", marker="o", markersize=7, color=plots.SERIES[1],
                markeredgecolor=plots.SURFACE, markeredgewidth=1.5, label="median R per rule level (training, out-of-fold)")
    for cut, name in ((3, "watch"), (7.5, "warning"), (10, "stop work")):
        ax.axhline(cut, color=plots.GRID, linewidth=1)
        ax.text(grid[-1], cut + 0.15, name, ha="right", va="bottom", fontsize=8, color=plots.TEXT_2)
    ax.set_xlabel("combined value R = max(s × p)")
    ax.set_ylabel("Hazard Index")
    ax.set_ylim(0, 10.5)
    ax.legend(loc="lower right")
    ax.set_title("0-10 map" + (" (fixed fallback points)" if tmap["fallback"] else ""))
    fig.tight_layout()
    fig.savefig(outdir / "tier_map.png")
    plt.close(fig)
    written.append("tier_map.png")
    return written


def evaluate(version: str, boot: bool = True) -> dict:
    mdir = paths.MODELS / version
    preds = pd.read_parquet(mdir / "predictions.parquet")
    tmap = json.loads((mdir / "tier_map.json").read_text())
    meta = json.loads((mdir / "metadata.json").read_text())
    test = preds[preds["split"] == "test"].reset_index(drop=True)
    oof = preds[preds["split"] == "train_oof"]
    if test.empty:
        raise RuntimeError("no test-year rows in predictions")
    fams = {}
    for fam in config.FAMILIES:
        fams[fam] = family_metrics(test, fam, float(oof[f"y_{fam}"].mean()), boot=boot)
    metrics = {"model_version": version, "years": meta["years"], "test_rows": int(len(test)),
               "test_plants": int(test["eia_plant_id"].nunique()), "weights": meta["weights"],
               "families": fams, "index": index_metrics(test), "per_plant": per_plant(test),
               "acceptance_3": {f: fams[f]["beats_climatology"] for f in config.FAMILIES}}
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        metrics["figures"] = figures(test, metrics, tmap, oof, mdir / "figures")
    (mdir / "metrics.json").write_text(json.dumps(metrics, indent=1))
    return metrics


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Test metrics for a trained Hazard Index model")
    ap.add_argument("--model-version", dest="version")
    ap.add_argument("--no-bootstrap", action="store_true", help="skip the plant resampling ranges")
    args = ap.parse_args(argv)
    try:
        version = args.version or json.loads((paths.MODELS / "latest.json").read_text())["model_version"]
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", category=UserWarning)
            m = evaluate(version, boot=not args.no_bootstrap)
    except (RuntimeError, FileNotFoundError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1
    print(f"model {version}; test years {m['years']['test']}, {m['test_rows']:,} plant-days")
    print(f"{'family':<7}{'events':>7}{'PR full':>9}{'past':>7}{'clim':>7}{'rule':>7}{'ROC full':>10}{'BSS full':>10}{'BSS past':>10}{'fc share':>10}")
    fmt = lambda v, d=3: "   -" if v is None else f"{v:.{d}f}"
    for f, v in m["families"].items():
        print(f"{f:<7}{v['events']:>7}{fmt(v['pr_auc']['full']):>9}{fmt(v['pr_auc']['past_only']):>7}"
              f"{fmt(v['pr_auc']['climatology']):>7}{fmt(v['pr_auc']['rule']):>7}{fmt(v['roc_auc']['full']):>10}"
              f"{fmt(v['brier_skill']['full']):>10}{fmt(v['brier_skill']['past_only']):>10}{fmt(v['forecast_dependent_share'], 2):>10}")
    ix = m["index"]
    print(f"index ROC-AUC any event {fmt(ix['roc_auc_any_event'])} vs rule max {fmt(ix['rule_max_roc_auc_any_event'])}; "
          f"escalation {ix['escalation']['days']} days, event rate {fmt(ix['escalation']['event_rate'])} vs "
          f"{fmt(ix['escalation']['same_rule_tier_event_rate'])} at the same rule tier")
    print(f"wrote {paths.MODELS / version / 'metrics.json'} and figures/")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
