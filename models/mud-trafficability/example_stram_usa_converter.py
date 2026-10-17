"""
STRAM (Soil Trafficability Model) Unit Converter & USDA SSURGO Adapter
Reference: Jones, M.-F., & Arp, P. (2019). Soil Trafficability Forecasting.
Open Journal of Forestry, 9, 296-322.

Automates:
1. Bidirectional unit conversions between Metric (SI) and US Customary (Imperial) units.
2. STRAM equations (Eq. 1 to 7) in both SI and US Customary units.
3. USDA-NRCS SSURGO / gNATSGO tabular/raster field mapping to STRAM inputs.
4. Machine presets from Table 3 (JD1110E, JD1510E, Tigercat 635D).
"""

from dataclasses import dataclass
from typing import Dict, Union, Optional
import numpy as np
import pandas as pd


# =====================================================================
# 1. CONVERSION CONSTANTS
# =====================================================================
MPA_TO_PSI = 145.03773773
KPA_TO_PSI = 0.14503773773
KN_TO_LBF = 224.8089431
M_TO_IN = 39.37007874
CM_TO_IN = 0.3937007874
M_TO_FT = 3.280839895
HA_TO_ACRES = 2.471053815
GCM3_TO_LBFT3 = 62.42796058
TONNE_TO_SHORT_TON = 1.10231131


# =====================================================================
# 2. MACHINE SPECIFICATIONS (Table 3)
# =====================================================================
@dataclass
class MachineTireAxleSpec:
    name: str
    axle: str
    vehicle_weight_kN: float
    full_load_kN: float
    num_wheels_total: int
    num_wheels_axle: int
    diameter_m: float
    section_height_m: float
    width_m: float
    pressure_psi: float

    @property
    def pressure_kPa(self) -> float:
        return self.pressure_psi / KPA_TO_PSI

    @property
    def wheel_load_kN(self) -> float:
        """Total loaded weight divided equally across all tires (Eq. 4 definition)."""
        return (self.vehicle_weight_kN + self.full_load_kN) / self.num_wheels_total

    @property
    def wheel_load_lbf(self) -> float:
        return self.wheel_load_kN * KN_TO_LBF

    @property
    def diameter_in(self) -> float:
        return self.diameter_m * M_TO_IN

    @property
    def section_height_in(self) -> float:
        return self.section_height_m * M_TO_IN

    @property
    def width_in(self) -> float:
        return self.width_m * M_TO_IN


MACHINE_PRESETS: Dict[str, MachineTireAxleSpec] = {
    "JD1110E": MachineTireAxleSpec(
        name="John Deere 1110E",
        axle="Front/Rear (8-wheel)",
        vehicle_weight_kN=161.81,
        full_load_kN=107.87,
        num_wheels_total=8,
        num_wheels_axle=4,
        diameter_m=1.341,
        section_height_m=0.334,
        width_m=0.711,
        pressure_psi=32.0,
    ),
    "JD1510E": MachineTireAxleSpec(
        name="John Deere 1510E",
        axle="Front/Rear (8-wheel)",
        vehicle_weight_kN=169.66,
        full_load_kN=117.68,
        num_wheels_total=8,
        num_wheels_axle=4,
        diameter_m=1.341,
        section_height_m=0.334,
        width_m=0.711,
        pressure_psi=32.0,
    ),
    "TC635D_Front": MachineTireAxleSpec(
        name="Tigercat 635D (Front 2-wheel)",
        axle="Front",
        vehicle_weight_kN=209.86,
        full_load_kN=147.10,
        num_wheels_total=6,
        num_wheels_axle=2,
        diameter_m=2.012,
        section_height_m=0.516,
        width_m=0.902,
        pressure_psi=32.0,
    ),
    "TC635D_Rear": MachineTireAxleSpec(
        name="Tigercat 635D (Rear 4-wheel bogie)",
        axle="Rear",
        vehicle_weight_kN=209.86,
        full_load_kN=147.10,
        num_wheels_total=6,
        num_wheels_axle=4,
        diameter_m=1.844,
        section_height_m=0.599,
        width_m=0.775,
        pressure_psi=32.0,
    ),
}


# =====================================================================
# 3. STRAM MODEL ENGINE (METRIC SI & US CUSTOMARY)
# =====================================================================
ArrayLike = Union[float, np.ndarray, pd.Series]


class STRAMModel:
    """
    Implements Equations (1) through (7) from Jones & Arp (2019)
    with automatic support for Metric ('SI') and US Customary ('US') units.
    """

    def __init__(self, unit_system: str = "US", use_exact_table7_coeffs: bool = True):
        """
        Parameters
        ----------
        unit_system : str
            'US' (Imperial: ft, in, psi, lbf) or 'SI' (Metric: m, cm, MPa, kPa, kN).
        use_exact_table7_coeffs : bool
            If True, uses the 3-decimal precision coefficients from Table 7.
            If False, uses the 2-decimal rounded coefficients printed in the main text.
        """
        unit_system = unit_system.upper()
        if unit_system not in ("US", "SI"):
            raise ValueError("unit_system must be 'US' or 'SI'")
        self.unit_system = unit_system
        self.exact = use_exact_table7_coeffs

    # -----------------------------------------------------------------
    # Equation (1): Cross-terrain DTW Pore-Filled Soil Moisture
    # -----------------------------------------------------------------
    def eq1_mc_ps_dtw(
        self,
        dtw: ArrayLike,
        dtw_top: ArrayLike,
        mc_ps_top: ArrayLike,
        k_mc: float = 0.5,
        p_mc: float = 1.0,
    ) -> ArrayLike:
        """
        Equation (1): Cross-terrain pore-filled moisture content (MC_PS,DTW in %).
        Note: If unit_system == 'US', dtw and dtw_top are in feet (ft) and k_mc is in ft^-1.
              If unit_system == 'SI', dtw and dtw_top are in meters (m) and k_mc is in m^-1.
        """
        num = 1.0 - np.exp(-k_mc * dtw)
        den = 1.0 - np.exp(-k_mc * dtw_top)
        return 100.0 - (100.0 - mc_ps_top) * ((num / den) ** p_mc)

    # -----------------------------------------------------------------
    # Equation (2): Augmented Pore-Filled Soil Moisture (MC_PS, %)
    # -----------------------------------------------------------------
    def eq2_mc_ps(
        self,
        mc_ps_dtw: ArrayLike,
        dtw_fia: ArrayLike,
        om_dsm: ArrayLike,
        dem: ArrayLike,
        hw: ArrayLike = 0,
        track: ArrayLike = 0,
    ) -> ArrayLike:
        """
        Equation (2): Pore-filled soil moisture content (MC_PS in %).
        - SI inputs: dtw_fia (m), dem (m), om_dsm (%)
        - US inputs: dtw_fia (ft), dem (ft), om_dsm (%)
        """
        if self.exact:
            b0_si = 70.883
            b_mc_dtw = 0.262
            b_log_dtw = -2.764
            b_om = -0.981
            b_dem_si = -0.091
            b_hw = 10.224
            b_track = 4.090
        else:
            b0_si = 70.88
            b_mc_dtw = 0.26
            b_log_dtw = -2.76
            b_om = -0.98
            b_dem_si = -0.10
            b_hw = 10.22
            b_track = 4.09

        dtw_safe = np.maximum(dtw_fia, 1e-6)

        if self.unit_system == "SI":
            b0 = b0_si
            b_dem = b_dem_si
        else:
            # Adjust intercept for log10(ft) -> log10(m): log10(dtw_ft / 3.28084)
            b0 = b0_si - b_log_dtw * np.log10(M_TO_FT)
            b_dem = b_dem_si / M_TO_FT

        return (
            b0
            + b_mc_dtw * mc_ps_dtw
            + b_log_dtw * np.log10(dtw_safe)
            + b_om * om_dsm
            + b_dem * dem
            + b_hw * hw
            + b_track * track
        )

    # -----------------------------------------------------------------
    # Equation (3): Cone Index (CI)
    # -----------------------------------------------------------------
    def eq3_cone_index(
        self,
        mc_ps: ArrayLike,
        depth: ArrayLike,
        track: ArrayLike = 1,
        sw: ArrayLike = 0,
    ) -> ArrayLike:
        """
        Equation (3): Soil resistance to cone penetration (CI).
        - SI: depth in cm -> returns CI in MPa
        - US: depth in inches -> returns CI in psi
        """
        if self.exact:
            b0_si = 1.599
            b_mc = -0.011
            b_depth_si = 0.025
            b_track = 0.760
            b_sw = 0.397
        else:
            b0_si = 1.60
            b_mc = -0.01
            b_depth_si = 0.03
            b_track = 0.76
            b_sw = 0.40

        if self.unit_system == "SI":
            return b0_si + b_mc * mc_ps + b_depth_si * depth + b_track * track + b_sw * sw
        else:
            # Convert depth from inches to cm (1 in = 2.54 cm) and MPa output to psi
            b_depth_in_mpa = b_depth_si / CM_TO_IN
            ci_mpa = b0_si + b_mc * mc_ps + b_depth_in_mpa * depth + b_track * track + b_sw * sw
            return ci_mpa * MPA_TO_PSI

    # -----------------------------------------------------------------
    # Equation (4): Tire Deflection (delta) & Nominal Cone Index (NCI)
    # -----------------------------------------------------------------
    def tire_deflection(self, wheel_load: ArrayLike, tire_pressure: ArrayLike) -> ArrayLike:
        """
        Calculates tire deflection (delta):
        - SI: wheel_load in kN, tire_pressure in kPa -> returns delta in meters (m)
        - US: wheel_load in lbf, tire_pressure in psi -> returns delta in inches (in)
        """
        if self.unit_system == "SI":
            return 0.001 * (0.365 + 170.0 / tire_pressure) * wheel_load
        else:
            # 0.001 * (M_TO_IN / KN_TO_LBF) = 0.0001751268
            # 170 kPa * KPA_TO_PSI = 24.656415 psi
            c_outer = 0.001 * (M_TO_IN / KN_TO_LBF)
            c_press = 170.0 * KPA_TO_PSI
            return c_outer * (0.365 + c_press / tire_pressure) * wheel_load

    def eq4_nci(
        self,
        ci: ArrayLike,
        tire_diameter: ArrayLike,
        tire_width: ArrayLike,
        section_height: ArrayLike,
        wheel_load: ArrayLike,
        tire_pressure: ArrayLike,
    ) -> ArrayLike:
        """
        Equation (4): Dimensionless Nominal Cone Index (NCI).
        - SI: ci (MPa), tire_diameter/width/section_height (m), wheel_load (kN), tire_pressure (kPa)
        - US: ci (psi), tire_diameter/width/section_height (in), wheel_load (lbf), tire_pressure (psi)
        Note: NCI is dimensionless and produces identical values in both unit systems.
        """
        delta = self.tire_deflection(wheel_load, tire_pressure)
        geom_factor = np.sqrt(delta / section_height) * (1.0 / (1.0 + tire_width / (2.0 * tire_diameter)))

        if self.unit_system == "SI":
            return (1000.0 * ci * tire_width * tire_diameter / wheel_load) * geom_factor
        else:
            # In US units: psi * in * in / lbf is already unitless (1 psi = 1 lbf/in^2)
            return (ci * tire_width * tire_diameter / wheel_load) * geom_factor

    # -----------------------------------------------------------------
    # Equations (5) & (7): Multi-Pass Rut Depth (Z)
    # -----------------------------------------------------------------
    def eq5_rut_depth(
        self,
        nci: ArrayLike,
        passes: ArrayLike,
        dtw_fia: ArrayLike = 0.0,
        cf_fraction: Optional[ArrayLike] = None,
    ) -> ArrayLike:
        """
        Equations (5) & (7): Non-linear rut depth prediction.
        - SI: dtw_fia in m -> returns Rut Depth Z in cm
        - US: dtw_fia in ft -> returns Rut Depth Z in inches (in)
        - cf_fraction: Optional coarse fragment content as decimal (0 to 1) for Eq. (7).
        """
        a_si = 40.886 if self.exact else 40.8
        b = 0.072 if self.exact else 0.071

        if self.unit_system == "SI":
            nci_adj = nci + 0.48 * dtw_fia
            a_coeff = a_si
        else:
            # 0.48 m^-1 / 3.28084 ft/m = 0.146304 ft^-1
            nci_adj = nci + (0.48 / M_TO_FT) * dtw_fia
            a_coeff = a_si * CM_TO_IN

        z = (a_coeff / nci_adj) * (passes ** (b * nci_adj))
        if cf_fraction is not None:
            z = z * ((1.0 - cf_fraction) ** 2)
        return z

    # -----------------------------------------------------------------
    # Table 7 Linear Log10 Rut Depth Model
    # -----------------------------------------------------------------
    def table7_log_rut_depth(
        self,
        passes: ArrayLike,
        nci: ArrayLike,
        dtw_fia: ArrayLike,
    ) -> ArrayLike:
        """
        Table 7 Linear Log-Regression Model for Rut Depth:
        - SI: dtw_fia in m -> returns Rut Depth Z in cm
        - US: dtw_fia in ft -> returns Rut Depth Z in inches (in)
        """
        b0_si = 18.880
        b_passes_si = 14.327
        b_nci_si = -22.213
        b_dtw_si = -2.669

        dtw_safe = np.maximum(dtw_fia, 1e-6)

        if self.unit_system == "SI":
            return (
                b0_si
                + b_passes_si * np.log10(passes)
                + b_nci_si * np.log10(nci)
                + b_dtw_si * np.log10(dtw_safe)
            )
        else:
            b0_us = (b0_si - b_dtw_si * np.log10(M_TO_FT)) * CM_TO_IN
            b_passes_us = b_passes_si * CM_TO_IN
            b_nci_us = b_nci_si * CM_TO_IN
            b_dtw_us = b_dtw_si * CM_TO_IN
            return (
                b0_us
                + b_passes_us * np.log10(passes)
                + b_nci_us * np.log10(nci)
                + b_dtw_us * np.log10(dtw_safe)
            )

    # -----------------------------------------------------------------
    # Equation (6): General Non-Block Specific CI Predictor
    # -----------------------------------------------------------------
    def eq6_general_ci(
        self,
        ps_fraction: ArrayLike,
        mc_ps_fraction: ArrayLike,
        cf_fraction: ArrayLike,
    ) -> ArrayLike:
        """
        Equation (6): General non-block specific CI predictor from Jones & Arp (2017).
        Inputs (ps_fraction, mc_ps_fraction, cf_fraction) are decimal fractions (0 to 1).
        - SI: returns CI in MPa
        - US: returns CI in psi
        """
        log10_ci_mpa = 0.26 - 0.29 * ps_fraction - 0.41 * mc_ps_fraction + 1.04 * cf_fraction
        ci_mpa = 10.0 ** log10_ci_mpa
        return ci_mpa if self.unit_system == "SI" else ci_mpa * MPA_TO_PSI


# =====================================================================
# 4. USDA SSURGO / gNATSGO DATA ADAPTER
# =====================================================================
def adapt_ssurgo_dataframe(
    df: pd.DataFrame,
    target_units: str = "US",
    particle_density_gcm3: float = 2.65,
) -> pd.DataFrame:
    """
    Converts a DataFrame containing standard USDA-NRCS SSURGO `chorizon` + terrain
    attributes into the exact input columns required by STRAM.

    Expected SSURGO / Terrain Columns (flexible naming):
    - 'sandtotal_r' : Sand % (0-100)
    - 'om_r' or 'soc_pct' : Organic matter % (or Soil Organic Carbon %)
    - 'dbthirdbar_r' : Bulk density (g/cm^3)
    - 'fragvol_r' or 'sieveno10_r' : Coarse fragments % (0-100)
    - 'c_horizon_depth_cm' : Depth to C horizon (cm)
    - 'theta_v' : Volumetric water content (decimal 0-1 or % 0-100)
    - 'dem_m' or 'dem_ft' : Elevation
    - 'dtw_fia_m' or 'dtw_fia_ft' : Cartographic Depth-to-Water
    """
    out = df.copy()
    target_units = target_units.upper()

    # 1. Sand (%)
    if "sandtotal_r" in out.columns:
        out["Sand_DSM_pct"] = out["sandtotal_r"]

    # 2. Organic Matter (%)
    if "om_r" in out.columns:
        out["OM_DSM_pct"] = out["om_r"]
    elif "soc_pct" in out.columns:
        out["OM_DSM_pct"] = out["soc_pct"] * 1.724  # Van Bemmelen factor

    # 3. Bulk Density & Porosity
    if "dbthirdbar_r" in out.columns:
        out["Db_gcm3"] = out["dbthirdbar_r"]
        out["Db_lbft3"] = out["dbthirdbar_r"] * GCM3_TO_LBFT3
        out["Porosity_frac"] = 1.0 - (out["Db_gcm3"] / particle_density_gcm3)

    # 4. Coarse Fragments (% and fraction)
    if "fragvol_r" in out.columns:
        out["CF_DSM_pct"] = out["fragvol_r"]
    elif "sieveno10_r" in out.columns:
        out["CF_DSM_pct"] = 100.0 - out["sieveno10_r"]
    if "CF_DSM_pct" in out.columns:
        out["CF_frac"] = out["CF_DSM_pct"] / 100.0

    # 5. Pore-Filled Soil Moisture (MC_PS in %) from Volumetric Moisture (theta_v)
    if "theta_v" in out.columns and "Porosity_frac" in out.columns:
        theta_frac = np.where(out["theta_v"] > 1.0, out["theta_v"] / 100.0, out["theta_v"])
        out["MC_PS_measured_pct"] = np.clip((theta_frac / out["Porosity_frac"]) * 100.0, 0.0, 100.0)

    # 6. Depth to C Horizon
    if "c_horizon_depth_cm" in out.columns:
        out["C_DSM_cm"] = out["c_horizon_depth_cm"]
        out["C_DSM_in"] = out["c_horizon_depth_cm"] * CM_TO_IN

    # 7. Elevation (DEM) and DTW_FIA bidirectional conversion
    if "dem_m" in out.columns and "dem_ft" not in out.columns:
        out["dem_ft"] = out["dem_m"] * M_TO_FT
    elif "dem_ft" in out.columns and "dem_m" not in out.columns:
        out["dem_m"] = out["dem_ft"] / M_TO_FT

    if "dtw_fia_m" in out.columns and "dtw_fia_ft" not in out.columns:
        out["dtw_fia_ft"] = out["dtw_fia_m"] * M_TO_FT
    elif "dtw_fia_ft" in out.columns and "dtw_fia_m" not in out.columns:
        out["dtw_fia_m"] = out["dtw_fia_ft"] / M_TO_FT

    return out


# =====================================================================
# 5. VERIFICATION & DEMONSTRATION ON PAPER BLOCK AVERAGES (Table 5)
# =====================================================================
if __name__ == "__main__":
    # Create dataset from Table 5 (Block 1, 2, 3, 9 Mean Values)
    blocks_data = pd.DataFrame([
        {
            "Block": 1, "Machine": "JD1510E", "HW": 0, "SW": 1, "Track": 1,
            "Sand_DSM": 40.41, "OM_DSM": 6.45, "CF_DSM": 26.21, "Db_gcm3": 0.96,
            "C_DSM_cm": 38.09, "DEM_m": 277.86, "DTW_FIA_m": 1.44,
            "MC_PS_top": 39.9, "DTW_top_m": 15.0, "Passes": 4.62, "Sample_Depth_cm": 15.0
        },
        {
            "Block": 2, "Machine": "JD1510E", "HW": 0, "SW": 1, "Track": 1,
            "Sand_DSM": 46.16, "OM_DSM": 5.86, "CF_DSM": 35.80, "Db_gcm3": 0.99,
            "C_DSM_cm": 39.98, "DEM_m": 261.33, "DTW_FIA_m": 2.17,
            "MC_PS_top": 35.3, "DTW_top_m": 15.0, "Passes": 5.75, "Sample_Depth_cm": 15.0
        },
        {
            "Block": 3, "Machine": "JD1110E", "HW": 1, "SW": 0, "Track": 1,
            "Sand_DSM": 43.90, "OM_DSM": 6.40, "CF_DSM": 33.86, "Db_gcm3": 0.79,
            "C_DSM_cm": 39.92, "DEM_m": 360.05, "DTW_FIA_m": 1.18,
            "MC_PS_top": 39.4, "DTW_top_m": 15.0, "Passes": 3.57, "Sample_Depth_cm": 15.0
        },
        {
            "Block": 9, "Machine": "TC635D_Rear", "HW": 1, "SW": 0, "Track": 1,
            "Sand_DSM": 54.09, "OM_DSM": 10.00, "CF_DSM": 33.65, "Db_gcm3": 0.99,
            "C_DSM_cm": 41.78, "DEM_m": 275.67, "DTW_FIA_m": 1.05,
            "MC_PS_top": 26.4, "DTW_top_m": 15.0, "Passes": 18.03, "Sample_Depth_cm": 15.0
        },
    ])

    si_model = STRAMModel(unit_system="SI", use_exact_table7_coeffs=True)
    us_model = STRAMModel(unit_system="US", use_exact_table7_coeffs=True)

    results = []
    for _, row in blocks_data.iterrows():
        spec = MACHINE_PRESETS[row["Machine"]]

        # --- SI Execution ---
        mc_dtw_si = si_model.eq1_mc_ps_dtw(row["DTW_FIA_m"], row["DTW_top_m"], row["MC_PS_top"], k_mc=0.5)
        mc_ps_si = si_model.eq2_mc_ps(mc_dtw_si, row["DTW_FIA_m"], row["OM_DSM"], row["DEM_m"], row["HW"], row["Track"])
        ci_mpa = si_model.eq3_cone_index(mc_ps_si, row["Sample_Depth_cm"], row["Track"], row["SW"])
        nci_si = si_model.eq4_nci(ci_mpa, spec.diameter_m, spec.width_m, spec.section_height_m, spec.wheel_load_kN, spec.pressure_kPa)
        rut_cm = si_model.eq5_rut_depth(nci_si, row["Passes"], row["DTW_FIA_m"])

        # --- US Customary Execution ---
        dtw_ft = row["DTW_FIA_m"] * M_TO_FT
        dtw_top_ft = row["DTW_top_m"] * M_TO_FT
        dem_ft = row["DEM_m"] * M_TO_FT
        depth_in = row["Sample_Depth_cm"] * CM_TO_IN

        mc_dtw_us = us_model.eq1_mc_ps_dtw(dtw_ft, dtw_top_ft, row["MC_PS_top"], k_mc=0.5 / M_TO_FT)
        mc_ps_us = us_model.eq2_mc_ps(mc_dtw_us, dtw_ft, row["OM_DSM"], dem_ft, row["HW"], row["Track"])
        ci_psi = us_model.eq3_cone_index(mc_ps_us, depth_in, row["Track"], row["SW"])
        nci_us = us_model.eq4_nci(ci_psi, spec.diameter_in, spec.width_in, spec.section_height_in, spec.wheel_load_lbf, spec.pressure_psi)
        rut_in = us_model.eq5_rut_depth(nci_us, row["Passes"], dtw_ft)

        results.append({
            "Block": int(row["Block"]),
            "Machine": row["Machine"],
            "MC_PS_SI (%)": round(mc_ps_si, 2),
            "MC_PS_US (%)": round(mc_ps_us, 2),
            "CI_SI (MPa)": round(ci_mpa, 3),
            "CI_US (psi)": round(ci_psi, 1),
            "NCI_SI": round(nci_si, 3),
            "NCI_US": round(nci_us, 3),
            "Rut_SI (cm)": round(rut_cm, 2),
            "Rut_US (in)": round(rut_in, 2),
            "Rut_SI_from_US (cm)": round(rut_in / CM_TO_IN, 2),
        })

    res_df = pd.DataFrame(results)
    print("=== STRAM SI vs. US Customary Verification Across Study Blocks ===")
    print(res_df.to_string(index=False))
