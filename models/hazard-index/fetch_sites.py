#!/usr/bin/env python3
"""Look up each plant's NWS county and public forecast zone (api.weather.gov), so Storm Events
records filed by county or by zone can be matched to plants. Public, no API key; NWS asks for a
User-Agent that identifies the application.

  points: https://api.weather.gov/points/{lat},{lon}
  zones:  https://api.weather.gov/zones/{county|forecast}/{id}

Fire-weather zones are recorded but never used for matching, because their numbers differ from
forecast-zone numbers.

Usage
  python fetch_sites.py               # -> artifacts/sites_nws.json

Exit codes: 0 ok, 1 error, 2 blocked by network policy.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

from hazidx import config, paths
from hazidx.http import BlockedError, Client, FetchError, utc_now_iso, write_manifest
from hazidx.sites import load_sites
from hazidx.states import STATES

POINTS_URL = "https://api.weather.gov/points/{lat:.4f},{lon:.4f}"


def zone_id(url: str | None) -> str | None:
    return url.rstrip("/").rsplit("/", 1)[-1] if url else None


def lookup(c: Client, lat: float, lon: float, pause: float = 0.2) -> dict:
    p = c.get_json(POINTS_URL.format(lat=lat, lon=lon))["properties"]
    county, zone = zone_id(p.get("county")), zone_id(p.get("forecastZone"))
    if not county or not zone:
        raise FetchError(f"no county or forecast zone for {lat},{lon}")
    time.sleep(pause)
    cz = c.get_json(p["county"])["properties"]
    time.sleep(pause)
    fz = c.get_json(p["forecastZone"])["properties"]
    state = county[:2]
    if state not in STATES:
        raise FetchError(f"unknown state {state} for {lat},{lon}")
    return {
        "state": state, "state_fips": STATES[state][0],
        "county_zone": county, "county_fips": int(county[3:]), "county_name": cz.get("name"),
        "forecast_zone": zone, "forecast_zone_state_fips": STATES[zone[:2]][0],
        "forecast_zone_number": int(zone[3:]), "forecast_zone_name": fz.get("name"),
        "fire_zone": zone_id(p.get("fireWeatherZone")), "cwa": p.get("cwa"),
    }


def main(argv: list[str] | None = None, client: Client | None = None) -> int:
    ap = argparse.ArgumentParser(description="NWS county and forecast zone for each plant")
    ap.add_argument("--out", type=Path, default=paths.SITES_NWS)
    args = ap.parse_args(argv)
    c = client or Client(user_agent=config.NWS_USER_AGENT)
    try:
        out = {}
        for s in load_sites():
            rec = lookup(c, s.latitude, s.longitude)
            out[s.eia_plant_id] = {"name": s.name, **rec}
            print(f"{s.eia_plant_id:>6} {s.name[:28]:<28} {rec['county_zone']} {rec['county_name']:<16} "
                  f"{rec['forecast_zone']} {rec['forecast_zone_name']}")
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(json.dumps({"retrieved_at": utc_now_iso(), "sites": out}, indent=1))
        write_manifest(args.out, len(out), {}, "https://api.weather.gov", c.log)
        print(f"wrote {args.out} ({len(out)} plants)")
        return 0
    except BlockedError as exc:
        print(f"BLOCKED (policy denial, not retried): {exc}", file=sys.stderr)
        return 2
    except FetchError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
