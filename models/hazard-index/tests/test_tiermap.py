import unittest

import numpy as np

from hazidx import config, tiermap


def synthetic(levels_and_medians, days=60, seed=0):
    rng = np.random.default_rng(seed)
    r, rule = [], []
    for level, med in levels_and_medians:
        vals = med * np.exp(rng.normal(0, 0.05, days))
        vals = vals - np.median(vals) + med
        r.extend(vals)
        rule.extend([level] * days)
    return np.array(r), np.array(rule)


class TierMapTest(unittest.TestCase):
    def test_increasing_zero_and_range(self):
        r, rule = synthetic([(0, 0.004), (2, 0.012), (3, 0.025), (5, 0.055), (7.5, 0.14), (9, 0.22)])
        tm = tiermap.fit(r, rule)
        self.assertFalse(tm["fallback"])
        self.assertEqual(tm["points"][0], [0.0, 0.0])
        self.assertEqual(tm["points"][-1][1], 10.0)
        self.assertAlmostEqual(tm["points"][-1][0], 0.22 + (10 - 9) * (0.22 - 0.14) / 1.5, places=6)
        grid = np.linspace(0, 1, 2001)
        s = tiermap.apply(grid, tm)
        self.assertEqual(s[0], 0.0)
        self.assertTrue(np.all(np.diff(s) >= 0))
        self.assertTrue(np.all((s >= 0) & (s <= 10)))
        self.assertEqual(tiermap.apply([0.21], tm)[0], 8.8)   # the plan's worked example

    def test_removes_non_increasing_pairs(self):
        r, rule = synthetic([(2, 0.02), (3, 0.015), (5, 0.05), (7.5, 0.1), (9, 0.3)])
        tm = tiermap.fit(r, rule)
        self.assertEqual([p["rule_max"] for p in tm["removed"]], [3.0])
        self.assertFalse(tm["fallback"])

    def test_rare_levels_ignored_and_fallback(self):
        r, rule = synthetic([(2, 0.02), (3, 0.03)])
        r2, rule2 = synthetic([(7.5, 0.2)], days=10)
        tm = tiermap.fit(np.r_[r, r2], np.r_[rule, rule2])
        self.assertTrue(tm["fallback"])
        self.assertEqual(tm["points"], [list(p) for p in config.TIER_FALLBACK])
        self.assertEqual(tiermap.apply([0.05, 0.2, 0.4, 0.9], tm).tolist(), [3.0, 7.5, 10.0, 10.0])

    def test_rounding(self):
        self.assertEqual(tiermap.round_tenth([7.45])[0], 7.5)
        self.assertEqual(tiermap.round_tenth([0.15])[0], 0.2)
        self.assertEqual(tiermap.round_tenth([2.349])[0], 2.3)

    def test_tiers(self):
        self.assertEqual(tiermap.tier([0, 2.9, 3, 7.4, 7.5, 9.9, 10]).tolist(),
                         ["none", "none", "watch", "watch", "warning", "warning", "stop"])


if __name__ == "__main__":
    unittest.main()
