"""Hourly plan for the report day. hourly_plan and work_window are ports of hourlyPlan and workWindow in
supabase/functions/_shared/briefing.ts, checked against it by tests/test_parity.py, so the work window
here equals the one in the existing next-day plan. Each value is the worst across the seven forecast
points within 20 km of the site. The extra fields (heat index, CAPE, UV, apparent temperature) are for display."""
from __future__ import annotations

import math

from hazidx import localtime
from hazidx.heat import heat_index_f, wbgt_f

from .forecast import parse_utc_hours, value_at

# Thresholds mirror the rules engine (briefing.ts LIMITS): WBGT 88 F is the "danger" tier, gusts 40 mph
# and a 60% storm chance are "caution", 1 mm in an hour is rain.
LIMITS = {"wbgt": 88, "gust": 40, "pop": 60, "mm": 1}
WORKDAY = (6, 19)   # local hours the work window is searched in


def js_round(x: float, digits: int = 0) -> float:
    """JavaScript Math.round (halves go up), so Python output equals the TypeScript output."""
    f = 10 ** digits
    return math.floor(x * f + 0.5) / f


def _max(values: list[float | None]) -> float | None:
    nums = [v for v in values if v is not None]
    return max(nums) if nums else None


def _r(v: float | None, digits: int) -> float | int | None:
    if v is None:
        return None
    out = js_round(v, digits)
    return int(out) if digits == 0 else out


def hourly_plan(locations: list[dict], tz: str, for_date: str) -> list[dict]:
    """24 rows, one per local hour of `for_date`."""
    times = [parse_utc_hours(loc) for loc in locations]
    out = []
    for hour in range(24):
        utc = localtime.zoned_to_utc(for_date, hour, tz)
        rows = []
        for loc, ts in zip(locations, times):
            if utc not in ts:
                continue
            i = ts.index(utc)
            t, rh = value_at(loc, "temperature_2m", i), value_at(loc, "relative_humidity_2m", i)
            wind = value_at(loc, "wind_speed_10m", i) or 0.0
            sun = value_at(loc, "shortwave_radiation", i) or 0.0
            rows.append({
                "wbgt": wbgt_f(t, rh, wind, sun) if t is not None and rh is not None else None,
                "hi": heat_index_f(t, rh) if t is not None and rh is not None else None,
                "temp": t, "feels": value_at(loc, "apparent_temperature", i),
                "gust": value_at(loc, "wind_gusts_10m", i), "pop": value_at(loc, "precipitation_probability", i),
                "mm": value_at(loc, "precipitation", i), "cape": value_at(loc, "cape", i),
                "uv": value_at(loc, "uv_index", i), "wind": wind, "rh": rh,
            })
        worst = {k: _max([r[k] for r in rows]) for k in ("wbgt", "hi", "temp", "feels", "gust", "pop", "mm", "cape", "uv", "wind", "rh")}
        blocked = []
        if worst["wbgt"] is not None and worst["wbgt"] >= LIMITS["wbgt"]:
            blocked.append("heat")
        if worst["gust"] is not None and worst["gust"] >= LIMITS["gust"]:
            blocked.append("wind")
        if worst["pop"] is not None and worst["pop"] >= LIMITS["pop"]:
            blocked.append("storms")
        if worst["mm"] is not None and worst["mm"] >= LIMITS["mm"]:
            blocked.append("rain")
        out.append({
            "hour": hour, "wbgt": _r(worst["wbgt"], 1), "gust": _r(worst["gust"], 0), "pop": _r(worst["pop"], 0),
            "mm": _r(worst["mm"], 1), "safe": bool(rows) and not blocked, "blocked_by": blocked,
            # display fields, not part of the briefing.ts parity
            "hi": _r(worst["hi"], 1), "temp": _r(worst["temp"], 1), "feels": _r(worst["feels"], 1),
            "cape": _r(worst["cape"], 0), "uv": _r(worst["uv"], 1), "wind": _r(worst["wind"], 1),
            "rh": _r(worst["rh"], 0), "have_data": bool(rows),
        })
    return out


def _pad(h: int) -> str:
    return f"{h:02d}:00"


def work_window(hours: list[dict], day_start: int = WORKDAY[0], day_end: int = WORKDAY[1]) -> dict | None:
    """Longest run of safe hours in the normal working day, at least two hours long."""
    best: tuple[int, int] | None = None
    run_start = -1
    for h in range(day_start, day_end + 1):
        ok = h < day_end and h < len(hours) and bool(hours[h]["safe"])
        if ok and run_start < 0:
            run_start = h
        if not ok and run_start >= 0:
            if best is None or h - run_start > best[1] - best[0]:
                best = (run_start, h)
            run_start = -1
    if best and best[1] - best[0] >= 2:
        return {"start": _pad(best[0]), "end": _pad(best[1])}
    return None


BLOCK_TEXT = {
    "heat": "Heat stress reaches the danger tier (WBGT 88 F or higher).",
    "wind": "Gusts reach 40 mph or more.",
    "storms": "Storm chance reaches 60% or more.",
    "rain": "Measurable rain (1 mm or more in an hour) is forecast.",
}


def blocked_runs(hours: list[dict], day_start: int = WORKDAY[0], day_end: int = WORKDAY[1]) -> list[dict]:
    """Consecutive blocked hours in the workday with the reasons: [{start, end, reasons}]."""
    runs, i = [], day_start
    while i < day_end:
        if hours[i]["safe"] or not hours[i]["have_data"]:
            i += 1
            continue
        start, why = i, []
        while i < day_end and not hours[i]["safe"] and hours[i]["have_data"]:
            why += [b for b in hours[i]["blocked_by"] if b not in why]
            i += 1
        runs.append({"start": _pad(start), "end": _pad(i), "reasons": why})
    return runs


def storm_strip(hours: list[dict]) -> list[dict]:
    """The storm-relevant fields per hour, for the strip in the app."""
    return [{"hour": h["hour"], "pop": h["pop"], "cape": h["cape"], "gust": h["gust"], "mm": h["mm"]} for h in hours]
