"""Python copy of the rule subscores in supabase/migrations/20261017001000_rules_engine.sql
(heat_tier, heat_score, flood_score, soil_score, weather_score, wildfire_score). SQL NULL becomes
None or NaN, and every NULL comparison is false, as in Postgres. Scalar functions use Decimal so
results equal Postgres numeric exactly; the vectorized versions are for whole data sets."""
from __future__ import annotations

import math
from decimal import ROUND_HALF_UP, Decimal

import numpy as np

FLOOD_ZONES = ("A", "AE", "AH", "AO", "AR", "A99", "V", "VE")


def _missing(x) -> bool:
    return x is None or (isinstance(x, float) and math.isnan(x))


def heat_tier(wbgt) -> int:
    if _missing(wbgt):
        return 0
    return 4 if wbgt >= 90 else 3 if wbgt >= 88 else 2 if wbgt >= 85 else 1 if wbgt >= 82 else 0


def heat_score(wbgt, hi) -> float:
    a = {4: 10, 3: 7.5, 2: 5, 1: 3}.get(heat_tier(wbgt), 0)
    b = 0 if _missing(hi) else 9 if hi >= 125 else 6 if hi >= 103 else 3 if hi >= 90 else 0
    return float(max(a, b))


def _zone_mult(zone) -> Decimal:
    return Decimal("1.3") if zone in FLOOD_ZONES else Decimal(1)


def _river_mult(river_m) -> Decimal:
    if _missing(river_m):
        return Decimal(1)
    return Decimal("1.2") if river_m <= 5000 else Decimal("0.8") if river_m > 25000 else Decimal(1)


def flood_score(rain_mm, stage=None, flood_stage=None, warning=None, zone=None, river_m=None) -> float:
    rain = 0 if _missing(rain_mm) else 9 if rain_mm >= 100 else 6 if rain_mm >= 50 else 4 if rain_mm >= 25 else 2 if rain_mm >= 10 else 0
    if _missing(stage) or _missing(flood_stage) or flood_stage <= 0:
        gauge = 0
    else:
        gauge = 9 if stage >= flood_stage else 6 if stage >= 0.8 * flood_stage else 0
    warn = 8 if (0 if _missing(warning) else warning) >= 1 else 0
    v = Decimal(max(rain, gauge, warn)) * _zone_mult(zone) * _river_mult(river_m)
    return float(min(Decimal(10), v))


def soil_score(frac) -> float:
    if _missing(frac):
        return 0.0
    return 8.0 if frac >= 0.45 else 6.0 if frac >= 0.40 else 4.0 if frac >= 0.35 else 2.0 if frac >= 0.30 else 0.0


def weather_score(severity, gust) -> float:
    a = min((0 if _missing(severity) else severity) * 2, 8)
    b = 0 if _missing(gust) else 9 if gust >= 58 else 6 if gust >= 40 else 3 if gust >= 30 else 0
    return float(max(a, b))


def wildfire_score(miles) -> float:
    if _missing(miles):
        return 0.0
    return 10.0 if miles < 5 else 8.0 if miles < 10 else 6.0 if miles < 25 else 3.0 if miles < 50 else 1.0 if miles < 100 else 0.0


def round_half(x: float) -> float:
    """Nearest 0.5, ties up (used for the overall rule maximum in the 0-10 map)."""
    return float((Decimal(repr(x)) * 2).quantize(Decimal(1), rounding=ROUND_HALF_UP) / 2)


# ------------------------------------------------------------------ vectorized

def _steps(x, cuts, values):
    """values[i] where x >= cuts[i] (first match, cuts descending); 0 when missing or below all."""
    x = np.asarray(x, float)
    out = np.zeros(x.shape)
    done = np.isnan(x)
    for c, v in zip(cuts, values):
        hit = ~done & (x >= c)
        out[hit] = v
        done |= hit
    return out


def heat_score_np(wbgt, hi):
    return np.maximum(_steps(wbgt, (90, 88, 85, 82), (10, 7.5, 5, 3)), _steps(hi, (125, 103, 90), (9, 6, 3)))


def weather_score_np(gust):
    return _steps(gust, (58, 40, 30), (9, 6, 3))


def flood_rain_score_np(rain_mm, zone, river_m):
    base = _steps(rain_mm, (100, 50, 25, 10), (9, 6, 4, 2))
    mult = float(_zone_mult(zone) * _river_mult(river_m))
    return np.minimum(10.0, np.round(base * mult, 6))


def soil_score_np(frac):
    return _steps(frac, (0.45, 0.40, 0.35, 0.30), (8, 6, 4, 2))


def round_half_np(x):
    return np.floor(np.asarray(x, float) * 2 + 0.5 + 1e-9) / 2
