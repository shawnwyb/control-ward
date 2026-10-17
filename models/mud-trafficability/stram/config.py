"""Constants for the STRAM-inspired rutting model. See ../PROJECT_BRIEF.md for where each value comes from.

Units: the pipeline runs in US customary (in, ft, psi, lbf). Study coefficients are kept in their published
SI form here and converted in equations.py, so every number can be checked against the paper.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]  # models/mud-trafficability
REPO = ROOT.parents[1]
CACHE = ROOT / "cache"
OUTPUT = ROOT / "output"
SEED_SITES = REPO / "supabase" / "seed-sites.sql"
SOIL_DIR = REPO / "data" / "soil-data"
SOIL_FIXTURE = SOIL_DIR / "example_soil_plants.csv"
FLOOD_CSV = REPO / "data" / "flood-data" / "long_range_river_flood_risk_data.csv"
CONVERTER = ROOT / "example_stram_usa_converter.py"

MODEL_VERSION = "stram-inspired-nrcs-0.1"
LABEL = "STRAM-inspired, uncalibrated. Prioritizes inspection; does not certify a crossing is safe."
UNITS = {"z": "in (x 2.54 = cm)", "ci": "psi (/ 145.04 = MPa)", "dtw": "ft (/ 3.281 = m)", "length": "ft",
         "area": "acres", "rain": "in", "theta": "m3/m3", "mc_ps": "% of pore space"}

# Unit conversions (same constants as example_stram_usa_converter.py).
MPA_TO_PSI = 145.03773773
KPA_TO_PSI = 0.14503773773
KN_TO_LBF = 224.8089431
M_TO_IN = 39.37007874
CM_TO_IN = 0.3937007874
M_TO_FT = 3.280839895
SQM_TO_ACRES = 0.000247105381

# Grid and routes.
GRID_RES_M = 10.0
TILE_RADIUS_M = 2500.0
ROUTE_RADIUS_M = 2000.0
SEGMENT_M = 100.0
CORRIDOR_FT = 100.0  # affected areas and acres are counted within this distance of a mapped route
FIA_HA = (0.25, 1.0, 4.0, 8.0, 16.0)

# Eq 1 calibration, Jones & Arp (2019) OJF 9:109-142: k_mc = 0.5 per metre of DTW, p_mc = 1.5.
K_MC_PER_M = 0.5
P_MC = 1.5

# Eq 3, Table 7 coefficients (CI in MPa, depth in cm). SW and HW are 0: a cleared corridor is neither stand type.
EQ3 = {"b0": 1.599, "mc": -0.011, "depth_cm": 0.025, "track": 0.760, "sw": 0.397}
CI_DEPTH_IN = 6.0  # the study sampled the top 15 cm

# Eq 4 as published gives NCI 3.65-4.26x the Table 5 means for the study's own machines. This factor is the
# minimax fit to Table 5 (max error about 8 %); tests/test_equations.py recomputes it. Cause unknown.
EQ4_NCI_SCALE = 0.253

# Eq 5 / Table 7: Z_cm = a / NCI_adj * Passes ** (b * NCI_adj), NCI_adj = NCI + 0.48 * DTW_m.
EQ5_A_CM = 40.886
EQ5_B = 0.072
EQ5_DTW_PER_M = 0.48
EQ5_RMSE_CM = 9.0
NCI_ADJ_RANGE = (2.48, 9.5)  # Table 5 NCI min, NCI max + 0.48 * DTW max
PASSES_ALLOWED = (1, 2, 5, 10)
# Default view is one loaded crossing (agreed 2026-10-17). At 2+ passes the ground index sits near the 4 in line on
# most firm ground in any weather, as the study implies (its blocks averaged 13-22 cm). One pass is below the study's
# observed minimum of 2, a mild extrapolation that is labeled in every output.
DEFAULT_PASSES = 1
PASSES_SHOWN = (1, 2, 10)
PASSES_NOTE = "1 pass is below the study's observed range (2-80 passes): mild extrapolation of Eq 5 (Z = a/NCI_adj)."

# Flags. 4 in and 8 in are the agreed 10 cm and 20 cm, rounded for US display.
INSPECT_IN = 4.0
HOLD_IN = 8.0
FLAGS = ("ok", "inspect", "hold")
FLAG_SCORE = {"ok": 0.0, "inspect": 4.0, "hold": 6.5}
SCORE_KNOTS_IN = ((0.0, 0.0), (2.0, 2.0), (4.0, 4.0), (8.0, 6.5), (16.0, 9.0), (24.0, 10.0))
WET_AREA_DTW_FT = 0.5 * M_TO_FT  # study 3.1 / Fig 8: ruts > 40 cm where DTW < 0.5 m
# DTW_eff: SSURGO's shallowest annual water table caps the DEM DTW. Where SSURGO has none and the soil is well
# drained, NRCS means no water table within 200 cm, so DTW_eff is at least 2 m (flat arid ground otherwise reads wet).
NO_WATER_TABLE_DTW_M = 2.0
WELL_DRAINED = ("Well drained", "Somewhat excessively drained", "Excessively drained")
DTW_TOP_PERCENTILE = 95  # the study used DTW at the block's highest point; a percentile is steadier on 10 m data
GROUND_BAND_IN = EQ5_RMSE_CM * CM_TO_IN

# Wetness class from 72 h antecedent plus same-day rain (in). Follows Table 8's pattern; thresholds are ours.
WETNESS_RAIN_IN = (0.2, 0.8, 2.0)
WETNESS_CLASSES = ("very_dry", "dry", "moist", "wet")
WETNESS_FIA_HA = {"very_dry": 8.0, "dry": 4.0, "moist": 1.0, "wet": 0.25}

# Study calibration domain (Table 5 min and max over Blocks 1, 2, 3 and 9).
DOMAIN = {
    "sand_pct": (32.31, 65.16),
    "om_pct": (4.41, 13.30),
    "bulk_density_g_cm3": (0.63, 1.20),
    "coarse_frag_pct": (21.23, 48.14),
}
ORGANIC_OM_PCT = 20.0

# NRCS MIL trafficability classes, checked on SDA 2026-10-17: Poor 0-0.49, Fair 0.50-0.73, Good 0.79-0.90,
# Excellent 0.92-1. Higher is better.
MIL_POOR_BELOW = 0.50
MIL_GOOD_FROM = 0.76

OPEN_METEO_MODELS = ("best_match", "icon_seamless", "ecmwf_ifs025")  # the ones with 3-9 and 9-27 cm soil layers
FORECAST_DAYS = 7


@dataclass(frozen=True)
class AxleGroup:
    load_lbf: float  # load on the group
    tires: int
    diameter_in: float
    width_in: float
    section_height_in: float
    pressure_psi: float

    @property
    def tire_load_lbf(self) -> float:
        return self.load_lbf / self.tires


@dataclass(frozen=True)
class Equipment:
    key: str
    label: str
    kind: str  # "wheeled" or "tracked"
    mil_type: int  # NRCS MIL vehicle type. Assumed mapping; verify against FM 5-430-00-1 Table 7-3.
    gross_lbf: float
    axles: tuple[AxleGroup, ...] = field(default=())
    ground_pressure_psi: float | None = None  # tracked, display only


# STRAM runs only for the study's own machine, a loaded John Deere 1510E forwarder (Table 3: 169.66 kN + 117.68 kN
# on 8 tires of 710/45-26.5 at 32 psi). Road trucks at 100+ psi fall below the study's NCI range: with the Table 5
# rescale every truck clamps to the same 7.3 in on native ground. So the forwarder result is used as a
# ground-condition index, and trucks get their machine-specific signal from NRCS MIL type 7 instead (agreed
# 2026-10-17).
REFERENCE_FORWARDER = Equipment(
    "reference_forwarder", "Study forwarder (JD1510E, loaded)", "wheeled", 0, (169.66 + 117.68) * KN_TO_LBF,
    (AxleGroup((169.66 + 117.68) * KN_TO_LBF, 8, diameter_in=134.1 * CM_TO_IN, width_in=71.1 * CM_TO_IN,
               section_height_in=33.4 * CM_TO_IN, pressure_psi=32.0),),
)

# Machine classes shown to users. Bucket/line, dump and lowboy trucks are all rear-wheel-drive road trucks, NRCS
# MIL type 7, so the model can't tell them apart without fleet-specific validation.
EQUIPMENT: dict[str, Equipment] = {e.key: e for e in (
    Equipment("road_truck", "Road trucks: bucket/line, dump, lowboy", "wheeled", 7, 130_000),
    Equipment("excavator", "Tracked excavator (30 t)", "tracked", 3, 66_000, ground_pressure_psi=7.5),
    Equipment("crawler_crane", "Crawler crane (100 t)", "tracked", 4, 220_000, ground_pressure_psi=13.5),
)}
