import math
import unittest

import pandas as pd

from hazidx import severity


class SeverityTest(unittest.TestCase):
    def fams(self, narrative, code="0"):
        return [f for f, _ in severity.classify(narrative, code)]

    def test_known_false_matches_excluded(self):
        self.assertEqual(self.fams("He was installing a lightning arrester on the pole."), [])
        self.assertEqual(self.fams("The trench for the storm drain collapsed."), [])
        self.assertEqual(self.fams("Worker fell into a storm sewer manhole."), [])
        self.assertEqual(self.fams("On August 3, the employee fell from a ladder."), [])   # gust inside August
        self.assertEqual(self.fams("He slipped in the parking lot after a snow storm."), [])
        self.assertEqual(self.fams("The flood light fell on his foot."), [])
        self.assertEqual(self.fams("He hailed a coworker for help."), [])

    def test_true_matches(self):
        self.assertEqual(self.fams("He was struck by lightning while closing the site."), ["storm"])
        self.assertEqual(self.fams("A gust of wind blew the panel into him."), ["storm"])
        self.assertEqual(self.fams("The trench filled with flood water after heavy rain."), ["flood"])
        self.assertEqual(self.fams("While extinguishing a brush fire near the line..."), ["fire"])
        self.assertEqual(self.fams("Heat stroke after working in a storm cleanup", "5312"), ["heat"])  # OIICS wins

    def test_shrinkage_arithmetic(self):
        n = {"heat": 234, "storm": 22, "flood": 3, "fire": 0}
        d = {"heat": 18900, "storm": 151000, "flood": 41000, "fire": 5200}
        rates, r0 = severity.shrunk_rates(n, d, k=5)
        self.assertAlmostEqual(r0, 259 / 216100)
        self.assertAlmostEqual(rates["fire"], 5 / (5200 + 5 / r0))
        self.assertAlmostEqual(rates["heat"], 239 / (18900 + 5 / r0))
        lo, hi = severity.rate_interval(0, 5200, r0, k=5)
        self.assertLess(lo, rates["fire"])
        self.assertGreater(hi, rates["fire"])

    def test_log_weights(self):
        w = severity.log_weights({"heat": 0.0123, "storm": 0.00018, "flood": 0.00018 * 1.01, "fire": 0.00054})
        self.assertEqual(w["heat"], 1.0)
        self.assertEqual(w["storm"], 0.75)
        self.assertTrue(0.75 < w["fire"] < 1.0)
        expect = 0.75 + 0.25 * (math.log(0.00054) - math.log(0.00018)) / (math.log(0.0123) - math.log(0.00018))
        self.assertAlmostEqual(w["fire"], expect)
        self.assertEqual(severity.log_weights({"a": 0.01, "b": 0.01}), {"a": 1.0, "b": 1.0})

    def test_federal_states(self):
        sir = pd.DataFrame({"State": ["OHIO"] * 3 + ["UTAH"] * 3, "FederalState": ["1", "1", "0", "0", "0", "1"]})
        self.assertEqual(severity.federal_states(sir), ["OHIO"])


if __name__ == "__main__":
    unittest.main()
