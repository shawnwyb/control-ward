import csv
import json
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from hazidx.sites import Site
from nextday import air, forecast, hazard_index, levees, mud, river, tide
from nextday.fetch import Fetcher, SourceUnavailable

UTC = timezone.utc
SITE = Site("Test Plant", 25.0, -80.0, "America/New_York", "999", None, None, None, None, None, None)


class FetcherTest(unittest.TestCase):
    def test_offline_needs_a_stamp_and_a_saved_response(self):
        with self.assertRaises(ValueError):
            Fetcher(None, offline=True)
        with tempfile.TemporaryDirectory() as d:
            f = Fetcher("20260101T000000Z", offline=True, root=Path(d))
            with self.assertRaises(SourceUnavailable):
                f.get_json("x", "http://example.invalid")

    def test_cached_round_trip(self):
        with tempfile.TemporaryDirectory() as d:
            online = Fetcher("20260101T000000Z", root=Path(d))
            self.assertEqual(online.cached("k/1", lambda: {"a": 1}, url="u"), {"a": 1})
            replay = Fetcher("20260101T000000Z", offline=True, root=Path(d))
            self.assertEqual(replay.cached("k/1", lambda: self.fail("must not run"), url="u"), {"a": 1})
            self.assertEqual(replay.sources["k/1"]["url"], "u")


class ForecastTest(unittest.TestCase):
    def test_alert_overlap_and_order(self):
        feat = lambda ev, sev, on, end: {"properties": {"event": ev, "severity": sev, "onset": on, "ends": end, "headline": ev}}
        payload = {"features": [
            feat("Rip Current Statement", "Moderate", "2026-10-18T02:00:00-04:00", "2026-10-22T20:00:00-04:00"),
            feat("Gale Warning", "Severe", "2026-10-19T03:00:00-04:00", "2026-10-19T09:00:00-04:00"),
            feat("Over Already", "Minor", "2026-10-17T00:00:00-04:00", "2026-10-18T23:00:00-04:00"),
            feat("Starts Later", "Minor", "2026-10-20T00:00:00-04:00", "2026-10-20T06:00:00-04:00")]}
        day0, day1 = forecast.day_bounds("2026-10-19", "America/New_York")
        got = forecast.parse_alerts(payload, day0, day1)
        self.assertEqual([a["event"] for a in got], ["Gale Warning", "Rip Current Statement"])

    def test_day_bounds_dst(self):
        a, b = forecast.day_bounds("2026-11-01", "America/New_York")   # clocks go back: 25 hours
        self.assertEqual((b - a) / 3_600_000, 25)


class HazardIndexTest(unittest.TestCase):
    def row(self, run="2026-10-18T04:24:29Z", date="2026-10-19", score="2.6"):
        return {"eia_plant_id": "999", "horizon": "tomorrow", "score": score, "model_version": "hazidx-test", "local_date": date,
                "top_driver": "storm", "p_heat": "0.0002", "p_storm": "0.03", "p_flood": "0.01", "p_fire": "0.0",
                "risk_preview": score, "rule_max_fc": "0.0", "drift_flags": "", "wbgt_max_f": "80", "hi_max_f": "86",
                "gust_max_mph": "20", "rain_24h_mm": "1", "rain_prev7d_mm": "5", "forecast_model": "best_match",
                "run_at_utc": run, "_file": "x.csv"}

    def test_fresh_row_is_ok_and_tiered(self):
        now = datetime(2026, 10, 18, 22, 0, tzinfo=UTC)
        out = hazard_index.build("999", "2026-10-19", now, [self.row()], models_dir=Path("/nonexistent"))
        self.assertEqual((out["status"], out["score"], out["tier"]), ("ok", 2.6, "low"))
        self.assertEqual([hazard_index.tier(x) for x in (0, 2.9, 3, 7.4, 7.5, 10)], ["low", "low", "watch", "watch", "warning", "stop work"])

    def test_old_run_is_refused_and_other_date_is_missing(self):
        now = datetime(2026, 10, 20, 4, 0, tzinfo=UTC)
        stale = hazard_index.build("999", "2026-10-19", now, [self.row()])
        self.assertEqual(stale["status"], "missing")
        self.assertIn("hours old", stale["reason"])
        none = hazard_index.build("999", "2026-10-25", now, [self.row()])
        self.assertIn("run.sh score", none["reason"])


class MudTest(unittest.TestCase):
    def make_run(self, root: Path, generated="2026-10-18T03:27:22+00:00", date="2026-10-19"):
        run = root / "run_x"
        (run / "segments").mkdir(parents=True)
        (root / "LATEST").write_text("run_x")
        (run / "run.json").write_text(json.dumps({
            "generated_at": generated, "model_version": "m", "label": "STRAM-inspired, uncalibrated. does not certify a crossing is safe.",
            "passes_note": "note", "thresholds_in": {"inspect": 4.0, "hold": 8.0}, "flags": ["ok", "inspect", "hold"],
            "equipment": [{"key": k, "label": k} for k in mud.EQUIPMENT],
            "sites": [{"eia": "999", "horizons": [{"key": "now", "date": "2026-10-18", "label": "Now", "theta": 0.2, "rain_in": 1.0},
                                                    {"key": "d1", "date": date, "label": "Tomorrow", "theta": 0.25, "rain_in": 2.0}]}]}))
        cols = "eia,site,horizon,label,date,equipment,passes,wetness,fia_ha,rain_in,theta,theta_min,theta_max,frozen,score,score_p90,worst_flag,worst_segment,inspect_acres,hold_acres,corridor_acres,flagged_route_ft,route_ft,segments,plant_cell_flag,plant_cell_score".split(",")
        with (run / "sites.csv").open("w", newline="") as fh:
            w = csv.DictWriter(fh, cols)
            w.writeheader()
            for k in mud.EQUIPMENT:
                w.writerow({**{c: "0" for c in cols}, "eia": "999", "horizon": "d1", "equipment": k, "passes": "1", "score": "6.5",
                            "score_p90": "6.5", "worst_flag": "hold", "worst_segment": "s1", "flagged_route_ft": "500", "route_ft": "900",
                            "inspect_acres": "1.0", "hold_acres": "2.0"})
        feat = lambda i, flag: {"type": "Feature", "geometry": {"type": "LineString", "coordinates": [[-80.0, 25.0], [-80.001, 25.001]]},
                                "properties": {"id": f"s{i}", "osm_id": i, "highway": "track", "name": None, "length_ft": 300,
                                               "r": {f"{k}|1|d1": [flag, 1, 6.5, 9.0, 8.0, 10.0, 300] for k in mud.EQUIPMENT}}}
        (run / "segments" / "999.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": [feat(1, 2), feat(2, 1), feat(3, 0)]}))
        return run

    def test_decodes_flags_and_keeps_only_flagged_routes(self):
        with tempfile.TemporaryDirectory() as d:
            run = self.make_run(Path(d))
            sec, geo = mud.build("999", "2026-10-19", datetime(2026, 10, 18, 5, 0, tzinfo=UTC), run)
            self.assertEqual(sec["status"], "ok")
            self.assertEqual(sec["segment_counts"], {"ok": 1, "inspect": 1, "hold": 1})
            self.assertEqual(len(geo["features"]), 2)
            self.assertEqual(geo["features"][0]["properties"]["r"]["road_truck"][0], 2)
            self.assertIn("does not certify", sec["label"])
            self.assertFalse(sec["locally_validated"])

    def test_horizon_is_found_by_date_and_age_gates(self):
        with tempfile.TemporaryDirectory() as d:
            run = self.make_run(Path(d))
            self.assertEqual(mud.build("999", "2026-12-01", datetime(2026, 10, 18, 5, tzinfo=UTC), run)[0]["status"], "missing")
            self.assertEqual(mud.build("999", "2026-10-19", datetime(2026, 10, 19, 12, tzinfo=UTC), run)[0]["status"], "stale")
            self.assertEqual(mud.build("999", "2026-10-19", datetime(2026, 10, 21, 12, tzinfo=UTC), run)[0]["status"], "missing")
            self.assertEqual(mud.build("123", "2026-10-19", datetime(2026, 10, 18, 5, tzinfo=UTC), run)[0]["status"], "not_applicable")


class TideTest(unittest.TestCase):
    HILO = [{"t": "2026-10-18 17:19", "v": 0.566, "type": "H"}, {"t": "2026-10-19 00:16", "v": 0.306, "type": "L"},
            {"t": "2026-10-19 05:32", "v": 0.554, "type": "H"}, {"t": "2026-10-19 12:36", "v": 0.25, "type": "L"},
            {"t": "2026-10-19 18:10", "v": 0.565, "type": "H"}, {"t": "2026-10-20 01:00", "v": 0.29, "type": "L"}]

    def test_navd88_conversion_uses_station_datums(self):
        datums = {"MLLW": 0.538, "NAVD88": 1.074}
        self.assertAlmostEqual(tide.to_navd88(0.565, datums), 0.029, places=3)     # station 8723423 values
        self.assertAlmostEqual(tide.to_navd88(0.0, datums), -0.536, places=3)
        self.assertIsNone(tide.to_navd88(0.5, {"MLLW": 0.5}))

    def test_windows_are_clipped_to_the_day(self):
        w = tide.windows(self.HILO, "2026-10-19")
        self.assertEqual([(x["start"], x["end"]) for x in w["rising"]], [("2026-10-19T00:16", "2026-10-19T05:32"), ("2026-10-19T12:36", "2026-10-19T18:10")])
        self.assertEqual(w["falling"][0]["start"], "2026-10-19T00:00")     # the fall that began on the 18th
        self.assertEqual(w["falling"][-1]["end"], "2026-10-20T00:00")
        self.assertEqual([(x["start"], x["end"]) for x in w["near_high"]], [("2026-10-19T04:32", "2026-10-19T06:32"), ("2026-10-19T17:10", "2026-10-19T19:10")])

    def test_inland_site_is_not_applicable_with_a_reason(self):
        sec, geo = tide.build(self.fail, SITE, "2026-10-19", {"999": {"candidates": [{"name": "Port Deposit", "distance_km": 21.8}]}})
        self.assertEqual(sec["status"], "not_applicable")
        self.assertIn("21.8 km", sec["reason"])
        self.assertIsNone(geo)

    def test_shading_classes_skip_open_water_and_dry_ground(self):
        dem = np.full((40, 40), 5.0, dtype="float32")
        dem[:, :10] = -1.0                      # open water, below the lowest tide
        dem[:, 10:20] = 0.1                     # between lowest and highest tide, touches the tile edge
        dem[:, 20:25] = 0.4                     # within the 0.3 m margin above a 0.3 m high tide
        dem[15:25, 30:38] = 0.1                 # same height, but ringed by dry ground
        with tempfile.TemporaryDirectory() as d:
            np.savez(Path(d) / "terrain_999.npz", dem=dem, grid=np.array(json.dumps({"epsg": 32617, "left": 564790, "top": 2815851, "res": 10.0, "n": 40})))
            geo = tide.shade("999", high_navd88=0.3, mllw_navd88=-0.5, terrain_dir=Path(d))
        kinds = {f["properties"]["kind"] for f in geo["features"]}
        self.assertEqual(kinds, {"wet", "marginal", "low_spot"})
        self.assertIn("ignores storm surge", geo["properties"]["label"])
        lons = [c[0] for f in geo["features"] for ring in f["geometry"]["coordinates"] for c in ring]
        self.assertGreater(min(lons), -81.0)
        # no polygon starts inside the open-water columns (x < left + 10 cells)
        lefts = {f["properties"]["kind"]: min(c[0] for ring in f["geometry"]["coordinates"] for c in ring) for f in geo["features"]}
        self.assertEqual(len(lefts), 3)


class LeveeTest(unittest.TestCase):
    def feats(self):
        area = {"type": "Feature", "geometry": {"type": "Polygon", "coordinates": [[[-80.01, 24.99], [-79.99, 24.99], [-79.99, 25.01], [-80.01, 25.01], [-80.01, 24.99]]]},
                "properties": {"SYSTEM_ID": "111", "SYSTEM_NAME": "Test Levee", "FEMA_ACCREDITATION_RATING": "Accredited", "LEVEED_AREA_SQ_MI": 4.2}}
        line = {"type": "Feature", "geometry": {"type": "LineString", "coordinates": [[-80.02, 25.0, 3.0], [-80.02, 25.02, 3.0]]},
                "properties": {"SYSTEM_ID": "111", "SYSTEM_NAME": "Test Levee", "SEGMENT_NAME": "North"}}
        pump = {"type": "Feature", "geometry": {"type": "Point", "coordinates": [-80.015, 25.0]}, "properties": {"SYSTEM_ID": "111", "SYSTEM_NAME": "Test Levee"}}
        return {"leveed_areas": [area], "alignment_lines": [line], "floodwalls": [], "closure_structures": [], "pump_stations": [pump]}

    def test_inside_area_rating_counts_and_no_z(self):
        sec, geo = levees.summarize(SITE, self.feats(), {"111": "Minimally Acceptable"})
        self.assertEqual(sec["status"], "ok")
        self.assertTrue(sec["inside_leveed_area"])
        self.assertEqual(sec["systems"][0]["inspection_rating"], "Minimally Acceptable")
        self.assertEqual(sec["pump_stations"], 1)
        self.assertTrue(all(len(c) == 2 for f in geo["features"] if f["geometry"]["type"] == "LineString" for c in f["geometry"]["coordinates"]))
        self.assertTrue(any("ignores levees on purpose" in c for c in sec["caveats"]))

    def test_unrated_system_and_unknown_ratings(self):
        sec, _ = levees.summarize(SITE, self.feats(), {})
        self.assertEqual(sec["systems"][0]["inspection_rating"], "Not Rated")
        sec, _ = levees.summarize(SITE, self.feats(), None)
        self.assertIsNone(sec["systems"][0]["inspection_rating"])
        self.assertIn("inspection_rating_note", sec)

    def test_nothing_nearby_is_not_applicable(self):
        sec, geo = levees.summarize(SITE, {k: [] for k in self.feats()}, {})
        self.assertEqual(sec["status"], "not_applicable")
        self.assertIsNone(geo)


class RiverTest(unittest.TestCase):
    META = {"name": "Test River", "flood": {"stageUnits": "ft", "categories": {"action": {"stage": 10}, "minor": {"stage": 12}, "moderate": {"stage": 15}, "major": {"stage": 20}}}}
    DIST = {"lid": "TST01", "name": "Test", "distance_km": 3.2}

    def flow(self, obs, fc):
        pts = lambda xs: {"data": [{"validTime": t, "primary": v, "secondary": 1} for t, v in xs]}
        return {"observed": pts(obs), "forecast": pts(fc)}

    def test_categories_and_empty_forecast(self):
        self.assertEqual([river.category(s, self.META["flood"]["categories"]) for s in (5, 10, 12, 16, 20, None)], ["none", "action", "minor", "moderate", "major", "unknown"])
        obs = [("2026-10-18T00:00:00Z", 8.0), ("2026-10-18T06:00:00Z", 8.5), ("2026-10-18T12:00:00Z", 8.6)]
        out = river.summarize(self.META, self.flow(obs, []), self.DIST, "2026-10-19", "America/New_York", datetime(2026, 10, 18, 13, tzinfo=UTC))
        self.assertIsNone(out["forecast"])
        self.assertIn("No river forecast is published", out["forecast_note"])
        self.assertEqual((out["observed"]["trend"], out["flag"]), ("steady", "none"))

    def test_forecast_crest_sets_the_flag(self):
        fc = [("2026-10-18T18:00:00Z", 9.0), ("2026-10-19T12:00:00Z", 16.5), ("2026-10-20T12:00:00Z", 11.0), ("2026-10-18T10:00:00Z", -999)]
        obs = [("2026-10-17T18:00:00Z", 7.0), ("2026-10-18T12:00:00Z", 8.0)]
        out = river.summarize(self.META, self.flow(obs, fc), self.DIST, "2026-10-19", "America/New_York", datetime(2026, 10, 18, 13, tzinfo=UTC))
        self.assertEqual((out["forecast"]["crest"]["category"], out["forecast"]["report_day_max"]["category"], out["flag"]), ("moderate", "moderate", "moderate"))

    def test_nearest_gauge_respects_distance(self):
        gauges = [{"lid": "A", "name": "a", "lat": 25.02, "lon": -80.0, "state": "FL"}, {"lid": "B", "name": "b", "lat": 26.5, "lon": -80.0, "state": "FL"}]
        self.assertEqual(river.nearest(SITE, gauges)["lid"], "A")
        self.assertIsNone(river.nearest(SITE, gauges[1:]))


class AirTest(unittest.TestCase):
    def test_aqi_bands(self):
        names = [air.band(x)["name"] for x in (0, 50, 51, 100, 101, 150, 151, 200, 201, 300, 301)]
        self.assertEqual(names, ["Good", "Good", "Moderate", "Moderate", "Unhealthy for sensitive groups", "Unhealthy for sensitive groups",
                                 "Unhealthy", "Unhealthy", "Very unhealthy", "Very unhealthy", "Hazardous"])
        self.assertIsNone(air.band(None))

    def test_nearest_fire_in_miles(self):
        fires = [{"lat": 25.0, "lon": -79.5, "name": "A"}, {"lat": 25.0, "lon": -80.2, "name": "B"}]
        out = air.nearest_fires(SITE, fires)
        self.assertEqual(out["nearest_name"], "B")
        self.assertAlmostEqual(out["nearest_mi"], 12.5, delta=0.3)
        self.assertEqual(out["within_25_mi"], 1)


class TideFillTest(unittest.TestCase):
    def test_cells_filled_with_zero_are_water_not_ground(self):
        dem = np.full((40, 40), 5.0, dtype="float32")
        dem[:, :20] = 0.0                       # hydro-flattened open water
        dem[:, 20:30] = 0.1                     # real intertidal ground next to it
        with tempfile.TemporaryDirectory() as d:
            np.savez(Path(d) / "terrain_999.npz", dem=dem, grid=np.array(json.dumps({"epsg": 32617, "left": 564790, "top": 2815851, "res": 10.0, "n": 40})))
            geo = tide.shade("999", high_navd88=0.3, mllw_navd88=-0.5, terrain_dir=Path(d))
        from pyproj import Transformer
        x_left, _ = Transformer.from_crs("EPSG:32617", "EPSG:4326", always_xy=True).transform(564790 + 20 * 10, 2815851 - 200)
        west = min(c[0] for f in geo["features"] for ring in f["geometry"]["coordinates"] for c in ring)
        self.assertGreater(west, x_left - 0.0005)     # nothing is shaded over the filled-water columns


if __name__ == "__main__":
    unittest.main()
