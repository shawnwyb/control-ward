"""Python copy of supabase/functions/_shared/heat.ts. tests/test_parity.py checks that both give the
same values to within 1e-9, so a change on either side must be made on both.

WBGT here is the same engineering approximation the live system uses (Stull wet bulb plus a solar
and wind adjustment). It is not the Liljegren model.
"""
from __future__ import annotations

import math

import numpy as np


def _to_c(f):
    return ((f - 32) * 5) / 9


def _to_f(c):
    return (c * 9) / 5 + 32


def wet_bulb_c(t_c: float, rh: float) -> float:
    """Stull (2011), valid for 5-99% RH and -20..50 C."""
    return (t_c * math.atan(0.151977 * math.sqrt(rh + 8.313659)) + math.atan(t_c + rh)
            - math.atan(rh - 1.676331) + 0.00391838 * math.pow(rh, 1.5) * math.atan(0.023101 * rh)
            - 4.686035)


def wbgt_f(temp_f: float, rh: float, wind_mph: float, solar_wm2: float) -> float:
    ta = _to_c(temp_f)
    wind_ms = max(wind_mph, 0) * 0.44704
    sun = max(solar_wm2, 0)
    tnwb = wet_bulb_c(ta, min(max(rh, 5), 99)) + 0.0015 * sun
    tg = ta + (0.015 * sun) / (1 + 0.25 * wind_ms)
    return _to_f(0.7 * tnwb + 0.2 * tg + 0.1 * ta)


def heat_index_f(t: float, rh: float) -> float:
    """NWS Rothfusz regression with the standard low- and high-humidity adjustments (deg F)."""
    simple = 0.5 * (t + 61 + (t - 68) * 1.2 + rh * 0.094)
    if (simple + t) / 2 < 80:
        return (simple + t) / 2
    hi = (-42.379 + 2.04901523 * t + 10.14333127 * rh - 0.22475541 * t * rh - 0.00683783 * t * t
          - 0.05481717 * rh * rh + 0.00122874 * t * t * rh + 0.00085282 * t * rh * rh
          - 0.00000199 * t * t * rh * rh)
    if rh < 13 and 80 <= t <= 112:
        hi -= ((13 - rh) / 4) * math.sqrt((17 - abs(t - 95)) / 17)
    elif rh > 85 and 80 <= t <= 87:
        hi += ((rh - 85) / 10) * ((87 - t) / 5)
    return hi


# ------------------------------------------------------------------ vectorized versions (features)

def wet_bulb_c_np(t_c, rh):
    return (t_c * np.arctan(0.151977 * np.sqrt(rh + 8.313659)) + np.arctan(t_c + rh)
            - np.arctan(rh - 1.676331) + 0.00391838 * np.power(rh, 1.5) * np.arctan(0.023101 * rh)
            - 4.686035)


def wbgt_f_np(temp_f, rh, wind_mph, solar_wm2):
    """NaN temperature or humidity gives NaN; NaN wind or sun counts as 0, as in buildReadings."""
    temp_f, rh = np.asarray(temp_f, float), np.asarray(rh, float)
    wind = np.nan_to_num(np.asarray(wind_mph, float), nan=0.0)
    sun = np.maximum(np.nan_to_num(np.asarray(solar_wm2, float), nan=0.0), 0)
    ta = _to_c(temp_f)
    wind_ms = np.maximum(wind, 0) * 0.44704
    tnwb = wet_bulb_c_np(ta, np.clip(rh, 5, 99)) + 0.0015 * sun
    tg = ta + (0.015 * sun) / (1 + 0.25 * wind_ms)
    return _to_f(0.7 * tnwb + 0.2 * tg + 0.1 * ta)


def heat_index_f_np(t, rh):
    t, rh = np.asarray(t, float), np.asarray(rh, float)
    simple = 0.5 * (t + 61 + (t - 68) * 1.2 + rh * 0.094)
    hi = (-42.379 + 2.04901523 * t + 10.14333127 * rh - 0.22475541 * t * rh - 0.00683783 * t * t
          - 0.05481717 * rh * rh + 0.00122874 * t * t * rh + 0.00085282 * t * rh * rh
          - 0.00000199 * t * t * rh * rh)
    with np.errstate(invalid="ignore"):
        low = (rh < 13) & (t >= 80) & (t <= 112)
        high = ~low & (rh > 85) & (t >= 80) & (t <= 87)
        hi = np.where(low, hi - ((13 - rh) / 4) * np.sqrt(np.clip((17 - np.abs(t - 95)) / 17, 0, None)), hi)
        hi = np.where(high, hi + ((rh - 85) / 10) * ((87 - t) / 5), hi)
        return np.where((simple + t) / 2 < 80, (simple + t) / 2, hi)


# ------------------------------------------------------------------ moisture helpers (not in heat.ts)

def dew_point_f_np(temp_f, rh):
    """Magnus formula (Alduchov and Eskridge constants)."""
    t = _to_c(np.asarray(temp_f, float))
    with np.errstate(divide="ignore", invalid="ignore"):
        g = np.log(np.clip(np.asarray(rh, float), 1, 100) / 100) + 17.625 * t / (243.04 + t)
        return _to_f(243.04 * g / (17.625 - g))


def vpd_kpa_np(temp_f, rh):
    """Vapor pressure deficit (kPa), Tetens saturation pressure."""
    t = _to_c(np.asarray(temp_f, float))
    es = 0.6108 * np.exp(17.27 * t / (t + 237.3))
    return es * (1 - np.clip(np.asarray(rh, float), 0, 100) / 100)
