"""STRAM equations in US customary units, ported from example_stram_usa_converter.py (Jones & Arp 2019).

Changes from the converter, all covered by tests/test_equations.py:
- Eq 4 is multiplied by config.EQ4_NCI_SCALE so it reproduces the paper's Table 5 NCI.
- Eq 5 clamps NCI_adj to the study range and holds Z at its minimum past NCI* = 1 / (b ln Passes), where the
  published form turns and starts rising with soil strength.
- Eq 2 is not used: its elevation term is specific to the New Brunswick blocks.
Arrays broadcast, so the same calls work on a scalar or a whole raster.
"""
from __future__ import annotations

from typing import Any, Mapping

import numpy as np

from . import config as C


def porosity(db_g_cm3, particle_density: float = 2.65):
    """Total porosity, as in the converter's adapt_ssurgo_dataframe."""
    return np.clip(1.0 - np.asarray(db_g_cm3, dtype=float) / particle_density, 0.05, 0.95)


def mc_ps_from_theta(theta_v, db_g_cm3):
    """Pore-filled moisture (%) from volumetric moisture (m3/m3). The study's MC_PS is this, not theta."""
    return np.clip(100.0 * np.asarray(theta_v, dtype=float) / porosity(db_g_cm3), 0.0, 100.0)


def eq1_mc_ps_dtw(dtw_ft, dtw_top_ft, mc_ps_top, k_per_m: float = C.K_MC_PER_M, p: float = C.P_MC):
    """Eq 1: moisture rises from the ridge-top value to 100 % where DTW = 0 (a flow channel)."""
    k = k_per_m / C.M_TO_FT
    dtw = np.maximum(np.asarray(dtw_ft, dtype=float), 0.0)
    top = np.maximum(np.asarray(dtw_top_ft, dtype=float), 1e-6)
    ratio = np.clip((1.0 - np.exp(-k * dtw)) / (1.0 - np.exp(-k * top)), 0.0, 1.0)
    return 100.0 - (100.0 - np.asarray(mc_ps_top, dtype=float)) * ratio ** p


def eq3_ci_psi(mc_ps, depth_in=C.CI_DEPTH_IN, track=0, sw=0):
    """Eq 3 (Table 7 coefficients), returned in psi. Floored at 0.1 MPa so Eq 4 stays defined."""
    c = C.EQ3
    ci_mpa = (c["b0"] + c["mc"] * np.asarray(mc_ps, dtype=float) + c["depth_cm"] / C.CM_TO_IN * depth_in
              + c["track"] * np.asarray(track, dtype=float) + c["sw"] * sw)
    return np.maximum(ci_mpa, 0.1) * C.MPA_TO_PSI


def tire_deflection_in(tire_load_lbf, pressure_psi):
    """delta = 0.001 (0.365 + 170 / p_kPa) W_kN, in inches with W in lbf and p in psi."""
    return 0.001 * (C.M_TO_IN / C.KN_TO_LBF) * (0.365 + 170.0 * C.KPA_TO_PSI / pressure_psi) * tire_load_lbf


def eq4_nci(ci_psi, diameter_in, width_in, section_height_in, tire_load_lbf, pressure_psi,
            scale: float = C.EQ4_NCI_SCALE):
    """Eq 4, dimensionless. psi * in * in / lbf needs no factor; scale=1 gives the formula as published."""
    delta = tire_deflection_in(tire_load_lbf, pressure_psi)
    geom = np.sqrt(delta / section_height_in) / (1.0 + width_in / (2.0 * diameter_in))
    return scale * np.asarray(ci_psi, dtype=float) * width_in * diameter_in / tire_load_lbf * geom


def reference_nci(ci_psi):
    """NCI of the reference forwarder (JD1510E) as the paper computed it: a fixed 2.008 per MPa of CI (Table 5,
    Blocks 1 and 2). Eq 5 was fitted on these values, so feeding it this scale keeps the chain consistent. Eq 4 with
    Table 3's specs cannot reproduce them (see PROJECT_BRIEF.md, Eq 4 mismatch)."""
    return C.REFERENCE_NCI_PER_MPA * np.asarray(ci_psi, dtype=float) / C.MPA_TO_PSI


def equipment_nci(ci_psi, equipment: C.Equipment, scale: float = C.EQ4_NCI_SCALE):
    """Lowest NCI over the machine's axle groups, i.e. its worst-loaded tire."""
    if equipment.kind != "wheeled":
        raise ValueError(f"{equipment.key} is tracked; Eq 4 covers tires only")
    return np.minimum.reduce([
        eq4_nci(ci_psi, a.diameter_in, a.width_in, a.section_height_in, a.tire_load_lbf, a.pressure_psi, scale)
        for a in equipment.axles
    ])


def eq5_rut_in(nci, passes: int, dtw_ft, cf_frac=0.0, guard: bool = True):
    """Eq 5 x Eq 7: rut depth (in). Returns (z_in, nci_used, out_of_range) where out_of_range marks cells whose
    NCI_adj fell outside the study range before clamping."""
    if guard and passes not in C.PASSES_ALLOWED:
        raise ValueError(f"passes must be one of {C.PASSES_ALLOWED}: Eq 5 misbehaves at high pass counts")
    nci_adj = np.asarray(nci, dtype=float) + C.EQ5_DTW_PER_M / C.M_TO_FT * np.asarray(dtw_ft, dtype=float)
    lo, hi = C.NCI_ADJ_RANGE
    out = (nci_adj < lo) | (nci_adj > hi)
    n = np.clip(nci_adj, lo, hi) if guard else nci_adj
    if guard and passes > 1:
        n = np.minimum(n, 1.0 / (C.EQ5_B * np.log(passes)))
    z_cm = C.EQ5_A_CM / n * float(passes) ** (C.EQ5_B * n) * (1.0 - np.clip(cf_frac, 0.0, 1.0)) ** 2
    return z_cm * C.CM_TO_IN, n, out


def adapt_soil(row: Mapping[str, Any]) -> dict[str, float | None]:
    """ssurgo_fetch.py output columns -> STRAM inputs (the converter's adapter expects SSURGO's raw names)."""
    def num(key):
        v = row.get(key)
        try:
            v = float(v)
        except (TypeError, ValueError):
            return None
        return None if np.isnan(v) else v
    cf = num("coarse_frag_pct")
    return {
        "sand_pct": num("sand_pct"), "om_pct": num("om_pct"), "bulk_density_g_cm3": num("bulk_density_g_cm3"),
        "coarse_frag_pct": cf, "cf_frac": None if cf is None else cf / 100.0,
        "wt_depth_ft": None if num("wt_depth_annual_min_cm") is None else num("wt_depth_annual_min_cm") / 100.0 * C.M_TO_FT,
    }


def domain_reasons(soil: Mapping[str, Any]) -> list[str]:
    """Which soil inputs fall outside the study's Table 5 ranges."""
    reasons = []
    for key, (lo, hi) in C.DOMAIN.items():
        v = soil.get(key)
        if v is not None and not lo <= v <= hi:
            reasons.append(f"{key} {v:.3g} outside {lo:g}-{hi:g}")
    return reasons


def is_organic(om_pct, uscs) -> bool:
    return (om_pct is not None and om_pct > C.ORGANIC_OM_PCT) or (uscs or "").upper().startswith("PT")
