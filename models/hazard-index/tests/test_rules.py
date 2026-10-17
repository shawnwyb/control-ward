import unittest

import numpy as np

from hazidx import rules


class RulesTest(unittest.TestCase):
    def test_heat_wbgt_boundaries(self):
        cases = [(81.99, 0), (82, 3), (84.99, 3), (85, 5), (87.99, 5), (88, 7.5), (89.99, 7.5), (90, 10), (None, 0)]
        for wbgt, want in cases:
            self.assertEqual(rules.heat_score(wbgt, None), want, wbgt)
            if wbgt is not None:
                self.assertEqual(rules.heat_score_np([wbgt], [np.nan])[0], want, wbgt)

    def test_heat_index_boundaries(self):
        for hi, want in [(89.9, 0), (90, 3), (102.9, 3), (103, 6), (124.9, 6), (125, 9)]:
            self.assertEqual(rules.heat_score(None, hi), want, hi)
            self.assertEqual(rules.heat_score_np([np.nan], [hi])[0], want, hi)
        self.assertEqual(rules.heat_score(85, 125), 9)   # greatest of the two
        self.assertEqual(rules.heat_score(90, 125), 10)

    def test_rain_boundaries(self):
        for mm, want in [(9.9, 0), (10, 2), (24.9, 2), (25, 4), (49.9, 4), (50, 6), (99.9, 6), (100, 9)]:
            self.assertEqual(rules.flood_score(mm), want, mm)
            self.assertEqual(rules.flood_rain_score_np([mm], None, None)[0], want, mm)

    def test_flood_multipliers_and_cap(self):
        self.assertEqual(rules.flood_score(25, zone="AE"), 5.2)             # 4 x 1.3
        self.assertEqual(rules.flood_score(25, river_m=5000), 4.8)          # <= 5 km: x 1.2
        self.assertEqual(rules.flood_score(25, river_m=5001), 4.0)
        self.assertEqual(rules.flood_score(25, river_m=25001), 3.2)         # > 25 km: x 0.8
        self.assertEqual(rules.flood_score(25, river_m=25000), 4.0)
        self.assertEqual(rules.flood_score(50, zone="AO", river_m=1000), 9.36)
        self.assertEqual(rules.flood_score(100, zone="VE", river_m=100), 10.0)  # 14.04 capped at 10
        self.assertEqual(rules.flood_score(100, zone="X"), 9.0)
        self.assertEqual(rules.flood_score(0, zone="AE", river_m=100), 0.0)  # never raised alone
        np.testing.assert_allclose(rules.flood_rain_score_np([25, 50, 100], "AO", 1000), [6.24, 9.36, 10.0])
        # Gauge and NWS warning paths of the SQL function.
        self.assertEqual(rules.flood_score(None, stage=10, flood_stage=10), 9.0)
        self.assertEqual(rules.flood_score(None, stage=8, flood_stage=10), 6.0)
        self.assertEqual(rules.flood_score(None, stage=8, flood_stage=0), 0.0)
        self.assertEqual(rules.flood_score(None, warning=1), 8.0)

    def test_gust_boundaries(self):
        for g, want in [(29.9, 0), (30, 3), (39.9, 3), (40, 6), (57.9, 6), (58, 9)]:
            self.assertEqual(rules.weather_score(None, g), want, g)
            self.assertEqual(rules.weather_score_np([g])[0], want, g)
        self.assertEqual(rules.weather_score(5, 0), 8)   # severity x 2, at most 8

    def test_soil_boundaries(self):
        for f, want in [(0.299, 0), (0.30, 2), (0.35, 4), (0.40, 6), (0.449, 6), (0.45, 8)]:
            self.assertEqual(rules.soil_score(f), want, f)
            self.assertEqual(rules.soil_score_np([f])[0], want, f)

    def test_wildfire(self):
        for mi, want in [(4.9, 10), (5, 8), (9.9, 8), (10, 6), (24.9, 6), (25, 3), (49.9, 3), (50, 1), (99, 1), (100, 0), (None, 0)]:
            self.assertEqual(rules.wildfire_score(mi), want, mi)

    def test_round_half(self):
        for x, want in [(3.12, 3.0), (5.2, 5.0), (4.8, 5.0), (2.4, 2.5), (1.6, 1.5), (9.36, 9.5), (7.25, 7.5), (0.24, 0.0)]:
            self.assertEqual(rules.round_half(x), want, x)
            self.assertEqual(float(rules.round_half_np([x])[0]), want, x)


if __name__ == "__main__":
    unittest.main()
