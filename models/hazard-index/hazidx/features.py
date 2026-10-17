"""Hourly weather -> one row of features per plant and local day. Training (ERA5 archive) and the
dry-run (live forecast) both call daily_features, so identical hourly data gives identical features.

Same conventions as the live system (_shared/openmeteo.ts buildReadings and _shared/time.ts):
  - a local day runs from local midnight to the next local midnight (23 or 25 hours at DST changes);
  - overnight rain covers 18:00 the previous day to 06:00, inclusive;
  - WBGT and heat index are missing when temperature or humidity is missing; missing wind or sun
    counts as 0; maxima skip missing hours; a rain sum is missing only when every hour is missing.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from . import config
from .heat import dew_point_f_np, heat_index_f_np, vpd_kpa_np, wbgt_f_np

HOURLY_COLUMNS = config.ARCHIVE_VARS
AUX_COLUMNS = ("n_hours", "rain_trail24_max", "s01_max")


def hourly_from_json(loc: dict, variables=HOURLY_COLUMNS) -> pd.DataFrame:
    """One Open-Meteo location (archive or forecast API; timezone=UTC) -> hourly frame. Missing
    variables and null values become NaN."""
    h = loc.get("hourly") or {}
    if "time" not in h:
        raise ValueError("response has no hourly.time")
    n = len(h["time"])
    df = pd.DataFrame({"time": pd.to_datetime(h["time"], utc=True)})
    for v in variables:
        vals = h.get(v)
        df[v] = np.full(n, np.nan) if vals is None else np.asarray([np.nan if x is None else x for x in vals], dtype="float64")
    return df


def _complete_hours(hourly: pd.DataFrame) -> pd.DataFrame:
    h = hourly.copy()
    h["time"] = pd.to_datetime(h["time"], utc=True)
    h = h.drop_duplicates("time", keep="last").set_index("time").sort_index()
    full = pd.date_range(h.index[0], h.index[-1], freq="h", tz="UTC")
    return h.reindex(full)


def _streak(dry: np.ndarray, known: np.ndarray) -> np.ndarray:
    """Consecutive dry days ending on each day; missing until the first known wet day."""
    out = np.full(len(dry), np.nan)
    run = np.nan
    for i in range(len(dry)):
        if not known[i]:
            run = np.nan
        elif dry[i]:
            run = run + 1
        else:
            run = 0.0
        out[i] = run
    return out


def daily_features(hourly: pd.DataFrame, tz: str) -> pd.DataFrame:
    """`hourly` has a UTC `time` column and the ARCHIVE_VARS columns (soil_moisture_0_to_1cm is
    optional and only feeds the dry-run soil rule). Returns one row per local date, indexed by date."""
    h = _complete_hours(hourly)
    for c in HOURLY_COLUMNS:
        if c not in h:
            h[c] = np.nan
    t, rh = h["temperature_2m"].to_numpy(float), h["relative_humidity_2m"].to_numpy(float)
    rain = h["precipitation"]
    local = h.index.tz_convert(tz)
    hour = np.asarray(local.hour)
    day = local.tz_localize(None).normalize()
    hv = pd.DataFrame({
        "day": day,
        "temp": t, "rh": rh,
        "wbgt": wbgt_f_np(t, rh, h["wind_speed_10m"].to_numpy(float), h["shortwave_radiation"].to_numpy(float)),
        "hi": np.where(np.isnan(t) | np.isnan(rh), np.nan, heat_index_f_np(t, rh)),
        "td": dew_point_f_np(t, rh),
        "vpd": vpd_kpa_np(t, rh),
        "gust": h["wind_gusts_10m"].to_numpy(float),
        "wind": h["wind_speed_10m"].to_numpy(float),
        "rain": rain.to_numpy(float),
        "sw": h["shortwave_radiation"].to_numpy(float),
        "sm07": h["soil_moisture_0_to_7cm"].to_numpy(float),
        "sm728": h["soil_moisture_7_to_28cm"].to_numpy(float),
        "pdrop": (h["pressure_msl"].shift(24) - h["pressure_msl"]).to_numpy(float),
        "trail24": rain.rolling(24, min_periods=1).sum().where(rain.notna().rolling(24, min_periods=1).sum() > 0).to_numpy(float),
        "s01": h["soil_moisture_0_to_1cm"].to_numpy(float) if "soil_moisture_0_to_1cm" in h else np.nan,
    })
    hv["wbgt"] = np.where(np.isnan(t) | np.isnan(rh), np.nan, hv["wbgt"])
    # Overnight window of day D: 18:00-23:59 on D-1 and 00:00-06:00 on D (local). Assigning by local
    # hour equals the UTC window [zonedToUtc(D-1, 18), zonedToUtc(D, 6)], DST days included.
    night_day = pd.Series(pd.NaT, index=hv.index, dtype="datetime64[ns]")
    night_day[hour >= 18] = day[hour >= 18] + pd.Timedelta(days=1)
    night_day[hour <= 6] = day[hour <= 6]
    hv["night_day"] = night_day
    hv["wbgt85"] = np.where(np.isnan(hv["wbgt"]), np.nan, (hv["wbgt"] >= 85).astype(float))
    hv["rain1"] = np.where(np.isnan(hv["rain"]), np.nan, (hv["rain"] >= 1.0).astype(float))

    g = hv.groupby("day")
    d = pd.DataFrame({
        "n_hours": g["temp"].count(),
        "wbgt_max": g["wbgt"].max(), "hi_max": g["hi"].max(),
        "t_max": g["temp"].max(), "t_min": g["temp"].min(), "td_max": g["td"].max(), "rh_min": g["rh"].min(),
        "wbgt_hours_85": g["wbgt85"].sum(min_count=1),
        "gust_max": g["gust"].max(), "wind_max": g["wind"].max(), "rain_hr_max": g["rain"].max(),
        "p_drop_24h": g["pdrop"].max(), "sw_sum": g["sw"].sum(min_count=1) / 1000.0,
        "rain_24h": g["rain"].sum(min_count=1), "rain_hours_1mm": g["rain1"].sum(min_count=1),
        "sm07_mean": g["sm07"].mean(), "sm07_max": g["sm07"].max(), "sm728_mean": g["sm728"].mean(),
        "vpd_max": g["vpd"].max(), "rain_trail24_max": g["trail24"].max(), "s01_max": g["s01"].max(),
    })
    night = hv.dropna(subset=["night_day"]).groupby("night_day")["rain"].sum(min_count=1)
    d["rain_overnight"] = night.reindex(d.index)
    # A night is complete only when its 18:00 hour is in the data.
    first_hour = h.index[0].tz_convert(tz)
    first_night = pd.Timestamp(first_hour.date()) + pd.Timedelta(days=1 if first_hour.hour <= 18 else 2)
    d.loc[d.index < first_night, "rain_overnight"] = np.nan

    full = pd.date_range(d.index.min(), d.index.max(), freq="D")
    d = d.reindex(full)
    d.index.name = "date"
    complete = d["n_hours"].fillna(0) >= config.MIN_DAY_HOURS
    rain_day = d["rain_24h"].where(complete)
    past = rain_day.shift(1)
    d["rain_prev3d"] = past.rolling(3, min_periods=3).sum()
    d["rain_prev7d"] = past.rolling(7, min_periods=7).sum()
    d["rain_prev30d"] = past.rolling(30, min_periods=30).sum()
    streak = _streak((rain_day < config.DRY_DAY_MM).to_numpy(), rain_day.notna().to_numpy())
    d["dry_days"] = pd.Series(streak, index=d.index).shift(1)
    wb = d["wbgt_max"].where(complete)
    d["wbgt_max_prev2"] = pd.concat([wb.shift(1), wb.shift(2)], axis=1).max(axis=1, skipna=True)
    doy = d.index.dayofyear.to_numpy()
    d["doy_sin"] = np.sin(2 * np.pi * (doy - 1) / 365.25)
    d["doy_cos"] = np.cos(2 * np.pi * (doy - 1) / 365.25)
    d["n_hours"] = d["n_hours"].fillna(0).astype(int)
    return d


def monthly_normals(daily: pd.DataFrame) -> dict[int, dict[str, float]]:
    """Mean daily maximum temperature and heat index per calendar month (from training years only)."""
    m = daily.groupby(daily.index.month)[["t_max", "hi_max"]].mean()
    return {int(k): {"t_max": float(v["t_max"]), "hi_max": float(v["hi_max"])} for k, v in m.iterrows()}


def add_anomalies(daily: pd.DataFrame, normals: dict) -> pd.DataFrame:
    """t_max_anom and hi_max_anom: how much the day exceeds the plant's normal for that month."""
    out = daily.copy()
    months = out.index.month if isinstance(out.index, pd.DatetimeIndex) else pd.to_datetime(out["date"]).dt.month
    nt = np.array([normals.get(int(m), normals.get(str(int(m)), {})).get("t_max", np.nan) for m in months])
    nh = np.array([normals.get(int(m), normals.get(str(int(m)), {})).get("hi_max", np.nan) for m in months])
    out["t_max_anom"] = out["t_max"].to_numpy() - nt
    out["hi_max_anom"] = out["hi_max"].to_numpy() - nh
    return out
