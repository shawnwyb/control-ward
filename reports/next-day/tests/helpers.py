"""Shared test fixtures: a stub fetcher that serves canned payloads and fails everything else."""
from __future__ import annotations

import math
from datetime import datetime, timedelta, timezone

from nextday.fetch import Fetcher, SourceUnavailable


def openmeteo_location(start_utc: str, hours: int = 96, hot: float = 70.0) -> dict:
    t0 = datetime.fromisoformat(start_utc).replace(tzinfo=timezone.utc)
    h = {"time": [], "temperature_2m": [], "relative_humidity_2m": [], "apparent_temperature": [], "wind_speed_10m": [],
         "wind_gusts_10m": [], "shortwave_radiation": [], "precipitation": [], "precipitation_probability": [],
         "cape": [], "uv_index": []}
    for i in range(hours):
        d = t0 + timedelta(hours=i)
        day = math.sin(((d.hour - 8) / 24) * 2 * math.pi)
        h["time"].append(d.strftime("%Y-%m-%dT%H:%M"))
        h["temperature_2m"].append(round(hot + 12 * day))
        h["relative_humidity_2m"].append(60)
        h["apparent_temperature"].append(round(hot + 12 * day + 2))
        h["wind_speed_10m"].append(6.0)
        h["wind_gusts_10m"].append(12.0)
        h["shortwave_radiation"].append(max(0, round(800 * day)))
        h["precipitation"].append(0.0)
        h["precipitation_probability"].append(10)
        h["cape"].append(300)
        h["uv_index"].append(max(0, round(8 * day, 1)))
    return {"hourly": h}


class StubFetcher(Fetcher):
    """Serves `payloads` by key prefix. Anything else raises SourceUnavailable, like a dead source."""

    def __init__(self, payloads: dict[str, object], stamp: str = "20261018T220000Z"):
        super().__init__(stamp, offline=True)
        self.payloads = payloads

    def _find(self, key: str):
        for prefix, data in self.payloads.items():
            if key.startswith(prefix):
                return data
        raise SourceUnavailable(f"stub has no payload for '{key}'")

    def get_json(self, key, url, params=None, *, retries=3, timeout=None):
        data = self._find(key)
        self.sources[key] = {"url": url, "fetched_at": "2026-10-18T22:00:00Z"}
        return data

    def cached(self, key, producer, url=""):
        data = self._find(key)
        self.sources[key] = {"url": url, "fetched_at": "2026-10-18T22:00:00Z"}
        return data
