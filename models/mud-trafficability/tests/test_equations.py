"""Equations against the user's converter (parity) and against the paper's own Table 5 (reproduction)."""
import csv
import importlib.util
import unittest

import numpy as np

from stram import config as C, equations as E

spec = importlib.util.spec_from_file_location("converter", C.CONVERTER)
conv = importlib.util.module_from_spec(spec)
spec.loader.exec_module(conv)

# Table 5 block means: machine, CI (MPa), NCI, passes, DTW_FIA (m), rut mean and SD (cm).
TABLE5 = {
    1: ("JD1510E", 2.41, 4.84, 4.62, 1.44, 15.62, 6.65),
    2: ("JD1510E", 1.93, 3.87, 5.75, 2.17, 13.29, 10.53),
    3: ("JD1110E", 1.84, 3.57, 3.57, 1.18, 13.91, 8.11),
    9: ("TC635D_Rear", 2.03, 3.18, 18.03, 1.05, 22.54, 13.07),
}


def published_nci(block, scale):
    m, ci, *_ = TABLE5[block]
    s = conv.MACHINE_PRESETS[m]
    return E.eq4_nci(ci * C.MPA_TO_PSI, s.diameter_in, s.width_in, s.section_height_in, s.wheel_load_lbf,
                     s.pressure_psi, scale=scale)


class ConverterParity(unittest.TestCase):
    """stram.equations is a port of example_stram_usa_converter.py; the port must not drift."""

    def setUp(self):
        self.us = conv.STRAMModel("US", use_exact_table7_coeffs=True)

    def test_eq1(self):
        for dtw in (0.0, 1.0, 5.0, 20.0):
            ours = E.eq1_mc_ps_dtw(dtw, 40.0, 45.0)
            theirs = self.us.eq1_mc_ps_dtw(dtw, 40.0, 45.0, k_mc=C.K_MC_PER_M / C.M_TO_FT, p_mc=C.P_MC)
            self.assertAlmostEqual(float(ours), float(theirs), places=9)

    def test_eq3(self):
        for mc, track in ((40, 0), (70, 1), (95, 0)):
            self.assertAlmostEqual(float(E.eq3_ci_psi(mc, 6.0, track)), self.us.eq3_cone_index(mc, 6.0, track, 0), places=6)

    def test_eq4_unscaled(self):
        s = conv.MACHINE_PRESETS["JD1510E"]
        ours = E.eq4_nci(300.0, s.diameter_in, s.width_in, s.section_height_in, s.wheel_load_lbf, s.pressure_psi, scale=1.0)
        theirs = self.us.eq4_nci(300.0, s.diameter_in, s.width_in, s.section_height_in, s.wheel_load_lbf, s.pressure_psi)
        self.assertAlmostEqual(float(ours), float(theirs), places=9)

    def test_eq5_unguarded(self):
        for nci, passes, dtw, cf in ((4.0, 2, 3.0, 0.2), (6.0, 10, 0.5, 0.0)):
            z, _, _ = E.eq5_rut_in(nci, passes, dtw, cf, guard=False)
            self.assertAlmostEqual(float(z), float(self.us.eq5_rut_depth(nci, passes, dtw, cf)), places=9)

    def test_us_equals_si(self):
        si = conv.STRAMModel("SI", use_exact_table7_coeffs=True)
        z_in, _, _ = E.eq5_rut_in(4.0, 2, 3.0 * C.M_TO_FT, 0.25, guard=False)
        self.assertAlmostEqual(float(z_in) / C.CM_TO_IN, float(si.eq5_rut_depth(4.0, 2, 3.0, 0.25)), places=6)


class Table5Reproduction(unittest.TestCase):
    def test_eq4_as_published_is_off(self):
        ratios = [float(published_nci(b, 1.0)) / TABLE5[b][2] for b in TABLE5]
        self.assertTrue(all(3.5 < r < 4.4 for r in ratios), ratios)

    def test_eq4_scale_is_minimax_fit(self):
        inv = [TABLE5[b][2] / float(published_nci(b, 1.0)) for b in TABLE5]
        lo, hi = min(inv), max(inv)
        self.assertAlmostEqual(C.EQ4_NCI_SCALE, 2 * lo * hi / (lo + hi), delta=0.002)

    def test_eq4_rescaled_within_10pct(self):
        for b in TABLE5:
            self.assertLess(abs(float(published_nci(b, C.EQ4_NCI_SCALE)) / TABLE5[b][2] - 1), 0.10, b)

    def test_reference_nci_reproduces_jd1510e_blocks(self):
        # Table 5 Blocks 1 and 2 (JD1510E): mean, min and max NCI from the matching CI, within 2-decimal rounding.
        for ci, nci in ((2.41, 4.84), (1.90, 3.82), (3.00, 6.02), (1.93, 3.87), (1.56, 3.13), (2.42, 4.87)):
            self.assertLessEqual(abs(float(E.reference_nci(ci * C.MPA_TO_PSI)) - nci), 0.02, (ci, nci))

    def test_reference_nci_only_lowers_the_index_within_bound(self):
        # The switch from 0.253 x Eq 4 (1.855/MPa) to the paper's 2.008/MPa raises NCI by a fixed 8.2 %. So the
        # ground index can only fall, and at 1 pass (Z = a/NCI_adj) by at most that factor. The DTW term and the
        # clamps can only shrink the change. Grid covers clamped (very weak, very strong) and unclamped cells.
        ci = np.linspace(0.3, 5.0, 60)[:, None, None] * C.MPA_TO_PSI
        dtw = np.array([0.0, 1.0, 5.0, 20.0])[None, :, None]
        cf = np.array([0.0, 0.3])[None, None, :]
        old, new = E.equipment_nci(ci, C.REFERENCE_FORWARDER), E.reference_nci(ci)
        bound = float(np.min(old / new))
        for passes in (1, 2, 10):
            z_old, _, _ = E.eq5_rut_in(old, passes, dtw, cf)
            z_new, _, _ = E.eq5_rut_in(new, passes, dtw, cf)
            self.assertTrue(np.all(z_new <= z_old + 1e-12), passes)
            if passes == 1:
                self.assertTrue(np.all(z_new / z_old >= bound - 1e-9))
                self.assertAlmostEqual(bound, 1.855 / 2.008, places=3)

    def test_table5_points_to_swapped_jd_weights(self):
        # Rounding (+-0.005) bounds each machine's NCI/CI. Same tires, so under Eq 4 the ratio JD1510E/JD1110E
        # is sqrt(W_1110E / W_1510E) = 0.969. Table 5 instead allows only 1.030-1.036, which contains the
        # swapped-weight value sqrt(W_1510E / W_1110E) = 1.032. Strong evidence, not proof.
        def band(pairs):
            return (max((n - 0.005) / (c + 0.005) for c, n in pairs), min((n + 0.005) / (c - 0.005) for c, n in pairs))
        lo15, hi15 = band([(2.41, 4.84), (1.90, 3.82), (3.00, 6.02), (1.93, 3.87), (1.56, 3.13), (2.42, 4.87)])
        lo11, hi11 = band([(1.84, 3.57), (1.51, 2.94), (2.33, 4.54), (0.19, 0.37)])
        w15, w11 = 169.66 + 117.68, 161.81 + 107.87
        self.assertTrue(lo15 <= C.REFERENCE_NCI_PER_MPA <= hi15)
        self.assertTrue(lo15 / hi11 <= np.sqrt(w15 / w11) <= hi15 / lo11)
        self.assertFalse(lo15 / hi11 <= np.sqrt(w11 / w15) <= hi15 / lo11)

    def test_eq5_reproduces_block_means(self):
        for b, (_, _, nci, passes, dtw_m, mean, sd) in TABLE5.items():
            z, _, _ = E.eq5_rut_in(nci, passes, dtw_m * C.M_TO_FT, guard=False)
            self.assertLess(abs(float(z) / C.CM_TO_IN - mean), sd, b)


class Guards(unittest.TestCase):
    def test_passes_restricted(self):
        with self.assertRaises(ValueError):
            E.eq5_rut_in(4.0, 18, 1.0)

    def test_eq5_never_rises_with_soil_strength(self):
        nci = np.linspace(1.0, 15.0, 200)
        for passes in C.PASSES_ALLOWED:
            z, _, _ = E.eq5_rut_in(nci, passes, 0.0)
            self.assertTrue(np.all(np.diff(z) <= 1e-12), passes)

    def test_out_of_range_marked(self):
        _, _, out = E.eq5_rut_in(np.array([1.0, 4.0, 12.0]), 2, 0.0)
        self.assertEqual(out.tolist(), [True, False, True])

    def test_eq1_bounds(self):
        self.assertAlmostEqual(float(E.eq1_mc_ps_dtw(0.0, 30.0, 40.0)), 100.0)
        self.assertAlmostEqual(float(E.eq1_mc_ps_dtw(30.0, 30.0, 40.0)), 40.0)

    def test_pore_filled_moisture(self):
        self.assertAlmostEqual(float(E.mc_ps_from_theta(0.2, 1.325)), 40.0)

    def test_reference_forwarder_in_range_on_study_soil(self):
        ci = E.eq3_ci_psi(65.0, track=1)  # Table 5 MC_PS means are about 64-70 %
        _, _, out = E.eq5_rut_in(E.reference_nci(ci), 2, 1.5 * C.M_TO_FT)
        self.assertFalse(bool(out))


class SoilAdapter(unittest.TestCase):
    def test_fixture_soils_are_outside_the_study_domain(self):
        with open(C.SOIL_FIXTURE, newline="") as f:
            rows = {r["plant_id"]: r for r in csv.DictReader(f)}
        for pid in ("136", "61666", "56407"):
            soil = E.adapt_soil(rows[pid])
            self.assertTrue(E.domain_reasons(soil), pid)
        self.assertTrue(E.is_organic(E.adapt_soil(rows["56407"])["om_pct"], rows["56407"]["uscs_surface"]))
        self.assertFalse(E.is_organic(E.adapt_soil(rows["136"])["om_pct"], rows["136"]["uscs_surface"]))
        self.assertAlmostEqual(E.adapt_soil(rows["61666"])["wt_depth_ft"], 0.135 / 100 * C.M_TO_FT)


if __name__ == "__main__":
    unittest.main()
