import unittest

import numpy as np
import pandas as pd

from hazidx import labels
from hazidx.sites import Site

# West County Energy Center (Palm Beach County FL, zone FLZ067), as in artifacts/sites_nws.json.
SITE = Site("West County Energy Center", 26.6986, -80.3747, "America/New_York", "56407", None, None, "AO",
            11838, None, None)
NWS = {"state_fips": 12, "county_fips": 99, "county_name": "Palm Beach", "forecast_zone_state_fips": 12,
       "forecast_zone_number": 67}
KM_LAT = 1 / 111.2  # degrees of latitude per km


def row(event_id, event_type, cz_type="C", state_fips=12, cz_fips=99, cz_name="PALM BEACH",
        begin=(202408, 14, 1200), end=None, tz="EST-5", lat=None, lon=None, lat2=None, lon2=None):
    end = end or begin
    return {"BEGIN_YEARMONTH": begin[0], "BEGIN_DAY": begin[1], "BEGIN_TIME": begin[2],
            "END_YEARMONTH": end[0], "END_DAY": end[1], "END_TIME": end[2], "EPISODE_ID": 1,
            "EVENT_ID": event_id, "STATE": "FLORIDA", "STATE_FIPS": state_fips, "YEAR": begin[0] // 100,
            "EVENT_TYPE": event_type, "CZ_TYPE": cz_type, "CZ_FIPS": cz_fips, "CZ_NAME": cz_name,
            "CZ_TIMEZONE": tz, "BEGIN_LAT": lat, "BEGIN_LON": lon, "END_LAT": lat2, "END_LON": lon2}


def run(rows):
    ev = labels.prepare_events(pd.DataFrame(rows))
    m = labels.match_events(ev, SITE, NWS)
    return ev, m, labels.event_days(m, SITE.timezone)


class LabelsTest(unittest.TestCase):
    def test_family_mapping(self):
        self.assertEqual(labels.event_family("Excessive Heat"), "heat")
        self.assertEqual(labels.event_family("Extreme Heat"), "heat")
        self.assertEqual(labels.event_family("Heat"), "heat")
        self.assertIsNone(labels.event_family("Heat Wave"))
        self.assertEqual(labels.event_family("Thunderstorm Wind"), "storm")
        self.assertEqual(labels.event_family("Heavy Rain"), "flood")
        self.assertEqual(labels.event_family("Dense Smoke"), "fire")
        self.assertIsNone(labels.event_family("Coastal Flood"))
        self.assertEqual(labels.tz_offset_hours("EST-5"), -5)
        self.assertEqual(labels.tz_offset_hours("GST10"), 10)
        self.assertEqual(labels.tz_offset_hours("CST"), -6)

    def test_radius(self):
        lat = SITE.latitude
        rows = [row(1, "Hail", lat=lat + 24 * KM_LAT, lon=SITE.longitude, cz_fips=11),
                row(2, "Hail", lat=lat + 26 * KM_LAT, lon=SITE.longitude, cz_fips=11)]
        _, m, _ = run(rows)
        self.assertEqual(m["EVENT_ID"].tolist(), [1])
        self.assertEqual(m["method"].tolist(), ["radius"])

    def test_tornado_track_crossing_plant(self):
        # Both ends 40 km away, on opposite sides: the track passes over the plant.
        rows = [row(3, "Tornado", lat=SITE.latitude - 40 * KM_LAT, lon=SITE.longitude,
                    lat2=SITE.latitude + 40 * KM_LAT, lon2=SITE.longitude + 0.01, cz_fips=11)]
        _, m, _ = run(rows)
        self.assertEqual(m["method"].tolist(), ["radius"])

    def test_county_without_coordinates(self):
        rows = [row(4, "Flash Flood"), row(5, "Flash Flood", cz_fips=11), row(6, "Flood", lat=0, lon=0)]
        _, m, _ = run(rows)
        self.assertEqual(sorted(m["EVENT_ID"]), [4, 6])     # lat/lon 0 counts as missing
        self.assertEqual(set(m["method"]), {"county"})

    def test_zone_code_and_zone_name(self):
        rows = [row(7, "Excessive Heat", cz_type="Z", cz_fips=67, cz_name="INLAND PALM BEACH COUNTY"),
                row(8, "Heat", cz_type="Z", cz_fips=168, cz_name="COASTAL PALM BEACH COUNTY"),
                row(9, "Heat", cz_type="Z", cz_fips=68, cz_name="WEST PALM BEACHES AREA"),
                row(10, "Heat", cz_type="Z", cz_fips=67, state_fips=13, cz_name="PALM BEACH"),
                row(11, "Heat", cz_type="Z", cz_fips=70, cz_name="GLADES")]
        _, m, _ = run(rows)
        got = dict(zip(m["EVENT_ID"], m["method"]))
        self.assertEqual(got, {7: "zone_code", 8: "zone_name"})   # whole words, same state only

    def test_multi_day_and_cap(self):
        rows = [row(12, "Heat", cz_type="Z", cz_fips=67, begin=(202408, 10, 1000), end=(202408, 12, 1600)),
                row(13, "Wildfire", cz_type="Z", cz_fips=67, begin=(202403, 1, 1000), end=(202404, 15, 1000))]
        _, _, days = run(rows)
        d12 = days[days["EVENT_ID"] == 12]["date"].dt.strftime("%Y-%m-%d").tolist()
        self.assertEqual(d12, ["2024-08-10", "2024-08-11", "2024-08-12"])
        self.assertEqual((days["EVENT_ID"] == 13).sum(), 14)

    def test_est_event_crossing_midnight_in_daylight_time(self):
        # 23:30 EST on 14 August = 00:30 EDT on 15 August at the plant; ends 01:00 EST = 02:00 EDT.
        rows = [row(14, "Thunderstorm Wind", begin=(202408, 14, 2330), end=(202408, 15, 100))]
        _, _, days = run(rows)
        self.assertEqual(days["date"].dt.strftime("%Y-%m-%d").tolist(), ["2024-08-15"])
        # 22:30 EST in January stays on 14 January.
        rows = [row(15, "Thunderstorm Wind", begin=(202401, 14, 2230), end=(202401, 15, 30))]
        _, _, days = run(rows)
        self.assertEqual(days["date"].dt.strftime("%Y-%m-%d").tolist(), ["2024-01-14", "2024-01-15"])

    def test_marine_rows_removed(self):
        rows = [row(16, "Marine Thunderstorm Wind", cz_type="Z", cz_fips=67),
                row(17, "Thunderstorm Wind", cz_type="M", cz_fips=67),
                row(18, "Thunderstorm Wind")]
        ev, m, _ = run(rows)
        self.assertEqual(ev["EVENT_ID"].tolist(), [18])
        self.assertEqual(m["EVENT_ID"].tolist(), [18])

    def test_daily_labels_table(self):
        rows = [row(19, "Heat", cz_type="Z", cz_fips=67), row(20, "Hail")]
        _, _, days = run(rows)
        t = labels.daily_labels(days)
        self.assertEqual(t.loc["2024-08-14"].to_dict(), {"y_heat": 1, "y_storm": 1, "y_flood": 0, "y_fire": 0})

    def test_segment_distance(self):
        d = labels.segment_distance_km(0.0, 0.0, np.array([1.0]), np.array([-1.0]), np.array([-1.0]), np.array([1.0]))
        self.assertLess(d[0], 1e-6)
        d = labels.segment_distance_km(0.0, 0.0, np.array([0.1]), np.array([0.0]), np.array([np.nan]), np.array([np.nan]))
        self.assertAlmostEqual(d[0], 11.12, places=1)


if __name__ == "__main__":
    unittest.main()
