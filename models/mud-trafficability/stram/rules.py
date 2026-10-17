"""Flag and score rules: STRAM ground index + NRCS hybrid, wet-area override. Vectorized over rasters.

Flags are inspection priority, never a crossing clearance: 0 ok, 1 inspect, 2 hold (hold mobilization until the
ground is inspected). Each flag carries the source that set it, so the map can say why.
"""
from __future__ import annotations

import numpy as np

from . import config as C

OK, INSPECT, HOLD = 0, 1, 2
SOURCES = ("stram", "nrcs", "nrcs_organic", "wet_area", "soil_unknown")
STRAM, NRCS, NRCS_ORGANIC, WET_AREA, SOIL_UNKNOWN = range(len(SOURCES))
WET = ("moist", "wet")


def wetness_class(rain_in: float) -> str:
    """72 h antecedent plus same-day rain -> Table 8-style wetness class."""
    for cls, limit in zip(C.WETNESS_CLASSES, C.WETNESS_RAIN_IN):
        if rain_in < limit:
            return cls
    return C.WETNESS_CLASSES[-1]


def mil_column(mil_type: int, wet_class: str, passes: int) -> str:
    """NRCS MIL rating to use: dry season when the forecast is dry, else wet season with 1 or 50 passes."""
    if wet_class in ("very_dry", "dry"):
        season = "dry"
    else:
        season = "wet1" if passes <= 2 else "wet50"
    return f"mil_traf_t{mil_type}_{season}"


def flag_from_z(z_in):
    z = np.nan_to_num(np.asarray(z_in, dtype=float), nan=0.0)
    return np.where(z >= C.HOLD_IN, HOLD, np.where(z >= C.INSPECT_IN, INSPECT, OK)).astype(np.int8)


def flag_from_mil(rating, missing: int):
    r = np.asarray(rating, dtype=float)
    f = np.where(r < C.MIL_POOR_BELOW, HOLD, np.where(r < C.MIL_GOOD_FROM, INSPECT, OK))
    return np.where(np.isnan(r), missing, f).astype(np.int8)


def _raise(flag, source, mask, level, src):
    hit = mask & (flag < level)
    flag[hit] = level
    source[hit] = src


def combine(equipment: C.Equipment, *, z_in, mil, organic, soil_unknown, rut_severe, dtw_eff_ft, wet_class: str):
    """Return (flag, source) arrays for one machine class, one horizon and one pass count."""
    shape = np.broadcast(*(np.asarray(a) for a in (z_in, mil, organic, soil_unknown, rut_severe, dtw_eff_ft))).shape
    organic = np.broadcast_to(organic, shape)
    if equipment.kind == "wheeled":
        flag = np.broadcast_to(flag_from_z(z_in), shape).copy()
        source = np.full(shape, STRAM, dtype=np.int8)
        # Organic soils are outside STRAM: NRCS decides, never below inspect.
        org = np.broadcast_to(np.maximum(flag_from_mil(mil, missing=INSPECT), INSPECT), shape)
        flag[organic] = org[organic]
        source[organic] = NRCS_ORGANIC
        # Mineral soils: the worse of the ground index and the truck's MIL rating; Severe rutting hazard >= inspect.
        mil_flag = np.broadcast_to(flag_from_mil(mil, missing=OK), shape)
        worse = ~organic & (mil_flag > flag)
        flag[worse] = mil_flag[worse]
        source[worse] = NRCS
        if wet_class in WET:  # the NRCS rutting hazard describes wet operation
            _raise(flag, source, ~organic & np.broadcast_to(rut_severe, shape), INSPECT, NRCS)
    else:
        flag = np.broadcast_to(flag_from_mil(mil, missing=INSPECT), shape).copy()
        source = np.where(np.isnan(np.broadcast_to(np.asarray(mil, dtype=float), shape)), SOIL_UNKNOWN, NRCS).astype(np.int8)
    # Study 3.1 / Fig 8: the deepest ruts were in wet areas (DTW < 0.5 m) after rain. Off in dry weather, when the
    # study's wet areas shrink (Table 8) and flat arid ground would otherwise read as wet.
    if wet_class in WET:
        wet_area = np.broadcast_to(np.asarray(dtw_eff_ft) < C.WET_AREA_DTW_FT, shape)
        _raise(flag, source, wet_area, HOLD if wet_class == "wet" else INSPECT, WET_AREA)
    _raise(flag, source, np.broadcast_to(soil_unknown, shape), INSPECT, SOIL_UNKNOWN)
    return flag, source


def score(equipment: C.Equipment, z_in, flag, organic=False):
    """0-10. Wheeled: piecewise linear in the ground index, never below the flag's floor. Tracked: the flag's score."""
    floor = np.choose(np.asarray(flag, dtype=np.int8), [C.FLAG_SCORE[f] for f in C.FLAGS])
    if equipment.kind != "wheeled":
        return floor.astype(float)
    xs, ys = zip(*C.SCORE_KNOTS_IN)
    z = np.where(organic, 0.0, np.nan_to_num(np.asarray(z_in, dtype=float), nan=0.0))
    return np.maximum(np.interp(z, xs, ys), floor)
