"""Python heat and time code must match the live TypeScript to within 1e-9 (acceptance criterion 1)."""
import json
import shutil
import subprocess
import unittest
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from hazidx import heat, localtime

HERE = Path(__file__).resolve().parent
TOL = 1e-9


def iso(ms: int) -> str:
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")


@unittest.skipUnless(shutil.which("node"), "node is needed to run the TypeScript")
class ParityTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        out = subprocess.run(["node", "--experimental-strip-types", str(HERE / "gen_golden.mjs")], capture_output=True, text=True, check=True)
        cls.g = json.loads(out.stdout)

    def test_heat_index_and_wet_bulb(self):
        worst = 0.0
        for row in self.g["heat"]:
            worst = max(worst, abs(heat.heat_index_f(row["t"], row["rh"]) - row["hi"]))
            wb = heat.wet_bulb_c((row["t"] - 32) * 5 / 9, min(max(row["rh"], 5), 99))
            worst = max(worst, abs(wb - row["wb"]))
        self.assertLess(worst, TOL)

    def test_wbgt_scalar_and_vectorized(self):
        t, rh, w, s, want = [], [], [], [], []
        for row in self.g["heat"]:
            for wind, sun, v in row["wbgt"]:
                self.assertLess(abs(heat.wbgt_f(row["t"], row["rh"], wind, sun) - v), TOL)
                t.append(row["t"]); rh.append(row["rh"]); w.append(wind); s.append(sun); want.append(v)
        got = heat.wbgt_f_np(np.array(t), np.array(rh), np.array(w), np.array(s))
        self.assertLess(float(np.max(np.abs(got - np.array(want)))), TOL)

    def test_heat_index_vectorized(self):
        t = np.array([r["t"] for r in self.g["heat"]])
        rh = np.array([r["rh"] for r in self.g["heat"]])
        want = np.array([r["hi"] for r in self.g["heat"]])
        self.assertLess(float(np.max(np.abs(heat.heat_index_f_np(t, rh) - want))), TOL)

    def test_zoned_to_utc_over_dst_in_all_plant_zones(self):
        self.assertEqual(len({z[2] for z in self.g["zoned"]}), 7)
        for day, hour, tz, ms in self.g["zoned"]:
            self.assertEqual(localtime.zoned_to_utc(day, hour, tz), ms, (day, hour, tz))

    def test_local_date_and_overnight(self):
        for ms, tz, d in self.g["local"]:
            self.assertEqual(localtime.local_date(ms, tz), d, (ms, tz))
        for ms, tz, start, end in self.g["overnight"]:
            self.assertEqual(localtime.overnight_window(ms, tz), (start, end), (ms, tz))
        for d, n, want in self.g["addDays"]:
            self.assertEqual(localtime.add_days(d, n), want)


class CopiedAssertionsTest(unittest.TestCase):
    """The heat and time assertions of tests/functions/shared.test.mjs, against the Python copy."""

    def test_heat(self):
        self.assertLess(abs(heat.wet_bulb_c(20, 50) - 13.7), 0.3)
        self.assertLess(abs(heat.heat_index_f(90, 70) - 105.9), 2)
        self.assertLess(heat.heat_index_f(70, 40), 80)
        sunny = heat.wbgt_f(95, 60, 5, 850)
        self.assertTrue(88 < sunny < 98, sunny)
        self.assertLess(heat.wbgt_f(95, 60, 5, 0), sunny)
        self.assertLess(heat.wbgt_f(95, 60, 15, 850), sunny)
        self.assertLess(heat.wbgt_f(70, 50, 5, 0), 70)

    def test_time(self):
        self.assertEqual(iso(localtime.zoned_to_utc("2026-10-17", 18, "America/New_York")), "2026-10-17T22:00:00.000Z")
        self.assertEqual(iso(localtime.zoned_to_utc("2026-11-10", 18, "America/New_York")), "2026-11-10T23:00:00.000Z")
        ms = lambda s: int(datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp() * 1000)
        self.assertEqual(localtime.local_date(ms("2026-10-18T02:00:00Z"), "America/New_York"), "2026-10-17")
        self.assertEqual(localtime.add_days("2026-12-31", 1), "2027-01-01")
        start, _ = localtime.overnight_window(ms("2026-10-17T23:30:00Z"), "America/New_York")
        self.assertEqual(iso(start), "2026-10-17T22:00:00.000Z")
        start, end = localtime.overnight_window(ms("2026-10-17T16:00:00Z"), "America/New_York")
        self.assertEqual(iso(start), "2026-10-16T22:00:00.000Z")
        self.assertEqual(iso(end), "2026-10-17T10:00:00.000Z")
        _, end = localtime.overnight_window(ms("2026-10-17T07:00:00Z"), "America/New_York")
        self.assertEqual(end, ms("2026-10-17T07:00:00Z"))


if __name__ == "__main__":
    unittest.main()
