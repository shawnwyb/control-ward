"""Hourly forecast around a site (Open-Meteo), sunrise and sunset, and National Weather Service alerts and text.

The ring of seven points and the UTC hour grid match supabase/functions/_shared/briefing.ts, so the
work window here equals the one in the existing next-day plan. Extra variables (CAPE, UV, apparent
temperature) are only used for display and the storm strip."""
from __future__ import annotations

import math
from datetime import datetime, timezone
from typing import Any

from hazidx.sites import Site

from .fetch import Fetcher, SourceUnavailable

FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
NWS_BASE = "https://api.weather.gov"
HOURLY_VARS = ("temperature_2m", "relative_humidity_2m", "apparent_temperature", "wind_speed_10m",
               "wind_gusts_10m", "shortwave_radiation", "precipitation", "precipitation_probability",
               "cape", "uv_index")


def ring_points(lat: float, lon: float, km: float = 20.0, count: int = 6) -> list[tuple[float, float]]:
    """Centre plus `count` points on a circle (briefing.ts ringPoints)."""
    pts = [(lat, lon)]
    d_lat = km / 111.32
    d_lon = km / (111.32 * max(math.cos(math.radians(lat)), 0.05))
    for i in range(count):
        a = 2 * math.pi * i / count
        pts.append((max(-90.0, min(90.0, lat + d_lat * math.sin(a))), lon + d_lon * math.cos(a)))
    return pts


def fetch_hourly(f: Fetcher, site: Site) -> list[dict]:
    """One dict per ring point: {"hourly": {"time": [...UTC...], <var>: [...]}} in °F, mph, mm."""
    ring = ring_points(site.latitude, site.longitude)
    data = f.get_json(f"openmeteo_hourly_{site.eia_plant_id}", FORECAST_URL, {
        "latitude": ",".join(f"{p[0]:.4f}" for p in ring),
        "longitude": ",".join(f"{p[1]:.4f}" for p in ring),
        "hourly": ",".join(HOURLY_VARS),
        "temperature_unit": "fahrenheit", "wind_speed_unit": "mph", "precipitation_unit": "mm",
        "timezone": "UTC", "past_days": 1, "forecast_days": 4,
    })
    locations = data if isinstance(data, list) else [data]
    if not locations or any("hourly" not in loc for loc in locations):
        raise SourceUnavailable("Open-Meteo answered without hourly data")
    return locations


def fetch_sun(f: Fetcher, site: Site) -> dict[str, dict[str, str]]:
    """{local date: {"sunrise": "HH:MM", "sunset": "HH:MM"}} in the site's own time zone."""
    data = f.get_json(f"openmeteo_sun_{site.eia_plant_id}", FORECAST_URL, {
        "latitude": f"{site.latitude:.4f}", "longitude": f"{site.longitude:.4f}",
        "daily": "sunrise,sunset", "timezone": site.timezone, "forecast_days": 4,
    })
    d = data.get("daily") or {}
    return {day: {"sunrise": rise[11:16], "sunset": sets[11:16]}
            for day, rise, sets in zip(d.get("time", []), d.get("sunrise", []), d.get("sunset", []))}


# ---------------------------------------------------------------- National Weather Service

def _ms(iso: str | None) -> int | None:
    if not iso:
        return None
    return int(datetime.fromisoformat(iso).astimezone(timezone.utc).timestamp() * 1000)


def parse_alerts(payload: dict, day_start_ms: int, day_end_ms: int) -> list[dict]:
    """Active alerts whose time span overlaps [day_start, day_end). Alerts with no end are kept."""
    out = []
    for feat in payload.get("features", []):
        p = feat.get("properties", {})
        start = _ms(p.get("onset")) or _ms(p.get("effective"))
        end = _ms(p.get("ends")) or _ms(p.get("expires"))
        if (start is not None and start >= day_end_ms) or (end is not None and end <= day_start_ms):
            continue
        out.append({
            "event": p.get("event"), "severity": p.get("severity"), "urgency": p.get("urgency"),
            "headline": p.get("headline"), "starts": p.get("onset") or p.get("effective"),
            "ends": p.get("ends") or p.get("expires"), "sender": p.get("senderName"),
        })
    rank = {"Extreme": 0, "Severe": 1, "Moderate": 2, "Minor": 3}
    return sorted(out, key=lambda a: (rank.get(a["severity"] or "", 4), a["starts"] or ""))


def fetch_alerts(f: Fetcher, site: Site, day_start_ms: int, day_end_ms: int) -> list[dict]:
    payload = f.get_json(f"nws_alerts_{site.eia_plant_id}", f"{NWS_BASE}/alerts/active",
                         {"point": f"{site.latitude:.4f},{site.longitude:.4f}"})
    return parse_alerts(payload, day_start_ms, day_end_ms)


def parse_periods(payload: dict, day_start_ms: int, day_end_ms: int) -> list[dict]:
    out = []
    for p in payload.get("properties", {}).get("periods", []):
        start, end = _ms(p.get("startTime")), _ms(p.get("endTime"))
        if start is None or end is None or start >= day_end_ms or end <= day_start_ms:
            continue
        out.append({"name": p.get("name"), "daytime": bool(p.get("isDaytime")), "starts": p.get("startTime"),
                    "temperature_f": p.get("temperature"), "short": p.get("shortForecast"),
                    "detail": p.get("detailedForecast")})
    return out


def fetch_text(f: Fetcher, site: Site, day_start_ms: int, day_end_ms: int) -> list[dict]:
    point = f.get_json(f"nws_point_{site.eia_plant_id}", f"{NWS_BASE}/points/{site.latitude:.4f},{site.longitude:.4f}")
    url = (point.get("properties") or {}).get("forecast")
    if not url:
        raise SourceUnavailable("NWS has no forecast grid for this point")
    return parse_periods(f.get_json(f"nws_forecast_{site.eia_plant_id}", url), day_start_ms, day_end_ms)


def day_bounds(for_date: str, tz: str) -> tuple[int, int]:
    """UTC ms of local midnight at the start and end of `for_date` (23 to 25 hours long)."""
    from hazidx import localtime
    return localtime.zoned_to_utc(for_date, 0, tz), localtime.zoned_to_utc(localtime.add_days(for_date, 1), 0, tz)


def parse_utc_hours(location: dict) -> list[int]:
    """Open-Meteo UTC strings like '2026-10-19T14:00' to epoch ms."""
    return [int(datetime.fromisoformat(t + ":00+00:00").timestamp() * 1000) for t in location["hourly"]["time"]]


def value_at(location: dict, var: str, idx: int) -> float | None:
    arr: list[Any] = location["hourly"].get(var) or []
    v = arr[idx] if 0 <= idx < len(arr) else None
    return float(v) if isinstance(v, (int, float)) and math.isfinite(v) else None
