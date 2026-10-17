"""Open-Meteo soil moisture, soil temperature and rain for all sites in one request, reduced to model horizons.

theta is the mean of the 3-9 cm and 9-27 cm layers (the study sampled the top 15 cm). The central value is
best_match. The forecast range is the min and max across the models that publish both layers; it is kept
separate from the ground-response band, as plan.md asks.
"""
from __future__ import annotations

import hashlib
import json
import warnings
from datetime import datetime, timedelta, timezone

import httpx
import numpy as np

from . import config as C
from .net import get_with_retry
from .sites import Site

URL = "https://api.open-meteo.com/v1/forecast"
LAYERS = ("soil_moisture_3_to_9cm", "soil_moisture_9_to_27cm")


def fetch(sites: list[Site], client: httpx.Client, now: datetime) -> list[dict]:
    """One request for every site, cached per UTC hour."""
    key = hashlib.sha1(",".join(s.eia for s in sites).encode()).hexdigest()[:10]
    path = C.CACHE / f"weather_{now.astimezone(timezone.utc):%Y%m%dT%H}_{key}.json"
    if path.exists():
        return json.loads(path.read_text())
    params = {
        "latitude": ",".join(f"{s.lat:.4f}" for s in sites),
        "longitude": ",".join(f"{s.lon:.4f}" for s in sites),
        "hourly": ",".join((*LAYERS, "soil_temperature_6cm", "precipitation")),
        "models": ",".join(C.OPEN_METEO_MODELS),
        "temperature_unit": "fahrenheit", "precipitation_unit": "inch",
        "timezone": "auto", "past_days": 3, "forecast_days": C.FORECAST_DAYS + 1,
    }
    data = get_with_retry(client, URL, params=params).json()
    data = data if isinstance(data, list) else [data]
    if len(data) != len(sites):
        raise RuntimeError(f"Open-Meteo returned {len(data)} locations for {len(sites)} sites")
    C.CACHE.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data))
    return data


def _series(hourly: dict, var: str, model: str) -> np.ndarray:
    v = hourly.get(f"{var}_{model}") or hourly.get(var) or []
    return np.array([np.nan if x is None else x for x in v], dtype=float)


def horizons(loc: dict, now: datetime) -> list[dict]:
    """'now' plus one entry per local day d1..dN (d1 = tomorrow). Each has theta (central, min, max), the 72 h
    antecedent plus same-day rain in inches, and whether the soil is frozen."""
    h = loc["hourly"]
    offset = timedelta(seconds=loc.get("utc_offset_seconds", 0))
    local_now = (now.astimezone(timezone.utc) + offset).replace(tzinfo=None)
    times = np.array([datetime.fromisoformat(t) for t in h["time"]])
    with warnings.catch_warnings():  # hours where a model has neither layer stay NaN
        warnings.simplefilter("ignore", RuntimeWarning)
        theta = np.stack([np.nanmean(np.stack([_series(h, layer, m) for layer in LAYERS]), axis=0)
                          for m in C.OPEN_METEO_MODELS])  # (models, hours)
    rain = np.nan_to_num(_series(h, "precipitation", "best_match"))
    soil_t = _series(h, "soil_temperature_6cm", "best_match")

    def pack(key, label, mask, rain_mask, date):
        th = theta[:, mask]
        central = th[0][~np.isnan(th[0])]
        per_model = [np.nanmean(row) for row in th if np.isfinite(row).any()]
        if not len(central) or not per_model:
            return None
        return {"key": key, "label": label, "date": date, "theta": float(np.mean(central)),
                "theta_min": float(min(per_model)), "theta_max": float(max(per_model)),
                "rain_in": float(rain[rain_mask].sum()),
                "frozen": bool(np.nanmin(soil_t[mask]) < 32.0) if np.isfinite(soil_t[mask]).any() else False}

    out = []
    past = times <= local_now
    if past.any():
        i = int(np.where(past)[0][-1])
        now_mask = np.zeros(len(times), bool)
        now_mask[i] = True
        rec = pack("now", f"Now ({times[i]:%a %H:%M} local)", now_mask,
                   (times > times[i] - timedelta(hours=72)) & (times <= times[i]), times[i].date().isoformat())
        if rec:
            out.append(rec)
    today = local_now.date()
    for k in range(1, C.FORECAST_DAYS + 1):
        day = today + timedelta(days=k)
        start = datetime.combine(day, datetime.min.time())
        mask = (times >= start) & (times < start + timedelta(days=1))
        rec = pack(f"d{k}", ("Tomorrow " if k == 1 else "") + f"{day:%a %b %d}", mask,
                   (times >= start - timedelta(days=3)) & (times < start + timedelta(days=1)), day.isoformat())
        if rec:
            out.append(rec)
    return out
