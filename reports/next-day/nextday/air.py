"""Air quality and smoke section. Open-Meteo air quality is a model forecast (CAMS), not a sensor reading.
Wildfire distance uses the same NIFC incident layer as supabase/functions/ingest-wildfire."""
from __future__ import annotations

from datetime import datetime

from hazidx import localtime
from hazidx.sites import Site

from .fetch import Fetcher, SourceUnavailable
from .stations import haversine_km
from .weather_plan import WORKDAY

AQ_URL = "https://air-quality-api.open-meteo.com/v1/air-quality"
NIFC_URL = ("https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/"
            "WFIGS_Incident_Locations_Current/FeatureServer/0/query")
KM_PER_MI = 1.609344
# US EPA Air Quality Index categories (airnow.gov/aqi/aqi-basics): lower bound, name, who is affected.
AQI_BANDS = (
    (301, "Hazardous", "Everyone may have serious health effects."),
    (201, "Very unhealthy", "Everyone may have health effects. Sensitive groups may have serious effects."),
    (151, "Unhealthy", "Everyone may begin to have health effects. Sensitive groups may have more serious effects."),
    (101, "Unhealthy for sensitive groups", "People with lung or heart disease, older adults and children are the most at risk."),
    (51, "Moderate", "Air quality is acceptable. Some people who are unusually sensitive may be affected."),
    (0, "Good", "Air quality is satisfactory."),
)
SMOKE_WORDS = ("air quality", "smoke", "air stagnation")


def band(aqi: float | None) -> dict | None:
    if aqi is None:
        return None
    lo, name, text = next(b for b in AQI_BANDS if aqi >= b[0])
    return {"min": lo, "name": name, "meaning": text}


def fetch_fires(f: Fetcher) -> list[dict]:
    body = f.get_json("nifc_fires", NIFC_URL, {
        "where": "IncidentTypeCategory='WF' AND (PercentContained IS NULL OR PercentContained<100)",
        "outFields": "IncidentName,IncidentSize,PercentContained", "outSR": "4326", "f": "json", "resultRecordCount": "2000"})
    fires = []
    for ft in body.get("features", []):
        g, a = ft.get("geometry"), ft.get("attributes") or {}
        if not g or g.get("x") is None or g.get("y") is None:
            continue
        pct, size = a.get("PercentContained"), a.get("IncidentSize")
        if (pct is not None and pct >= 100) or (size is not None and size < 10):
            continue
        fires.append({"lat": g["y"], "lon": g["x"], "name": a.get("IncidentName"), "acres": size, "contained": pct})
    return fires


def nearest_fires(site: Site, fires: list[dict]) -> dict:
    ds = sorted(((haversine_km(site.latitude, site.longitude, x["lat"], x["lon"]) / KM_PER_MI, x) for x in fires), key=lambda p: p[0])
    near = ds[0] if ds else None
    return {"nearest_mi": None if near is None else round(near[0], 1),
            "nearest_name": None if near is None else near[1]["name"],
            "within_25_mi": sum(1 for d, _ in ds if d <= 25)}


def hourly(f: Fetcher, site: Site, for_date: str) -> list[dict]:
    data = f.get_json(f"openmeteo_air_{site.eia_plant_id}", AQ_URL, {
        "latitude": f"{site.latitude:.4f}", "longitude": f"{site.longitude:.4f}",
        "hourly": "us_aqi,pm2_5,pm10", "timezone": "UTC", "forecast_days": 4, "past_days": 1})
    h = data.get("hourly") or {}
    if not h.get("time"):
        raise SourceUnavailable("Open-Meteo air quality answered without hourly data")
    index = {int(datetime.fromisoformat(t + ":00+00:00").timestamp() * 1000): i for i, t in enumerate(h["time"])}
    out = []
    for hour in range(24):
        i = index.get(localtime.zoned_to_utc(for_date, hour, site.timezone))
        pick = lambda k: (h.get(k) or [None] * (i + 1))[i] if i is not None else None
        out.append({"hour": hour, "us_aqi": pick("us_aqi"), "pm2_5": pick("pm2_5"), "pm10": pick("pm10")})
    return out


def build(f: Fetcher, site: Site, for_date: str, fires: list[dict] | None, alerts: list[dict], p_fire: float | None) -> dict:
    notes = ["Air quality is a model forecast, not a sensor reading."]
    try:
        hrs = hourly(f, site, for_date)
    except SourceUnavailable as e:
        hrs, notes = [], notes + [str(e)]
    lo, hi = WORKDAY
    work = [h for h in hrs if lo <= h["hour"] < hi and h["us_aqi"] is not None]
    peak = max(work, key=lambda h: (h["us_aqi"], -h["hour"]), default=None)
    smoke = [a for a in alerts if any(w in (a.get("event") or "").lower() for w in SMOKE_WORDS)]
    fire = nearest_fires(site, fires) if fires is not None else None
    if not hrs and fire is None:
        return {"status": "missing", "reason": notes[-1]}
    return {
        "status": "ok" if hrs else "missing", "hours": hrs,
        "peak": None if peak is None else {"hour": peak["hour"], "us_aqi": peak["us_aqi"], "pm2_5": peak["pm2_5"], "band": band(peak["us_aqi"])},
        "bands": [{"min": b[0], "name": b[1], "meaning": b[2]} for b in reversed(AQI_BANDS)],
        "alerts": smoke, "wildfire": fire, "hazard_index_fire_probability": p_fire,
        "notes": notes, "source": {"name": "Open-Meteo air quality (CAMS) and the AirNow AQI scale", "url": "https://open-meteo.com/en/docs/air-quality-api"},
    }
