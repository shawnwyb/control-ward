"""Every tunable number of the Hazard Index lives here, so a reviewer can audit them in one place."""
from __future__ import annotations

import re

MODEL_NAME = "hazidx"

# ---------------------------------------------------------------- hazard families and labels
FAMILIES = ("heat", "storm", "flood", "fire")

# Storm Events EVENT_TYPE -> family. Heat uses a pattern because NWS renamed "Excessive Heat"
# to "Extreme Heat" in 2025.
HEAT_PATTERN = re.compile(r"^(excessive |extreme )?heat$", re.IGNORECASE)
EVENT_TYPES = {
    "storm": ("Thunderstorm Wind", "Hail", "Lightning", "Tornado"),
    "flood": ("Flash Flood", "Flood", "Heavy Rain"),
    "fire": ("Wildfire", "Dense Smoke"),
}

RADIUS_KM = 25.0          # a county event with coordinates matches if its track passes this close
EVENT_DAY_CAP = 14        # at most this many local days per event (some wildfire records last weeks)

# ---------------------------------------------------------------- years
YEARS = tuple(range(2015, 2026))
TRAIN_LAST_YEAR = 2022    # training years are every downloaded year up to this one
SELECT_YEAR = 2023        # model selection only; nothing is fitted on it
TEST_YEARS = (2024, 2025)
MAX_FOLDS = 5             # GroupKFold by year, one group per year
V2_MIN_TRAIN_YEARS = 6    # with this many training years, use the Version 2 settings grid

# ---------------------------------------------------------------- weather download (Open-Meteo)
ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"
FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
ECMWF_URL = "https://api.open-meteo.com/v1/ecmwf"
ARCHIVE_MODEL = "era5_seamless"
ARCHIVE_VARS = (
    "temperature_2m", "relative_humidity_2m", "wind_speed_10m", "wind_gusts_10m",
    "shortwave_radiation", "precipitation", "soil_moisture_0_to_7cm", "soil_moisture_7_to_28cm",
    "pressure_msl",
)
UNITS = {"temperature_unit": "fahrenheit", "wind_speed_unit": "mph", "precipitation_unit": "mm"}
DAY1_BUDGET = 8_500       # weighted calls for the first run; leaves room for the dry-run and teammates
DAILY_LIMIT = 10_000      # Open-Meteo free tier
HOURLY_PACE = 4_500       # stay under the 5,000 calls/hour limit
MINUTELY_PACE = 540       # stay under the 600 calls/minute limit

# ---------------------------------------------------------------- features
# Every model input and when it is known at scoring time (see "Feature timing" in the plan):
#   same_day  describes the target day: a forecast when scoring live
#   past      describes earlier days: already observed when scoring live
#   fixed     season and the plant's monthly normals: known exactly
FEATURE_TIMING = {
    "wbgt_max": "same_day", "hi_max": "same_day", "t_max": "same_day", "t_min": "same_day",
    "td_max": "same_day", "rh_min": "same_day", "wbgt_hours_85": "same_day",
    "t_max_anom": "same_day", "hi_max_anom": "same_day",
    "gust_max": "same_day", "wind_max": "same_day", "rain_hr_max": "same_day",
    "p_drop_24h": "same_day", "sw_sum": "same_day",
    "rain_24h": "same_day", "rain_overnight": "same_day", "rain_hours_1mm": "same_day",
    "vpd_max": "same_day",
    "wbgt_max_prev2": "past", "rain_prev3d": "past", "rain_prev7d": "past", "rain_prev30d": "past",
    "dry_days": "past",
    # Soil moisture is a same-day value, but it changes slowly and mostly reflects past rain,
    # so the plan counts it with the past-data inputs.
    "sm07_mean": "past", "sm07_max": "past", "sm728_mean": "past",
    "doy_sin": "fixed", "doy_cos": "fixed",
}
SEASON = ("doy_sin", "doy_cos")
FAMILY_FEATURES = {
    "heat": ("wbgt_max", "hi_max", "t_max", "t_min", "td_max", "rh_min", "wbgt_hours_85",
             "wbgt_max_prev2", "t_max_anom", "hi_max_anom") + SEASON,
    "storm": ("gust_max", "wind_max", "rain_hr_max", "p_drop_24h", "sw_sum") + SEASON,
    "flood": ("rain_24h", "rain_overnight", "rain_prev3d", "rain_prev7d", "rain_hours_1mm",
              "sm07_mean", "sm07_max", "sm728_mean") + SEASON,
    "fire": ("vpd_max", "rh_min", "wind_max", "gust_max", "t_max_anom", "dry_days",
             "rain_prev30d") + SEASON,
}
# The prediction can only rise as these rise.
MONOTONE = {
    "heat": ("wbgt_max", "hi_max"),
    "storm": ("gust_max",),
    "flood": ("rain_24h", "rain_prev3d"),
    "fire": (),
}
MIN_DAY_HOURS = 20        # a day (or a dry-run horizon) with fewer hours of data is skipped
DRY_DAY_MM = 1.0          # a day with less rain than this counts as dry
DRIFT_PCT = (0.5, 99.5)   # dry-run flags features outside this percentile range of the training data

# ---------------------------------------------------------------- models
TREE_FIXED = {"max_leaf_nodes": 15, "l2_regularization": 5.0, "learning_rate": 0.05}
GRID_V1 = {"min_samples_leaf": (30, 50), "max_iter": (150, 300)}
GRID_V2 = {"min_samples_leaf": (50, 100), "max_iter": (150, 300)}
FIRE_C = 1.0              # inverse L2 strength of the fire logistic regression
CLIM_PSEUDO_DAYS = 100    # plant-month climatology is smoothed toward the family's monthly rate
BOOTSTRAP = 200           # plant resamples for uncertainty ranges
SEED = 20261017

# ---------------------------------------------------------------- severity weights (OSHA SIR)
NAICS_PREFIXES = ("2211", "237")
OSHA_START, OSHA_END = "2015-01-01", "2025-11-30"
PRIOR_INJURIES = 5.0      # Gamma-Poisson prior strength
WEIGHT_MIN = 0.75         # log-scale weights run from this to 1.0

# ---------------------------------------------------------------- 0-10 scale
TIER_MIN_DAYS = 50
TIER_FALLBACK = ((0.0, 0.0), (0.05, 3.0), (0.20, 7.5), (0.40, 10.0))
TIERS = ((10.0, "stop"), (7.5, "warning"), (3.0, "watch"), (0.0, "none"))
ESCALATION_POINTS = 2.0

NWS_USER_AGENT = "PlanIT-Control-hazidx/0.1 (SwampHacks 2026 research prototype)"
