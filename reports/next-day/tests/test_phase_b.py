import copy
import json
import tempfile
import unittest
from pathlib import Path

from nextday import SCHEMA_VERSION, changes, heat_plan, tasks, weather_plan


def report(**over):
    base = {
        "schema_version": SCHEMA_VERSION,
        "meta": {"generated_at": "2026-10-18T22:00:00Z", "kind": "evening", "for_date": "2026-10-19", "site": {"eia": "999"}},
        "verdict": {"level": "go", "work_window": {"start": "06:00", "end": "18:00"}, "reasons": []},
        "heat": {"peak": {"hi": 95.0, "band": "extreme_caution", "hour": 15}},
        "weather": {"alerts": []},
        "hazard_index": {"status": "ok", "score": 2.0},
        "mud": {"segment_counts": {"ok": 50, "inspect": 10, "hold": 40}},
        "flood": {"tide": {"highest": {"t": "2026-10-19T05:32"}}, "river": {"flag": "none"}},
        "air": {"peak": {"band": {"name": "Good"}}},
    }
    base.update(over)
    return base


class ChangesTest(unittest.TestCase):
    def test_nothing_material_changed(self):
        old = report()
        new = copy.deepcopy(old)
        new["heat"]["peak"]["hi"] = 96.5           # under the 3 F threshold
        self.assertEqual(changes.compare(old, new)["items"], [])

    def test_each_kind_of_change_is_reported_in_words(self):
        old = report()
        new = report(
            verdict={"level": "limits", "work_window": {"start": "08:00", "end": "15:00"}, "reasons": []},
            heat={"peak": {"hi": 104.0, "band": "danger", "hour": 15}},
            weather={"alerts": [{"event": "Flood Warning"}]},
            hazard_index={"status": "ok", "score": 4.1},
            mud={"segment_counts": {"ok": 20, "inspect": 10, "hold": 70}},
            flood={"tide": {"highest": {"t": "2026-10-19T06:12"}}, "river": {"flag": "minor"}},
            air={"peak": {"band": {"name": "Unhealthy"}}},
        )
        text = " | ".join(i["text"] for i in changes.compare(old, new)["items"])
        for want in ["got worse: from Go to Go with limits", "moved from 6 AM to 6 PM to 8 AM to 3 PM", "rose from 95 F to 104 F",
                     "New alert: Flood Warning", "rose from 2.0 to 4.1", "from 40 to 70", "moved from 05:32 to 06:12",
                     "from none to minor", "from good to unhealthy"]:
            self.assertIn(want, text)

    def test_window_that_appears_or_disappears(self):
        gone = changes.compare(report(), report(verdict={"level": "reschedule", "work_window": None, "reasons": []}))
        self.assertTrue(any("work window is gone" in i["text"] for i in gone["items"]))

    def test_previous_report_loading_and_guards(self):
        new = report()
        new["meta"]["generated_at"] = "2026-10-19T10:00:00Z"
        with tempfile.TemporaryDirectory() as d:
            out = Path(d)
            self.assertEqual(changes.build(out, "999", "2026-10-19", new)["status"], "not_applicable")
            day = out / "999" / "2026-10-19"
            day.mkdir(parents=True)
            (day / "report.json").write_text(json.dumps(report()))
            got = changes.build(out, "999", "2026-10-19", new)
            self.assertEqual((got["status"], got["since_kind"]), ("ok", "evening"))
            same = report()
            self.assertEqual(changes.build(out, "999", "2026-10-19", same)["status"], "not_applicable")   # same generated_at
            (day / "report.json").write_text(json.dumps({**report(), "schema_version": 0}))
            self.assertEqual(changes.build(out, "999", "2026-10-19", new)["status"], "not_applicable")


class TasksTest(unittest.TestCase):
    def test_profiles_are_valid_and_alert_rule_limits_match_the_code(self):
        profiles = tasks.load_profiles()
        self.assertGreaterEqual(len(profiles), 4)
        seen_confirm = 0
        for p in profiles:
            self.assertTrue(p["blockers"], p["id"])
            for b in p["blockers"]:
                if b["kind"] == "hour":
                    self.assertIsInstance(b["limit"], (int, float))
                    if b["source"].startswith("Alert rules") and b["factor"] in weather_plan.LIMITS:
                        self.assertEqual(b["limit"], weather_plan.LIMITS[b["factor"]], (p["id"], b["id"]))
                        self.assertFalse(b["needs_confirmation"])
                else:
                    self.assertTrue(b["values"])
                if b["needs_confirmation"]:
                    seen_confirm += 1
        self.assertGreater(seen_confirm, 0)

    def test_site_flags(self):
        sections = {"mud": {"status": "ok", "default_equipment": "road_truck", "equipment": [{"key": "road_truck", "worst_flag": "hold"}]},
                    "flood": {"river": {"status": "ok", "flag": "minor"}, "tide": {"shading_file": "x"}}}
        self.assertEqual(tasks.site_flags(sections), {"mud": "hold", "river": "minor", "tide_shading": True})
        self.assertEqual(tasks.site_flags({"mud": {"status": "missing"}, "flood": {"river": {"status": "not_applicable"}, "tide": {}}}),
                         {"mud": None, "river": None, "tide_shading": False})


class AcclimatizationTest(unittest.TestCase):
    def test_schedules_follow_niosh(self):
        a = heat_plan.ACCLIMATIZATION
        self.assertEqual([d["max_percent"] for d in a["new"]["schedule"]], [20, 40, 60, 80, 100])
        self.assertEqual([d["max_percent"] for d in a["experienced"]["schedule"]], [50, 60, 80, 100])
        self.assertIn("Confirm", a["source"]["verified"])
        self.assertTrue(all(u.startswith("https://") for u in a["source"]["urls"]))


if __name__ == "__main__":
    unittest.main()
