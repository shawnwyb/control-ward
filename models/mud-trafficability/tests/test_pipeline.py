"""Terrain, DTW_eff, site parsing, scoring summary and the push SQL, without network access."""
import csv
import tempfile
import unittest
from pathlib import Path

import numpy as np

from stram import config as C, forecast as F, push, terrain
from stram.sites import load_sites


def valley(n=60, res=10.0):
    """A V-shaped valley draining south: the channel runs down the middle column."""
    y, x = np.mgrid[0:n, 0:n]
    dem = np.abs(x - n // 2) * 0.5 + (n - y) * 0.2 + 100.0
    return dem.astype(np.float64), terrain.Grid(32617, 500000.0, 3000000.0, res, n)


class DepthToWater(unittest.TestCase):
    def test_zero_in_the_channel_and_rising_up_the_slopes(self):
        dem, grid = valley()
        acc = terrain.flow_accumulation(dem, grid)
        dtw = terrain.depth_to_water(dem, acc, grid.res, fia_ha=1.0)
        row = dtw[50]  # well downstream, where the channel exists
        mid = grid.n // 2
        self.assertLess(row[mid], 0.05)
        self.assertTrue(np.all(np.diff(row[mid:]) >= -1e-6))
        self.assertTrue(np.all(np.diff(row[:mid + 1]) <= 1e-6))
        self.assertGreater(row[0], 5.0)

    def test_smaller_fia_means_more_channels_and_lower_dtw(self):
        dem, grid = valley()
        acc = terrain.flow_accumulation(dem, grid)
        wet = terrain.depth_to_water(dem, acc, grid.res, fia_ha=0.25)
        dry = terrain.depth_to_water(dem, acc, grid.res, fia_ha=8.0)
        self.assertLessEqual(float(np.median(wet)), float(np.median(dry)))


class EffectiveDTW(unittest.TestCase):
    def soil(self, wt_cm, drainage):
        wt = np.array([wt_cm], dtype=float)
        return {"wt_depth_annual_min_cm": wt,
                "well_drained_no_wt": np.isin(np.array([drainage], dtype=object), C.WELL_DRAINED) & np.isnan(wt)}

    def test_water_table_caps_dtw_in_wet_forecasts(self):
        for wet in ("moist", "wet"):
            d = F.dtw_effective(np.array([3.0]), self.soil(15.0, "Poorly drained"), wet)
            self.assertAlmostEqual(float(d[0]), 0.15 * C.M_TO_FT)

    def test_annual_min_water_table_ignored_on_dry_days(self):
        # It is the year's shallowest (wet-season) depth; on dry days the DEM DTW stands.
        for wet in ("very_dry", "dry"):
            d = F.dtw_effective(np.array([3.0]), self.soil(15.0, "Poorly drained"), wet)
            self.assertAlmostEqual(float(d[0]), 3.0 * C.M_TO_FT)

    def test_no_water_table_and_well_drained_floors_dtw(self):
        for wet in ("dry", "wet"):
            d = F.dtw_effective(np.array([0.1]), self.soil(np.nan, "Well drained"), wet)
            self.assertAlmostEqual(float(d[0]), C.NO_WATER_TABLE_DTW_M * C.M_TO_FT)

    def test_unknown_water_table_on_wet_soil_keeps_dem_dtw(self):
        d = F.dtw_effective(np.array([0.1]), self.soil(np.nan, "Poorly drained"), "wet")
        self.assertAlmostEqual(float(d[0]), 0.1 * C.M_TO_FT)


class Summaries(unittest.TestCase):
    def test_weighted_p90_ignores_a_short_bad_segment(self):
        self.assertEqual(F._weighted_p90([6.5, 2.0, 2.0], np.array([10.0, 500.0, 500.0])), 2.0)
        self.assertEqual(F._weighted_p90([6.5, 2.0], np.array([500.0, 500.0])), 6.5)


class Sites(unittest.TestCase):
    def test_hosted_sites(self):
        sites = load_sites()
        self.assertEqual(len(sites), 60)
        self.assertEqual(len({s.eia for s in sites}), 60)
        self.assertEqual([s.name for s in load_sites(eia=["649", "56407"])], ["Vogtle", "West County Energy Center"])
        with self.assertRaises(ValueError):
            load_sites(eia=["999999"])


class PushSQL(unittest.TestCase):
    def test_scores_take_worst_machine_at_default_passes(self):
        with tempfile.TemporaryDirectory() as tmp:
            run = Path(tmp)
            rows = [
                {"eia": "649", "horizon": "now", "passes": C.DEFAULT_PASSES, "score": 4.0, "score_p90": 2.0},
                {"eia": "649", "horizon": "now", "passes": C.DEFAULT_PASSES, "score": 6.5, "score_p90": 4.0},
                {"eia": "649", "horizon": "now", "passes": 10, "score": 10.0, "score_p90": 10.0},
                {"eia": "649", "horizon": "d1", "passes": C.DEFAULT_PASSES, "score": 2.0, "score_p90": 1.0},
                {"eia": "649", "horizon": "d2", "passes": C.DEFAULT_PASSES, "score": 9.0, "score_p90": 9.0},
            ]
            with open(run / "sites.csv", "w", newline="") as f:
                w = csv.DictWriter(f, fieldnames=list(rows[0]))
                w.writeheader()
                w.writerows(rows)
            self.assertEqual(push.site_scores(run), {("649", "now"): 6.5, ("649", "tomorrow"): 2.0})
            self.assertEqual(push.site_scores(run, "p90"), {("649", "now"): 4.0, ("649", "tomorrow"): 1.0})
            path, n = push.write_push_sql(run)
            sql = path.read_text()
            self.assertEqual(n, 2)
            self.assertIn("('649', 'now', 6.5)", sql)
            self.assertIn(C.MODEL_VERSION, sql)
            path, _ = push.write_push_sql(run, clear=True)
            self.assertIn(f"delete from public.ml_scores where model_version = '{C.MODEL_VERSION}'", path.read_text())


if __name__ == "__main__":
    unittest.main()
