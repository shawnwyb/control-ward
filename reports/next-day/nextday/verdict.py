"""Day verdict: go, go with limits, or reschedule. Decision support only. It does not certify that work is safe.
Every threshold is in RULES so a reader can audit and change them in one place."""
from __future__ import annotations

from . import heat_plan

LEVELS = ("go", "limits", "reschedule")
LABEL = {"go": "Go", "limits": "Go with limits", "reschedule": "Reschedule"}
DISCLAIMER = ("This verdict is decision support built from forecasts and models. It does not clear any task, route or "
              "crossing as safe. The site safety lead decides.")

RULES = {
    "window_hours_go": 4,                  # a best work window shorter than this -> limits
    "hazard_index_limits": 3.0,            # rule sub-score scale: 3 watch
    "hazard_index_reschedule": 7.5,        # 7.5 warning
    "aqi_limits": 101, "aqi_reschedule": 201,
    "wbgt_reschedule": 90,                 # WBGT tier "stop heavy work" during the workday
    "heat_band_limits": "extreme_caution", "heat_band_reschedule": "extreme_danger",
    "river_limits": ("minor",), "river_reschedule": ("moderate", "major"),
    "mud_limits_flags": ("hold",),
    # NWS products that mean work in the open should stop or move
    "alert_reschedule": ("Tornado Warning", "Severe Thunderstorm Warning", "Flash Flood Warning", "Flood Warning",
                         "Extreme Heat Warning", "Excessive Heat Warning", "Hurricane Warning", "Tropical Storm Warning",
                         "Storm Surge Warning", "High Wind Warning", "Red Flag Warning", "Dense Smoke Advisory"),
    "alert_limits_severity": ("Moderate", "Severe", "Extreme"),
}
BAND_ORDER = [b["id"] for b in heat_plan.BANDS]


def _rank(band_id: str | None) -> int:
    return BAND_ORDER.index(band_id) if band_id in BAND_ORDER else -1


def evaluate(sections: dict, window: dict | None, workday_hours: list[dict]) -> dict:
    reasons: list[dict] = []

    def add(level: str, code: str, text: str) -> None:
        reasons.append({"level": level, "code": code, "text": text})

    if window is None:
        add("reschedule", "no_window", "No two-hour stretch between 06:00 and 19:00 is free of heat, wind, storm or rain limits.")
    else:
        h0, h1 = int(window["start"][:2]), int(window["end"][:2])
        if h1 - h0 < RULES["window_hours_go"]:
            add("limits", "short_window", f"The best work window is only {h1 - h0} hours ({window['start']} to {window['end']}).")
    blocked = {b for h in workday_hours for b in h.get("blocked_by", [])}
    if blocked:
        add("limits", "blocked_hours", "Some workday hours are blocked by " + ", ".join(sorted(blocked)) + ".")

    for a in (sections.get("weather") or {}).get("alerts", []):
        if a["event"] in RULES["alert_reschedule"]:
            add("reschedule", "nws_alert", f"{a['event']} overlaps the day.")
        elif a.get("severity") in RULES["alert_limits_severity"]:
            add("limits", "nws_alert", f"{a['event']} ({a['severity']}) overlaps the day.")

    heat = sections.get("heat") or {}
    if heat.get("status") == "ok":
        peak = heat["peak"]
        if _rank(peak["band"]) >= _rank(RULES["heat_band_reschedule"]):
            add("reschedule", "heat_band", f"The heat index peaks at {peak['hi']:.0f} F ({peak['band'].replace('_', ' ')}) around {peak['hour']:02d}:00.")
        elif _rank(peak["band"]) >= _rank(RULES["heat_band_limits"]):
            add("limits", "heat_band", f"The heat index peaks at {peak['hi']:.0f} F ({peak['band'].replace('_', ' ')}) around {peak['hour']:02d}:00.")
        if peak.get("wbgt") is not None and peak["wbgt"] >= RULES["wbgt_reschedule"]:
            add("reschedule", "wbgt", f"WBGT peaks at {peak['wbgt']:.0f} F, the stop-heavy-work tier.")

    hi = sections.get("hazard_index") or {}
    if hi.get("status") == "ok":
        if hi["score"] >= RULES["hazard_index_reschedule"]:
            add("reschedule", "hazard_index", f"The hazard index is {hi['score']:.1f} of 10 ({hi['tier']}), driven by {hi['top_driver']}.")
        elif hi["score"] >= RULES["hazard_index_limits"]:
            add("limits", "hazard_index", f"The hazard index is {hi['score']:.1f} of 10 ({hi['tier']}), driven by {hi['top_driver']}.")

    air = sections.get("air") or {}
    if air.get("peak"):
        aqi = air["peak"]["us_aqi"]
        if aqi >= RULES["aqi_reschedule"]:
            add("reschedule", "air", f"The air quality index reaches {aqi:.0f} ({air['peak']['band']['name'].lower()}).")
        elif aqi >= RULES["aqi_limits"]:
            add("limits", "air", f"The air quality index reaches {aqi:.0f} ({air['peak']['band']['name'].lower()}).")

    river = (sections.get("flood") or {}).get("river") or {}
    if river.get("status") == "ok":
        if river["flag"] in RULES["river_reschedule"]:
            add("reschedule", "river", f"The river gauge {river['gauge']['name']} is forecast at {river['flag']} flood stage.")
        elif river["flag"] in RULES["river_limits"]:
            add("limits", "river", f"The river gauge {river['gauge']['name']} is forecast at {river['flag']} flood stage.")

    mud = sections.get("mud") or {}
    if mud.get("status") in ("ok", "stale"):
        eq = next((e for e in mud["equipment"] if e["key"] == mud["default_equipment"]), None)
        if eq and eq["worst_flag"] in RULES["mud_limits_flags"]:
            add("limits", "mud", f"{mud['segment_counts']['hold']} rated route segments are at 'hold' for road trucks. See the routes to avoid.")

    tide = (sections.get("flood") or {}).get("tide") or {}
    if tide.get("status") == "ok" and tide.get("shading_file"):
        add("limits", "tide", "Low ground near the site can flood near high tide. See the tide map and times.")

    level = max((LEVELS.index(r["level"]) for r in reasons), default=0)
    reasons.sort(key=lambda r: -LEVELS.index(r["level"]))
    return {"level": LEVELS[level], "label": LABEL[LEVELS[level]], "reasons": reasons, "disclaimer": DISCLAIMER,
            "work_window": window}
