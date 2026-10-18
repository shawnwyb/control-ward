import json
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

from hazidx.sites import Site
from nextday import forecast, report, verdict
from nextday.report import Context, build_site
from tests.helpers import StubFetcher, openmeteo_location

UTC = timezone.utc
SITE = Site("Test Plant", 25.0, -80.0, "America/New_York", "999", "Test Utility", "Natural Gas", None, None, None, None)
AS_OF = datetime(2026, 10, 18, 22, 0, tzinfo=UTC)     # 18:00 EDT on the 18th -> report for the 19th


def fetcher(extra=None):
    ring = len(forecast.ring_points(25.0, -80.0))
    payloads = {"openmeteo_hourly_999": [openmeteo_location("2026-10-17T00:00", 96) for _ in range(ring)]}
    payloads.update(extra or {})
    return StubFetcher(payloads)


class BuildSiteTest(unittest.TestCase):
    def test_sources_that_fail_become_gaps_not_crashes(self):
        ctx = Context(fetcher=fetcher(), as_of=AS_OF, hazard_rows=[], fires=None, gauges=[], stations={})
        rep, geo = build_site(SITE, ctx)
        self.assertEqual(rep["meta"]["for_date"], "2026-10-19")
        self.assertEqual(rep["meta"]["kind"], "evening")
        self.assertEqual(rep["weather"]["status"], "ok")
        self.assertEqual(rep["heat"]["status"], "ok")
        self.assertEqual(rep["hazard_index"]["status"], "missing")
        self.assertEqual(rep["flood"]["tide"]["status"], "not_applicable")
        self.assertEqual(rep["flood"]["river"]["status"], "not_applicable")
        self.assertEqual(rep["flood"]["levees"]["status"], "missing")
        sections = {g["section"] for g in rep["gaps"]}
        self.assertTrue({"hazard_index", "mud", "flood.tide", "flood.river", "flood.levees"} <= sections, sections)
        self.assertEqual(len(rep["hourly"]), 24)
        self.assertEqual(geo, {})
        json.dumps(rep, allow_nan=False)      # no NaN or Infinity may reach the app

    def test_without_a_forecast_the_report_still_builds(self):
        ctx = Context(fetcher=StubFetcher({}), as_of=AS_OF, hazard_rows=[], fires=None, gauges=[], stations={})
        rep, _ = build_site(SITE, ctx)
        self.assertEqual((rep["weather"]["status"], rep["heat"]["status"]), ("missing", "missing"))
        self.assertEqual(rep["hourly"], [])
        self.assertEqual(rep["verdict"]["level"], "reschedule")       # no window can be found without a forecast

    def test_kind_follows_the_target_day_not_the_clock(self):
        # 06:00 UTC is 02:00 EDT: a build for tomorrow at that hour is still the evening report
        ctx = Context(fetcher=fetcher(), as_of=datetime(2026, 10, 18, 6, 0, tzinfo=UTC), hazard_rows=[], fires=None, gauges=[], stations={})
        self.assertEqual(build_site(SITE, ctx)[0]["meta"]["kind"], "evening")
        # and a build for today in the afternoon is still the refresh
        ctx = Context(fetcher=fetcher(), as_of=datetime(2026, 10, 19, 20, 0, tzinfo=UTC), when="today", hazard_rows=[], fires=None, gauges=[], stations={})
        self.assertEqual(build_site(SITE, ctx)[0]["meta"]["kind"], "morning")

    def test_today_mode_and_morning_kind(self):
        ctx = Context(fetcher=fetcher(), as_of=datetime(2026, 10, 19, 9, 0, tzinfo=UTC), when="today", hazard_rows=[], fires=None, gauges=[], stations={})
        rep, _ = build_site(SITE, ctx)
        self.assertEqual((rep["meta"]["for_date"], rep["meta"]["kind"]), ("2026-10-19", "morning"))

    def test_write_layout_and_previous_copy(self):
        ctx = Context(fetcher=fetcher(), as_of=AS_OF, hazard_rows=[], fires=None, gauges=[], stations={})
        rep, geo = build_site(SITE, ctx)
        with tempfile.TemporaryDirectory() as d:
            out = Path(d)
            path = report.write(rep, {"mud_routes": {"type": "FeatureCollection", "features": []}}, out)
            self.assertEqual(path, out / "999" / "2026-10-19" / "report.json")
            self.assertTrue((out / "999" / "latest.json").is_file())
            self.assertFalse((out / "999" / "2026-10-19" / "report.prev.json").exists())
            report.write(rep, {}, out)                     # second build keeps the first as report.prev.json
            self.assertTrue((out / "999" / "2026-10-19" / "report.prev.json").is_file())
            self.assertFalse((out / "999" / "2026-10-19" / "mud_routes.geojson").exists())   # layers that no longer apply are removed
            idx = json.loads((out / "index.json").read_text())
            self.assertEqual(idx["sites"][0]["eia"], "999")


class VerdictTest(unittest.TestCase):
    def hours(self, blocked=()):
        return [{"hour": h, "blocked_by": ["rain"] if h in blocked else []} for h in range(24)]

    def test_clear_day_is_go(self):
        v = verdict.evaluate({}, {"start": "06:00", "end": "18:00"}, self.hours())
        self.assertEqual((v["level"], v["reasons"]), ("go", []))
        self.assertIn("does not clear", v["disclaimer"].lower().replace("not certify", "not clear"))

    def test_no_window_reschedules(self):
        self.assertEqual(verdict.evaluate({}, None, self.hours(range(6, 19)))["level"], "reschedule")

    def test_short_window_and_blocked_hours_limit(self):
        v = verdict.evaluate({}, {"start": "10:00", "end": "13:00"}, self.hours({14}))
        self.assertEqual(v["level"], "limits")
        self.assertEqual({r["code"] for r in v["reasons"]}, {"short_window", "blocked_hours"})

    def test_severity_ordering_and_each_source(self):
        sections = {
            "weather": {"alerts": [{"event": "Tornado Warning", "severity": "Extreme"}]},
            "heat": {"status": "ok", "peak": {"band": "danger", "hi": 108, "hour": 15, "wbgt": 91}},
            "hazard_index": {"status": "ok", "score": 8.0, "tier": "warning", "top_driver": "storm"},
            "air": {"peak": {"us_aqi": 160, "band": {"name": "Unhealthy"}}},
            "flood": {"river": {"status": "ok", "flag": "moderate", "gauge": {"name": "Test River"}}, "tide": {"status": "ok", "shading_file": "x"}},
            "mud": {"status": "ok", "default_equipment": "road_truck", "segment_counts": {"hold": 7},
                    "equipment": [{"key": "road_truck", "worst_flag": "hold"}]},
        }
        v = verdict.evaluate(sections, {"start": "07:00", "end": "17:00"}, self.hours())
        self.assertEqual(v["level"], "reschedule")
        codes = [(r["level"], r["code"]) for r in v["reasons"]]
        self.assertEqual(codes[0][0], "reschedule")                      # worst first
        for want in [("reschedule", "nws_alert"), ("reschedule", "wbgt"), ("reschedule", "hazard_index"), ("limits", "air"),
                     ("reschedule", "river"), ("limits", "mud"), ("limits", "tide")]:
            self.assertIn(want, codes)


if __name__ == "__main__":
    unittest.main()
