import pandas as pd
from stram_usa_converter import STRAMModel, MACHINE_PRESETS, adapt_ssurgo_dataframe

# 1. Load or define SSURGO + LiDAR terrain data in US units
raw_ssurgo = pd.DataFrame({
    "sandtotal_r": [45.0, 62.0],       # % Sand
    "om_r": [4.5, 8.2],                # % Organic Matter
    "dbthirdbar_r": [1.25, 0.95],      # g/cm^3 Bulk Density
    "fragvol_r": [15.0, 5.0],          # % Volumetric Coarse Fragments
    "theta_v": [0.28, 0.45],           # Volumetric Water Content (m^3/m^3)
    "c_horizon_depth_cm": [45.0, 60.0],# Depth to C horizon (cm)
    "dem_ft": [850.0, 620.0],          # LiDAR Elevation (ft)
    "dtw_fia_ft": [6.5, 1.2],          # Cartographic Depth-to-Water (ft)
    "hw_flag": [0, 1],                 # 0 = Softwood, 1 = Hardwood
    "sw_flag": [1, 0],                 # 1 = Softwood, 0 = Hardwood
    "passes": [5, 15]                  # Number of machine passes
})

# 2. Adapt SSURGO columns to STRAM format
df = adapt_ssurgo_dataframe(raw_ssurgo, target_units="US")

# 3. Initialize US Customary STRAM model and machine preset
us_stram = STRAMModel(unit_system="US", use_exact_table7_coeffs=True)
machine = MACHINE_PRESETS["JD1510E"]

# 4. Run pipeline (outputs CI in psi, Rut Depth in inches)
df["CI_psi"] = us_stram.eq3_cone_index(
    mc_ps=df["MC_PS_measured_pct"],
    depth=6.0,  # 6 inches (~15 cm) top mineral soil layer
    track=1,
    sw=df["sw_flag"]
)

df["NCI"] = us_stram.eq4_nci(
    ci=df["CI_psi"],
    tire_diameter=machine.diameter_in,
    tire_width=machine.width_in,
    section_height=machine.section_height_in,
    wheel_load=machine.wheel_load_lbf,
    tire_pressure=machine.pressure_psi
)

df["Rut_Depth_in"] = us_stram.eq5_rut_depth(
    nci=df["NCI"],
    passes=df["passes"],
    dtw_fia=df["dtw_fia_ft"],
    cf_fraction=df["CF_frac"]  # Applies Eq. (7) (1 - CF)^2 adjustment
)

print(df[["MC_PS_measured_pct", "CI_psi", "NCI", "Rut_Depth_in"]])