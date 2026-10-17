import unittest

import numpy as np
import pandas as pd

import train
from hazidx import config, model


def synthetic_site_days(plants=("A", "B", "C"), years=range(2019, 2026), seed=0) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    rows = []
    for eia in plants:
        dates = pd.date_range(f"{min(years)}-01-01", f"{max(years)}-12-31", freq="D")
        n = len(dates)
        doy = dates.dayofyear.to_numpy()
        season = np.sin(2 * np.pi * (doy - 100) / 365.25)
        d = pd.DataFrame({"date": dates, "eia_plant_id": eia})
        d["t_max"] = 75 + 15 * season + rng.normal(0, 4, n)
        d["hi_max"] = d["t_max"] + 5 + rng.normal(0, 3, n)
        d["wbgt_max"] = d["t_max"] - 8 + rng.normal(0, 2, n)
        for c in config.FEATURE_TIMING:
            if c not in d and c not in ("t_max_anom", "hi_max_anom"):
                d[c] = rng.gamma(2.0, 2.0, n)
        d["doy_sin"], d["doy_cos"] = np.sin(2 * np.pi * (doy - 1) / 365.25), np.cos(2 * np.pi * (doy - 1) / 365.25)
        logits = {"heat": -4 + 0.5 * (d["wbgt_max"] - 78), "storm": -5 + 0.3 * (d["gust_max"] - 4),
                  "flood": -5 + 0.2 * d["rain_24h"], "fire": -6 + 0.3 * d["vpd_max"]}
        for f, z in logits.items():
            d[f"y_{f}"] = (rng.uniform(size=n) < 1 / (1 + np.exp(-z))).astype("int8")
        d["y_any"] = d[[f"y_{f}" for f in config.FAMILIES]].max(axis=1)
        for c in ("rule_heat", "rule_wx", "rule_flood", "rule_soil"):
            d[c] = 0.0
        d["rule_max"] = np.where(d["wbgt_max"] > 85, 5.0, np.where(d["wbgt_max"] > 82, 3.0, 0.0))
        d["year"] = d["date"].dt.year
        d["month"] = d["date"].dt.month
        rows.append(d)
    return pd.concat(rows, ignore_index=True)


class FeatureTimingTest(unittest.TestCase):
    def test_every_feature_has_timing(self):
        for fam, feats in config.FAMILY_FEATURES.items():
            for f in feats:
                self.assertIn(config.FEATURE_TIMING.get(f), ("same_day", "past", "fixed"), (fam, f))

    def test_past_only_models_get_no_same_day_features(self):
        for fam in config.FAMILIES:
            past = model.features_for(fam, past_only=True)
            self.assertTrue(past, fam)
            self.assertFalse([f for f in past if config.FEATURE_TIMING[f] == "same_day"], fam)
        self.assertEqual(model.features_for("storm", past_only=True), ["doy_sin", "doy_cos"])


class CalibrationTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data = synthetic_site_days()
        cls.weights = {"heat": 1.0, "storm": 0.8, "flood": 0.75, "fire": 0.85}
        cls.bundle, cls.preds, cls.meta = train.train(cls.data, cls.weights, log=lambda *a: None)

    def test_folds_never_share_a_year(self):
        years = np.repeat(np.arange(2015, 2023), 30)
        folds = model.year_folds(years)
        self.assertEqual(len(folds), config.MAX_FOLDS)
        seen = np.zeros(len(years), int)
        for fit_idx, pred_idx in folds:
            self.assertFalse(set(years[fit_idx]) & set(years[pred_idx]))
            seen[pred_idx] += 1
        self.assertTrue(np.all(seen == 1))     # every training day predicted exactly once

    def test_every_training_day_has_one_oof_prediction(self):
        tr = self.preds[self.preds["split"] == "train_oof"]
        self.assertEqual(len(tr), int(self.data["year"].le(config.TRAIN_LAST_YEAR).sum()))
        for f in config.FAMILIES:
            self.assertFalse(tr[f"p_{f}"].isna().any(), f)

    def test_platt_bounded_and_increasing(self):
        raw = np.linspace(0.0, 1.0, 501)
        for f in config.FAMILIES:
            p = self.bundle["families"][f]["full"].platt(raw)
            self.assertTrue(np.all((p > 0) & (p < 1)), f)
            self.assertTrue(np.all(np.diff(p) >= 0), f)

    def test_no_selection_year_in_calibration_or_scale(self):
        self.assertEqual(self.meta["calibration_rows_years"], [2019, 2020, 2021, 2022])
        self.assertEqual(self.meta["tier_map_rows_years"], [2019, 2020, 2021, 2022])
        self.assertNotIn(config.SELECT_YEAR, self.meta["calibration_rows_years"])
        self.assertNotIn(config.SELECT_YEAR, self.bundle["train_years"])

    def test_scores_on_scale(self):
        s = self.preds["score"].to_numpy()
        self.assertTrue(np.all((s >= 0) & (s <= 10)))
        self.assertTrue(np.allclose(s * 10, np.round(s * 10)))
        self.assertTrue(set(self.preds["top_driver"]) <= set(config.FAMILIES))

    def test_model_learns_signal(self):
        test = self.preds[self.preds["split"] == "test"]
        from sklearn.metrics import roc_auc_score
        self.assertGreater(roc_auc_score(test["y_heat"], test["p_heat"]), 0.7)


if __name__ == "__main__":
    unittest.main()
