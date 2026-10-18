"""hourly_plan, work_window and ring_points must match supabase/functions/_shared/briefing.ts, so the new
report and the existing next-day plan never disagree about which hours are safe."""
import json
import shutil
import subprocess
import unittest
from pathlib import Path

from nextday import forecast, weather_plan

HERE = Path(__file__).resolve().parent
CORE = ("hour", "wbgt", "gust", "pop", "mm", "safe", "blocked_by")


@unittest.skipUnless(shutil.which("node"), "node is needed to run the TypeScript")
class ParityTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        out = subprocess.run(["node", str(HERE / "gen_golden.mjs")], capture_output=True, text=True, check=True)
        cls.g = json.loads(out.stdout)

    def test_hourly_plan_matches(self):
        self.assertGreaterEqual(len(self.g["cases"]), 5)
        for c in self.g["cases"]:
            got = weather_plan.hourly_plan(c["locations"], c["tz"], c["date"])
            self.assertEqual(len(got), 24)
            for want, mine in zip(c["hours"], got):
                self.assertEqual({k: mine[k] for k in CORE}, {k: want[k] for k in CORE}, (c["tz"], c["date"], want["hour"]))

    def test_work_window_matches(self):
        windows = []
        for c in self.g["cases"]:
            got = weather_plan.work_window(weather_plan.hourly_plan(c["locations"], c["tz"], c["date"]))
            self.assertEqual(got, c["window"], (c["tz"], c["date"]))
            windows.append(got)
        self.assertTrue(all(windows), "every golden case should have a window so the test means something")

    def test_ring_points_match(self):
        for r in self.g["ring"]:
            got = forecast.ring_points(r["lat"], r["lon"])
            self.assertEqual(len(got), len(r["points"]))
            for (lat, lon), want in zip(got, r["points"]):
                self.assertAlmostEqual(lat, want["latitude"], places=9)
                self.assertAlmostEqual(lon, want["longitude"], places=9)


class WorkWindowEdgeCases(unittest.TestCase):
    def hours(self, safe):
        return [{"hour": h, "safe": h in safe, "have_data": True, "blocked_by": [] if h in safe else ["rain"]} for h in range(24)]

    def test_needs_two_hours(self):
        self.assertIsNone(weather_plan.work_window(self.hours({10})))
        self.assertEqual(weather_plan.work_window(self.hours({10, 11})), {"start": "10:00", "end": "12:00"})

    def test_longest_run_wins_and_day_ends_at_19(self):
        self.assertEqual(weather_plan.work_window(self.hours({7, 8, 12, 13, 14, 15, 16, 17, 18, 19, 20})),
                         {"start": "12:00", "end": "19:00"})

    def test_blocked_runs_name_the_reasons(self):
        hrs = self.hours(set(range(24)) - {9, 10})
        hrs[9]["blocked_by"], hrs[10]["blocked_by"] = ["heat"], ["heat", "storms"]
        self.assertEqual(weather_plan.blocked_runs(hrs), [{"start": "09:00", "end": "11:00", "reasons": ["heat", "storms"]}])

    def test_js_round_halves_go_up(self):
        self.assertEqual(weather_plan.js_round(2.5), 3)
        self.assertEqual(weather_plan.js_round(-2.5), -2)
        self.assertEqual(weather_plan.js_round(88.25, 1), 88.3)


if __name__ == "__main__":
    unittest.main()
