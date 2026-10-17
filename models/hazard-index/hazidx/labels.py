"""Match NOAA Storm Events to plants and local days.

An event matches a plant in one of three ways (see "Labels" in the plan):
  radius     county event with coordinates whose start-to-end track passes within 25 km
  county     county event without coordinates in the plant's county (state + county FIPS)
  zone_code  forecast-zone event in the plant's NWS public forecast zone
  zone_name  forecast-zone event in the same state whose zone name contains the plant's county
             name as a whole word (guards against NWS renumbering zones)
Fire-weather zones are never used. Event times are local standard time (CZ_TIMEZONE, e.g. EST-5);
they are converted to UTC and then to the plant's time zone, and every local date from start to
end is marked, at most EVENT_DAY_CAP days.
"""
from __future__ import annotations

import re
from pathlib import Path

import numpy as np
import pandas as pd

from . import config

COLUMNS = ["BEGIN_YEARMONTH", "BEGIN_DAY", "BEGIN_TIME", "END_YEARMONTH", "END_DAY", "END_TIME",
           "EPISODE_ID", "EVENT_ID", "STATE", "STATE_FIPS", "YEAR", "EVENT_TYPE", "CZ_TYPE", "CZ_FIPS",
           "CZ_NAME", "CZ_TIMEZONE", "BEGIN_LAT", "BEGIN_LON", "END_LAT", "END_LON"]
_TZ = re.compile(r"^([A-Z]+)(-?\d+)?$")
_ABBR_OFFSET = {"EST": -5, "EDT": -4, "CST": -6, "CDT": -5, "MST": -7, "MDT": -6, "PST": -8, "PDT": -7,
                "AKST": -9, "AKDT": -8, "HST": -10, "AST": -4, "SST": -11, "GST": 10}
EARTH_KM = 6371.0088


def event_family(event_type: str) -> str | None:
    if not isinstance(event_type, str):
        return None
    if config.HEAT_PATTERN.match(event_type.strip()):
        return "heat"
    for fam, types in config.EVENT_TYPES.items():
        if event_type.strip() in types:
            return fam
    return None


def tz_offset_hours(code) -> float:
    """'EST-5' -> -5, 'GST10' -> 10, 'CST' -> -6. Unknown codes give NaN."""
    if not isinstance(code, str):
        return np.nan
    m = _TZ.match(code.strip().upper())
    if not m:
        return np.nan
    if m.group(2) is not None:
        return float(m.group(2))
    return float(_ABBR_OFFSET.get(m.group(1), np.nan))


def normalize_name(s) -> str:
    return " ".join(re.sub(r"[^A-Z0-9]+", " ", str(s).upper()).split())


def read_events(files: list[Path]) -> pd.DataFrame:
    """Storm Events rows of the four families, with UTC start and end times. Marine events and
    unparseable times are dropped; latitude or longitude 0 counts as missing."""
    frames = []
    for f in files:
        df = pd.read_csv(f, usecols=COLUMNS, dtype={"CZ_TYPE": str, "CZ_NAME": str, "CZ_TIMEZONE": str,
                                                    "EVENT_TYPE": str, "STATE": str}, low_memory=False)
        frames.append(df)
    ev = pd.concat(frames, ignore_index=True)
    return prepare_events(ev)


def prepare_events(ev: pd.DataFrame) -> pd.DataFrame:
    ev = ev.copy()
    ev["family"] = ev["EVENT_TYPE"].map(event_family)
    marine = (ev["CZ_TYPE"] == "M") | ev["EVENT_TYPE"].fillna("").str.startswith("Marine")
    ev = ev[ev["family"].notna() & ~marine].copy()
    for c in ("BEGIN_LAT", "BEGIN_LON", "END_LAT", "END_LON"):
        ev[c] = pd.to_numeric(ev[c], errors="coerce").replace(0, np.nan)
    # A point with one coordinate missing is no point.
    for a, b in (("BEGIN_LAT", "BEGIN_LON"), ("END_LAT", "END_LON")):
        bad = ev[a].isna() | ev[b].isna()
        ev.loc[bad, [a, b]] = np.nan
    off = ev["CZ_TIMEZONE"].map(tz_offset_hours)
    # Integer columns, not BEGIN_DATE_TIME (2-digit years).
    def stamp(ym, day, hhmm):
        ym, day, hhmm = (pd.to_numeric(x, errors="coerce") for x in (ym, day, hhmm))
        s = (ym // 100).astype("Int64").astype(str) + "-" + (ym % 100).astype("Int64").astype(str).str.zfill(2) + "-" \
            + day.astype("Int64").astype(str).str.zfill(2) + " " + (hhmm // 100).astype("Int64").astype(str).str.zfill(2) \
            + ":" + (hhmm % 100).astype("Int64").astype(str).str.zfill(2)
        return pd.to_datetime(s, format="%Y-%m-%d %H:%M", errors="coerce")
    begin_local = stamp(ev["BEGIN_YEARMONTH"], ev["BEGIN_DAY"], ev["BEGIN_TIME"])
    end_local = stamp(ev["END_YEARMONTH"], ev["END_DAY"], ev["END_TIME"])
    shift = pd.to_timedelta(-off, unit="h")
    ev["begin_utc"] = (begin_local + shift).dt.tz_localize("UTC")
    ev["end_utc"] = (end_local + shift).dt.tz_localize("UTC")
    ev = ev[ev["begin_utc"].notna()].copy()
    ev["end_utc"] = ev["end_utc"].where(ev["end_utc"].notna() & (ev["end_utc"] >= ev["begin_utc"]), ev["begin_utc"])
    ev["STATE_FIPS"] = pd.to_numeric(ev["STATE_FIPS"], errors="coerce").astype("Int64")
    ev["CZ_FIPS"] = pd.to_numeric(ev["CZ_FIPS"], errors="coerce").astype("Int64")
    ev["zone_name_norm"] = ev["CZ_NAME"].map(normalize_name)
    return ev.reset_index(drop=True)


def segment_distance_km(lat0, lon0, lat1, lon1, lat2, lon2) -> np.ndarray:
    """Distance from the plant (lat0, lon0) to the segment from point 1 to point 2 (a point when 2
    is missing), on a local equirectangular projection; accurate to well under 1% at 25 km."""
    k = np.pi / 180 * EARTH_KM
    c = np.cos(np.radians(lat0))
    lat2 = np.where(np.isnan(lat2), lat1, lat2)
    lon2 = np.where(np.isnan(lon2), lon1, lon2)
    x1, y1 = (lon1 - lon0) * c * k, (lat1 - lat0) * k
    x2, y2 = (lon2 - lon0) * c * k, (lat2 - lat0) * k
    dx, dy = x2 - x1, y2 - y1
    L2 = dx * dx + dy * dy
    with np.errstate(invalid="ignore", divide="ignore"):
        t = np.where(L2 > 0, np.clip(-(x1 * dx + y1 * dy) / L2, 0, 1), 0.0)
    px, py = x1 + t * dx, y1 + t * dy
    return np.sqrt(px * px + py * py)


def match_events(ev: pd.DataFrame, site, nws: dict, radius_km: float = config.RADIUS_KM) -> pd.DataFrame:
    """Rows of `ev` that match the plant, with a `method` column. A row matches by one method only,
    in the order radius, county, zone_code, zone_name."""
    county_ev = ev["CZ_TYPE"] == "C"
    has_xy = ev["BEGIN_LAT"].notna()
    out = []
    # radius
    cand = ev[county_ev & has_xy]
    near = (cand["BEGIN_LAT"].sub(site.latitude).abs() < 3) & (cand["BEGIN_LON"].sub(site.longitude).abs() < 4)
    cand = cand[near]
    if len(cand):
        dist = segment_distance_km(site.latitude, site.longitude, cand["BEGIN_LAT"].to_numpy(float),
                                   cand["BEGIN_LON"].to_numpy(float), cand["END_LAT"].to_numpy(float),
                                   cand["END_LON"].to_numpy(float))
        hit = cand[dist <= radius_km].copy()
        hit["method"] = "radius"
        out.append(hit)
    # county without coordinates
    hit = ev[county_ev & ~has_xy & (ev["STATE_FIPS"] == nws["state_fips"]) & (ev["CZ_FIPS"] == nws["county_fips"])].copy()
    hit["method"] = "county"
    out.append(hit)
    # forecast zone, by code then by name
    zone_ev = ev["CZ_TYPE"] == "Z"
    by_code = zone_ev & (ev["STATE_FIPS"] == nws["forecast_zone_state_fips"]) & (ev["CZ_FIPS"] == nws["forecast_zone_number"])
    hit = ev[by_code].copy()
    hit["method"] = "zone_code"
    out.append(hit)
    county = normalize_name(nws["county_name"])
    pattern = re.compile(rf"(^| ){re.escape(county)}( |$)")
    same_state = zone_ev & ~by_code & (ev["STATE_FIPS"] == nws["state_fips"])
    names = ev.loc[same_state, "zone_name_norm"]
    hit = ev.loc[names.index[names.map(lambda n: bool(pattern.search(n)))]].copy()
    hit["method"] = "zone_name"
    out.append(hit)
    return pd.concat(out, ignore_index=True)


def event_days(matched: pd.DataFrame, tz: str, cap: int = config.EVENT_DAY_CAP) -> pd.DataFrame:
    """One row per (event, local date at the plant), from start to end, at most `cap` dates."""
    if matched.empty:
        return pd.DataFrame(columns=["EVENT_ID", "family", "method", "date"])
    start = matched["begin_utc"].dt.tz_convert(tz).dt.tz_localize(None).dt.normalize()
    end = matched["end_utc"].dt.tz_convert(tz).dt.tz_localize(None).dt.normalize()
    n = ((end - start).dt.days + 1).clip(lower=1, upper=cap).to_numpy()
    idx = np.repeat(np.arange(len(matched)), n)
    offs = np.concatenate([np.arange(k) for k in n])
    days = start.to_numpy()[idx] + offs.astype("timedelta64[D]")
    return pd.DataFrame({"EVENT_ID": matched["EVENT_ID"].to_numpy()[idx], "family": matched["family"].to_numpy()[idx],
                         "method": matched["method"].to_numpy()[idx], "date": pd.to_datetime(days)})


def daily_labels(days: pd.DataFrame) -> pd.DataFrame:
    """date x family 0/1 table from event_days output."""
    if days.empty:
        return pd.DataFrame(columns=[f"y_{f}" for f in config.FAMILIES])
    t = days.assign(v=1).pivot_table(index="date", columns="family", values="v", aggfunc="max", fill_value=0)
    t = t.reindex(columns=list(config.FAMILIES), fill_value=0).astype(int)
    t.columns = [f"y_{c}" for c in t.columns]
    return t
