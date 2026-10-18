"""Heat section: hourly heat index and WBGT, a band for each hour, the peak, and a water-break timeline.

Bands are the four National Weather Service heat index categories (lower bounds 80, 91, 103, 125 F).
Water and rest prompts use only what OSHA publishes: drink water about every 15 minutes, take frequent
rest breaks in the shade, extra precautions from a heat index of 80 F, schedule intense work in the
cooler part of the day. No work/rest minute ratios are invented: the safety contract forbids that.

Two limits are stated in the report next to the numbers:
  * The heat index assumes shade. In full sun it can be up to 15 F higher (NWS).
  * WBGT here is an approximation (Stull wet bulb plus solar and wind terms), not Liljegren, and its
    tiers (82/85/88/90 F) are not verified against TB MED 507. They are the tiers the live alerts use."""
from __future__ import annotations

from .weather_plan import WORKDAY, js_round

SOURCE = {
    "table": "National Weather Service heat index categories",
    "url": "https://www.weather.gov/safety/heat-index",
    "retrieved": "2026-10-18",
    "verified": "Chart read by hand: the chart is an image and could not be machine-read. Confirm the "
                "boundaries and wording against the NWS chart before relying on them.",
    "osha": ["https://www.osha.gov/heat-exposure/hazards",
             "https://www.osha.gov/emergency-preparedness/guides/heat-stress"],
}
FULL_SUN_ADD_F = 15   # NWS: exposure to full sunshine can increase heat index values by up to 15 F

# min = lowest heat index (whole degrees F) in the band. NWS prints 103 in two bands; like the rules
# engine (rules_engine.sql: 103 -> warning), 103 belongs to "danger".
BANDS = [
    {"id": "low", "name": "Below caution", "min": None, "water_every_min": None, "rest": None,
     "effects": None,
     "action": "Below the heat index of 80 F where OSHA's extra heat precautions start. Drink water as usual."},
    {"id": "caution", "name": "Caution", "min": 80, "water_every_min": 15, "rest": "Rest breaks in the shade.",
     "effects": "Fatigue is possible with long exposure or activity.",
     "action": "Extra heat precautions apply from 80 F (OSHA). Drink water about every 15 minutes. Take rest breaks in the shade."},
    {"id": "extreme_caution", "name": "Extreme caution", "min": 91, "water_every_min": 15,
     "rest": "Frequent rest breaks in the shade.",
     "effects": "Heat cramps, heat exhaustion or heat stroke are possible with long exposure or activity.",
     "action": "Drink water about every 15 minutes. Take frequent rest breaks in the shade. Watch the crew for heat illness signs."},
    {"id": "danger", "name": "Danger", "min": 103, "water_every_min": 15,
     "rest": "Frequent rest breaks in the shade.",
     "effects": "Heat cramps and heat exhaustion are likely. Heat stroke is probable with continued activity.",
     "action": "Drink water about every 15 minutes. Take frequent rest breaks in the shade. Do the heaviest work in the cooler hours."},
    {"id": "extreme_danger", "name": "Extreme danger", "min": 125, "water_every_min": 15,
     "rest": "Frequent rest breaks in the shade.",
     "effects": "Heat stroke is highly likely.",
     "action": "Move work out of these hours where you can. Where you cannot, drink water about every 15 minutes and take frequent rest breaks in the shade."},
]
# Acclimatization guidance from NIOSH and OSHA. The browser shows it when the manager switches on
# "workers new to the job or back after a break". It is guidance text with a schedule, not a change to the bands.
ACCLIMATIZATION = {
    "source": {
        "urls": ["https://www.cdc.gov/niosh/heat-stress/recommendations/acclimatization.html",
                 "https://www.osha.gov/heat-exposure/protecting-new-workers",
                 "https://www.osha.gov/heat-exposure/hazards"],
        "retrieved": "2026-10-18",
        "verified": "Taken from NIOSH and OSHA pages as summarised by a search tool on 2026-10-18. Confirm against the pages before relying on it.",
    },
    "who": "OSHA treats workers as unacclimatized when they have been on the job less than 1 to 2 weeks. NIOSH treats workers "
           "back after an absence of more than a week as new.",
    "new": {"label": "New workers", "unit": "percent of the usual time in the heat",
            "schedule": [{"day": d, "max_percent": 20 * d} for d in range(1, 6)]},
    "experienced": {"label": "Experienced workers, first days back", "unit": "percent of the usual time in the heat",
                    "schedule": [{"day": 1, "max_percent": 50}, {"day": 2, "max_percent": 60}, {"day": 3, "max_percent": 80}, {"day": 4, "max_percent": 100}]},
    "notes": [
        "New workers start at no more than 20% of the usual time in the heat on day 1 and add no more than 20% each day.",
        "Supervise new workers closely for the first 14 days or until they are fully acclimatized.",
        "In a sudden heat wave, even experienced workers start the first hot day at 50% of the usual time.",
        "For intense work, take frequent rest breaks and do the work in the cooler part of the day (OSHA).",
    ],
}
# WBGT tiers used by the live alerts (supabase rules_engine.sql / hazidx rules.py): min F, name.
WBGT_TIERS = ((90, "stop heavy work"), (88, "danger, limit heavy work"), (85, "scheduled rest breaks"), (82, "caution"))


def band_for(hi: float | None) -> dict | None:
    if hi is None:
        return None
    whole = int(js_round(hi))
    best = BANDS[0]
    for b in BANDS[1:]:
        if whole >= b["min"]:
            best = b
    return best


def wbgt_tier(wbgt: float | None) -> str | None:
    if wbgt is None:
        return None
    return next((name for floor, name in WBGT_TIERS if wbgt >= floor), "below caution")


def build(hours: list[dict]) -> dict:
    """`hours` is weather_plan.hourly_plan output."""
    if not any(h["have_data"] and h["hi"] is not None for h in hours):
        return {"status": "missing", "reason": "The forecast has no temperature and humidity for this day."}
    rows = []
    for h in hours:
        b = band_for(h["hi"])
        sun = band_for(None if h["hi"] is None else h["hi"] + FULL_SUN_ADD_F)
        rows.append({
            "hour": h["hour"], "hi": h["hi"], "feels": h["feels"], "temp": h["temp"], "rh": h["rh"], "wbgt": h["wbgt"],
            "band": b["id"] if b else None, "band_full_sun_max": sun["id"] if sun else None,
            "hi_full_sun_max": None if h["hi"] is None else int(js_round(h["hi"] + FULL_SUN_ADD_F)),
            "wbgt_tier": wbgt_tier(h["wbgt"]),
        })
    lo, hi_h = WORKDAY
    work = [r for r in rows if lo <= r["hour"] < hi_h and r["hi"] is not None]
    peak = max(work or [r for r in rows if r["hi"] is not None], key=lambda r: (r["hi"], -r["hour"]))
    hottest = sorted(r["hour"] for r in rows if r["hi"] is not None and r["hi"] >= peak["hi"] - 3)
    # keep the run of hours around the peak, not isolated hours elsewhere
    window = [peak["hour"]]
    for step in (-1, 1):
        h = peak["hour"] + step
        while h in hottest:
            window.append(h)
            h += step
    by_band: dict[str, int] = {}
    for r in work:
        by_band[r["band"]] = by_band.get(r["band"], 0) + 1
    return {
        "status": "ok", "source": SOURCE, "bands": BANDS, "wbgt_tiers": [{"min": m, "name": n} for m, n in WBGT_TIERS],
        "hours": rows,
        "peak": {"hour": peak["hour"], "hi": peak["hi"], "band": peak["band"], "wbgt": peak["wbgt"],
                 "hi_full_sun_max": peak["hi_full_sun_max"]},
        "hottest_window": {"start": f"{min(window):02d}:00", "end": f"{max(window) + 1:02d}:00"},
        "workday_hours_by_band": by_band,
        "water_plan": water_plan(rows),
        "acclimatization": ACCLIMATIZATION,
        "notes": [
            "The heat index assumes shade. In full sun it can be up to 15 F higher (NWS), so the sun column shows the upper case.",
            "Hourly values are the highest of seven forecast points within 20 km of the site.",
            "WBGT is an approximation and its tiers are not verified against TB MED 507.",
            "OSHA treats workers as unacclimatized when they have been on the job less than 1 to 2 weeks. Use the acclimatization switch.",
        ],
    }


def water_plan(rows: list[dict]) -> list[dict]:
    """Runs of workday hours with the same band: [{start, end, band, water_every_min, rest, action}]."""
    lo, hi = WORKDAY
    by_id = {b["id"]: b for b in BANDS}
    runs: list[dict] = []
    for r in rows:
        if not (lo <= r["hour"] < hi) or r["band"] is None:
            continue
        if runs and runs[-1]["band"] == r["band"] and runs[-1]["_end"] == r["hour"]:
            runs[-1]["_end"] = r["hour"] + 1
            continue
        runs.append({"band": r["band"], "_start": r["hour"], "_end": r["hour"] + 1})
    out = []
    for run in runs:
        b = by_id[run["band"]]
        out.append({"start": f"{run['_start']:02d}:00", "end": f"{run['_end']:02d}:00", "band": b["id"], "name": b["name"],
                    "water_every_min": b["water_every_min"], "rest": b["rest"], "action": b["action"]})
    return out
