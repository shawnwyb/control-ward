"""Model building blocks: estimators, year-grouped out-of-fold predictions, Platt calibration.

Calibration is written here directly (a logistic regression of the label on logit(raw p), fitted
on out-of-fold predictions from the training years) instead of scikit-learn's cv='prefit', which is
being deprecated. No isotonic regression and no resampling or class weights: the severity product
needs probabilities on their true scale.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from itertools import product

import numpy as np
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import GroupKFold
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

from . import config

EPS = 1e-6


def features_for(family: str, past_only: bool = False) -> list[str]:
    feats = list(config.FAMILY_FEATURES[family])
    if past_only:
        feats = [f for f in feats if config.FEATURE_TIMING[f] in ("past", "fixed")]
    return feats


def settings_grid(n_train_years: int) -> list[dict]:
    grid = config.GRID_V2 if n_train_years >= config.V2_MIN_TRAIN_YEARS else config.GRID_V1
    return [{"min_samples_leaf": a, "max_iter": b} for a, b in product(grid["min_samples_leaf"], grid["max_iter"])]


def make_estimator(family: str, features: list[str], params: dict | None = None):
    if family == "fire":
        # Too few separate fire events for trees.
        return make_pipeline(SimpleImputer(strategy="median"), StandardScaler(),
                             LogisticRegression(C=config.FIRE_C, max_iter=2000))
    params = params or {"min_samples_leaf": config.GRID_V1["min_samples_leaf"][0], "max_iter": config.GRID_V1["max_iter"][0]}
    mono = [1 if f in config.MONOTONE[family] else 0 for f in features]
    return HistGradientBoostingClassifier(**config.TREE_FIXED, **params, monotonic_cst=mono,
                                          early_stopping=False, random_state=config.SEED)


def raw_proba(est, X: np.ndarray) -> np.ndarray:
    return est.predict_proba(X)[:, 1]


def logit(p: np.ndarray) -> np.ndarray:
    p = np.clip(np.asarray(p, float), EPS, 1 - EPS)
    return np.log(p / (1 - p))


@dataclass
class Platt:
    a: float = 1.0
    b: float = 0.0

    @classmethod
    def fit(cls, raw: np.ndarray, y: np.ndarray) -> "Platt":
        lr = LogisticRegression(C=1e6, max_iter=1000)
        lr.fit(logit(raw).reshape(-1, 1), y)
        return cls(float(lr.coef_[0, 0]), float(lr.intercept_[0]))

    def __call__(self, raw: np.ndarray) -> np.ndarray:
        return 1 / (1 + np.exp(-(self.a * logit(raw) + self.b)))


def year_folds(years: np.ndarray) -> list[tuple[np.ndarray, np.ndarray]]:
    """GroupKFold with one group per year and at most MAX_FOLDS folds: no year is in both the fitting
    part and the predicting part of a fold."""
    n = min(config.MAX_FOLDS, len(np.unique(years)))
    if n < 2:
        raise ValueError("out-of-fold predictions need at least 2 training years")
    return list(GroupKFold(n_splits=n).split(np.zeros(len(years)), groups=years))


def oof_raw(family: str, features: list[str], params: dict | None, X: np.ndarray, y: np.ndarray,
            years: np.ndarray) -> np.ndarray:
    """One out-of-fold raw probability for every training day."""
    out = np.full(len(y), np.nan)
    for fit_idx, pred_idx in year_folds(years):
        est = make_estimator(family, features, params)
        if y[fit_idx].sum() == 0:
            out[pred_idx] = 0.0
            continue
        est.fit(X[fit_idx], y[fit_idx])
        out[pred_idx] = raw_proba(est, X[pred_idx])
    return out


@dataclass
class FamilyModel:
    family: str
    features: list[str]
    params: dict | None
    estimator: object = None
    platt: Platt = field(default_factory=Platt)

    def predict(self, X: np.ndarray) -> np.ndarray:
        return self.platt(raw_proba(self.estimator, X))


def log_loss(y: np.ndarray, p: np.ndarray) -> float:
    p = np.clip(p, EPS, 1 - EPS)
    return float(-np.mean(y * np.log(p) + (1 - y) * np.log(1 - p)))


def combine(probs: dict[str, np.ndarray], weights: dict[str, float]) -> tuple[np.ndarray, np.ndarray]:
    """R = max over families of s_h * p_h, and the family that gives it (the top driver)."""
    fams = list(probs)
    m = np.vstack([weights[f] * np.asarray(probs[f], float) for f in fams])
    return m.max(axis=0), np.array(fams)[m.argmax(axis=0)]
