import unittest

from nextday import heat_plan
from nextday.weather_plan import hourly_plan


def hour(h, hi, wbgt=80.0, data=True):
    return {"hour": h, "hi": hi, "feels": hi, "temp": None if hi is None else hi - 5, "rh": 60, "wbgt": wbgt, "have_data": data}


class BandTest(unittest.TestCase):
    def test_band_edges(self):
        cases = {None: None, 70: "low", 79.4: "low", 79.5: "caution", 80: "caution", 90.4: "caution", 90.5: "extreme_caution",
                 91: "extreme_caution", 102.4: "extreme_caution", 102.5: "danger", 103: "danger", 124.4: "danger",
                 124.5: "extreme_danger", 125: "extreme_danger", 140: "extreme_danger"}
        for hi, want in cases.items():
            b = heat_plan.band_for(hi)
            self.assertEqual(b["id"] if b else None, want, hi)

    def test_bands_match_the_rules_engine_breakpoints_at_103_and_125(self):
        mins = {b["id"]: b["min"] for b in heat_plan.BANDS}
        self.assertEqual((mins["danger"], mins["extreme_danger"]), (103, 125))

    def test_wbgt_tiers_match_live_alerts(self):
        self.assertEqual([heat_plan.wbgt_tier(x) for x in (81.9, 82, 85, 88, 90)],
                         ["below caution", "caution", "scheduled rest breaks", "danger, limit heavy work", "stop heavy work"])

    def test_no_invented_rest_minutes(self):
        for b in heat_plan.BANDS:
            self.assertNotRegex(b["action"] + (b["rest"] or ""), r"\d+\s*min(ute)?s? (of|on|off|rest)")
            self.assertIn(b["water_every_min"], (None, 15))


class BuildTest(unittest.TestCase):
    def day(self, peak_hi=104):
        return [hour(h, 70 + (peak_hi - 70) * max(0, 1 - abs(h - 15) / 7)) for h in range(24)]

    def test_peak_window_and_water_plan(self):
        out = heat_plan.build(self.day())
        self.assertEqual(out["status"], "ok")
        self.assertEqual(out["peak"]["hour"], 15)
        self.assertEqual(out["peak"]["band"], "danger")
        self.assertEqual(out["peak"]["hi_full_sun_max"], 119)
        plan = out["water_plan"]
        self.assertEqual(plan[0]["band"], "low")
        self.assertEqual(plan[-1]["end"], "19:00")
        self.assertTrue(any(r["band"] == "danger" for r in plan))
        self.assertTrue(all(r["water_every_min"] in (None, 15) for r in plan))
        # runs are contiguous and cover the workday exactly once
        for a, b in zip(plan, plan[1:]):
            self.assertEqual(a["end"], b["start"])
        self.assertEqual((plan[0]["start"], plan[-1]["end"]), ("06:00", "19:00"))

    def test_missing_without_forecast(self):
        self.assertEqual(heat_plan.build([hour(h, None, None, False) for h in range(24)])["status"], "missing")

    def test_source_is_tagged_unverified(self):
        self.assertIn("Confirm", heat_plan.SOURCE["verified"])
        self.assertTrue(heat_plan.SOURCE["url"].startswith("https://www.weather.gov"))


if __name__ == "__main__":
    unittest.main()
