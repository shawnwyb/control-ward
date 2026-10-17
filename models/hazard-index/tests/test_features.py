import unittest
from datetime import datetime, timedelta, timezone

import numpy as np
import pandas as pd

from hazidx import config
from hazidx.features import add_anomalies, daily_features, hourly_from_json, monthly_normals

NY = "America/New_York"


def ts_fixture() -> dict:
    """The location() fixture of tests/functions/shared.test.mjs (120 hours from 2026-10-15T00Z)."""
    start = datetime(2026, 10, 15, tzinfo=timezone.utc)
    hourly = {"time": [], "temperature_2m": [], "relative_humidity_2m": [], "wind_speed_10m": [],
              "wind_gusts_10m": [], "shortwave_radiation": [], "precipitation": [],
              "precipitation_probability": [], "soil_moisture_0_to_1cm": []}
    for i in range(120):
        hourly["time"].append((start + timedelta(hours=i)).strftime("%Y-%m-%dT%H:%M"))
        hourly["temperature_2m"].append(92)
        hourly["relative_humidity_2m"].append(60)
        hourly["wind_speed_10m"].append(5)
        hourly["wind_gusts_10m"].append(45 if i == 84 else 12)
        hourly["shortwave_radiation"].append(700)
        hourly["precipitation"].append(6 if 52 <= i <= 56 else 0)
        hourly["precipitation_probability"].append(20)
        hourly["soil_moisture_0_to_1cm"].append(0.42)
    return {"hourly": hourly}


def synthetic(start: str, hours: int, **values) -> pd.DataFrame:
    t = pd.date_range(start, periods=hours, freq="h", tz="UTC")
    df = pd.DataFrame({"time": t})
    for v in config.ARCHIVE_VARS:
        df[v] = values.get(v, 1.0)
    return df


class FeaturesTest(unittest.TestCase):
    def test_typescript_fixture(self):
        cols = config.ARCHIVE_VARS + ("soil_moisture_0_to_1cm",)
        d = daily_features(hourly_from_json(ts_fixture(), cols), NY)
        today, tomorrow = d.loc["2026-10-17"], d.loc["2026-10-18"]
        self.assertEqual(today["rain_overnight"], 30)       # hours 52..56 inside 18:00-06:00
        self.assertEqual(today["rain_24h"], 30)
        self.assertEqual(tomorrow["gust_max"], 45)          # hour 84 = 08:00 EDT on 18 October
        self.assertGreater(today["wbgt_max"], 85)
        self.assertEqual(today["wbgt_hours_85"], 24)
        self.assertEqual(today["s01_max"], 0.42)
        self.assertEqual(today["n_hours"], 24)
        self.assertEqual(today["rain_hr_max"], 6)
        self.assertEqual(today["rain_hours_1mm"], 5)

    def test_dst_days_have_23_and_25_hours(self):
        fall = daily_features(synthetic("2025-10-31T00:00", 24 * 5), NY)
        self.assertEqual(fall.loc["2025-11-02", "n_hours"], 25)
        self.assertEqual(fall.loc["2025-11-02", "rain_24h"], 25)
        self.assertEqual(fall.loc["2025-11-02", "rain_overnight"], 14)   # 18:00..06:00 with 01:00 twice
        self.assertEqual(fall.loc["2025-11-01", "n_hours"], 24)
        spring = daily_features(synthetic("2025-03-07T00:00", 24 * 5), NY)
        self.assertEqual(spring.loc["2025-03-09", "n_hours"], 23)
        self.assertEqual(spring.loc["2025-03-09", "rain_24h"], 23)
        self.assertEqual(spring.loc["2025-03-09", "rain_overnight"], 12)  # 02:00 does not exist

    def test_archive_and_forecast_input_identical(self):
        hourly = synthetic("2024-07-01T00:00", 24 * 40)
        rng = np.random.default_rng(1)
        for v in config.ARCHIVE_VARS:
            hourly[v] = rng.uniform(0, 1, len(hourly)) * {"temperature_2m": 100, "relative_humidity_2m": 100,
                                                            "pressure_msl": 1000}.get(v, 10)
        as_json = {"hourly": {"time": hourly["time"].dt.strftime("%Y-%m-%dT%H:%M").tolist(),
                              **{v: hourly[v].tolist() for v in config.ARCHIVE_VARS}}}
        archive = daily_features(hourly, "America/Chicago")
        # Forecast responses carry extra variables and the past days first; the result must not change.
        as_json["hourly"]["precipitation_probability"] = [10] * len(hourly)
        forecast = daily_features(hourly_from_json(as_json), "America/Chicago")
        pd.testing.assert_frame_equal(archive, forecast)

    def test_past_windows_and_missing_values(self):
        h = synthetic("2024-06-01T05:00", 24 * 40, precipitation=0.0)
        h.loc[h["time"] == pd.Timestamp("2024-06-20T15:00", tz="UTC"), "precipitation"] = 5.0
        h.loc[h.index[100:110], "temperature_2m"] = np.nan
        d = daily_features(h, NY)
        self.assertEqual(d.loc["2024-06-21", "rain_prev3d"], 5.0)
        self.assertEqual(d.loc["2024-06-24", "rain_prev3d"], 0.0)
        self.assertEqual(d.loc["2024-06-27", "rain_prev7d"], 5.0)
        self.assertEqual(d.loc["2024-06-21", "dry_days"], 0)
        self.assertEqual(d.loc["2024-06-25", "dry_days"], 4)
        self.assertTrue(np.isnan(d.loc["2024-06-05", "rain_prev7d"]))   # not enough history yet
        self.assertTrue(np.isnan(d.loc["2024-06-01", "rain_overnight"]))  # its 18:00 hour is missing
        # Missing temperature: WBGT skips those hours, it does not become 0.
        self.assertGreater(d.loc["2024-06-05", "n_hours"], 0)

    def test_anomalies(self):
        d = daily_features(synthetic("2024-06-01T05:00", 24 * 70), NY)
        normals = monthly_normals(d)
        a = add_anomalies(d, normals)
        self.assertAlmostEqual(float(a["t_max_anom"].abs().max()), 0.0)
        self.assertEqual(set(normals), {6, 7, 8})


if __name__ == "__main__":
    unittest.main()
