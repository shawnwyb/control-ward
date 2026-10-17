"""The 0-10 map: the combined value R = max_h(s_h * p_h) -> a score on the rule-subscore scale
(about 3 watch, 7.5 warning, 10 stop work), so live risk max(ML, worst subscore) stays meaningful.

Fit on overall daily values from out-of-fold training predictions, never on event labels:
  1. For each rule maximum above 0 seen on at least TIER_MIN_DAYS days, take the median R.
  2. Sort by rule level; drop any pair whose median R is not larger than the previous kept pair's.
  3. Connect (0, 0) and the kept pairs with straight lines; extend the last segment to 10.
  4. Round to 0.1 (half up) and limit to 0-10, as Postgres numeric(3,1) stores it.
Fallback to the fixed points TIER_FALLBACK if fewer than 3 pairs are kept or none is at 7.5 or above.
"""
from __future__ import annotations

import numpy as np

from . import config


def fit(r: np.ndarray, rule_max: np.ndarray, min_days: int = config.TIER_MIN_DAYS) -> dict:
    r, rule_max = np.asarray(r, float), np.asarray(rule_max, float)
    pairs, removed, counts = [], [], {}
    for level in sorted(np.unique(rule_max[rule_max > 0])):
        sel = rule_max == level
        counts[float(level)] = int(sel.sum())
        if sel.sum() >= min_days:
            pairs.append((float(np.median(r[sel])), float(level)))
    kept, last = [], 0.0
    for med, level in pairs:
        if med > last:
            kept.append((med, level))
            last = med
        else:
            removed.append({"median_r": med, "rule_max": level, "days": counts[level]})
    fallback = len(kept) < 3 or max((lv for _, lv in kept), default=0) < 7.5
    if fallback:
        points = [list(p) for p in config.TIER_FALLBACK]
    else:
        points = [[0.0, 0.0]] + [[m, lv] for m, lv in kept]
        (r1, l1), (r2, l2) = points[-2], points[-1]
        if l2 < 10:
            points.append([r2 + (10 - l2) * (r2 - r1) / (l2 - l1), 10.0])
    return {"points": points, "fallback": bool(fallback), "pairs": [list(p) for p in pairs],
            "removed": removed, "rule_level_days": {str(k): v for k, v in counts.items()}, "min_days": min_days}


def round_tenth(x: np.ndarray) -> np.ndarray:
    """Half up to 0.1 (7.45 -> 7.5), as Postgres rounds numeric."""
    return np.floor(np.asarray(x, float) * 10 + 0.5 + 1e-9) / 10


def apply(r: np.ndarray, tmap: dict) -> np.ndarray:
    xs = [p[0] for p in tmap["points"]]
    ys = [p[1] for p in tmap["points"]]
    score = np.interp(np.asarray(r, float), xs, ys, left=0.0, right=ys[-1])
    return np.clip(round_tenth(score), 0.0, 10.0)


def tier(score: np.ndarray) -> np.ndarray:
    """none / watch / warning / stop, from the rule thresholds 3, 7.5 and 10."""
    s = np.asarray(score, float)
    out = np.full(s.shape, "none", dtype=object)
    for cut, name in sorted(config.TIERS):
        out[s >= cut] = name
    return out
