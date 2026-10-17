"""Hybrid NRCS rules on the three real SSURGO fixture soils: dry sand (136), plastic clay (61666), muck (56407)."""
import csv
import unittest

import numpy as np

from stram import config as C, equations as E, rules as R

with open(C.SOIL_FIXTURE, newline="") as f:
    SOILS = {r["plant_id"]: r for r in csv.DictReader(f)}
TRUCK, EXCAVATOR, CRANE = (C.EQUIPMENT[k] for k in ("road_truck", "excavator", "crawler_crane"))


def evaluate(pid, equipment, wet_class, *, z_in=2.0, dtw_ft=20.0, passes=2):
    row = SOILS[pid]
    mil = float(row[R.mil_column(equipment.mil_type, wet_class, passes)])
    flag, source = R.combine(
        equipment, z_in=z_in, mil=mil, organic=E.is_organic(float(row["om_pct"]), row["uscs_surface"]),
        soil_unknown=False, rut_severe=row["rutting_hazard_class"] == "Severe", dtw_eff_ft=dtw_ft, wet_class=wet_class)
    return int(flag), R.SOURCES[int(source)]


class Wetness(unittest.TestCase):
    def test_classes(self):
        self.assertEqual([R.wetness_class(x) for x in (0.0, 0.5, 1.0, 3.0)], ["very_dry", "dry", "moist", "wet"])

    def test_mil_column(self):
        self.assertEqual(R.mil_column(7, "dry", 10), "mil_traf_t7_dry")
        self.assertEqual(R.mil_column(3, "wet", 2), "mil_traf_t3_wet1")
        self.assertEqual(R.mil_column(4, "moist", 10), "mil_traf_t4_wet50")


class HybridOnFixtureSoils(unittest.TestCase):
    def test_wet_forecast_flags_muck_and_clay(self):
        for pid in ("56407", "61666"):
            flag, _ = evaluate(pid, TRUCK, "wet")
            self.assertGreaterEqual(flag, R.INSPECT, pid)
        self.assertEqual(evaluate("56407", TRUCK, "wet")[1], "nrcs_organic")
        self.assertEqual(evaluate("61666", TRUCK, "wet"), (R.HOLD, "nrcs"))  # MIL t7 wet1 = 0.474, Poor

    def test_sand_no_worse_than_clay_or_muck(self):
        sand = evaluate("136", TRUCK, "wet")[0]
        self.assertLessEqual(sand, evaluate("61666", TRUCK, "wet")[0])
        self.assertLessEqual(sand, evaluate("56407", TRUCK, "wet")[0])

    def test_ground_index_drives_truck_flag_on_good_soil(self):
        self.assertEqual(evaluate("136", TRUCK, "dry", z_in=2.0), (R.OK, "stram"))
        self.assertEqual(evaluate("136", TRUCK, "dry", z_in=9.0), (R.HOLD, "stram"))

    def test_tracked_follow_mil(self):
        self.assertEqual(evaluate("61666", EXCAVATOR, "wet")[0], R.HOLD)  # t3 wet1 0.465
        self.assertEqual(evaluate("136", EXCAVATOR, "wet")[0], R.OK)  # t3 wet1 0.85
        self.assertEqual(evaluate("56407", EXCAVATOR, "wet")[0], R.INSPECT)  # t3 wet1 0.654
        self.assertEqual(evaluate("136", CRANE, "dry")[0], R.OK)

    def test_wet_area_override(self):
        self.assertEqual(evaluate("136", EXCAVATOR, "wet", dtw_ft=1.0), (R.HOLD, "wet_area"))
        self.assertEqual(evaluate("136", EXCAVATOR, "moist", dtw_ft=1.0), (R.INSPECT, "wet_area"))

    def test_wet_condition_rules_are_off_in_dry_weather(self):
        # Flat arid ground has small DTW, and NRCS rates many desert loams Severe for (wet) rutting.
        self.assertEqual(evaluate("136", EXCAVATOR, "dry", dtw_ft=1.0), (R.OK, "nrcs"))
        flag, source = R.combine(TRUCK, z_in=1.0, mil=0.9, organic=False, soil_unknown=False, rut_severe=True,
                                 dtw_eff_ft=1.0, wet_class="very_dry")
        self.assertEqual((int(flag), R.SOURCES[int(source)]), (R.OK, "stram"))
        flag, _ = R.combine(TRUCK, z_in=1.0, mil=0.9, organic=False, soil_unknown=False, rut_severe=True,
                            dtw_eff_ft=20.0, wet_class="moist")
        self.assertEqual(int(flag), R.INSPECT)

    def test_soil_unknown_is_at_least_inspect(self):
        flag, source = R.combine(TRUCK, z_in=1.0, mil=np.nan, organic=False, soil_unknown=True, rut_severe=False,
                                 dtw_eff_ft=20.0, wet_class="dry")
        self.assertEqual((int(flag), R.SOURCES[int(source)]), (R.INSPECT, "soil_unknown"))

    def test_rasters_broadcast(self):
        z = np.array([[1.0, 5.0], [9.0, 1.0]])
        flag, _ = R.combine(TRUCK, z_in=z, mil=0.9, organic=np.zeros((2, 2), bool), soil_unknown=False,
                            rut_severe=False, dtw_eff_ft=np.full((2, 2), 20.0), wet_class="dry")
        self.assertEqual(flag.tolist(), [[R.OK, R.INSPECT], [R.HOLD, R.OK]])


class Scores(unittest.TestCase):
    def test_wheeled_score_follows_ground_index_with_flag_floor(self):
        self.assertAlmostEqual(float(R.score(TRUCK, 6.0, R.INSPECT)), 5.25)
        self.assertAlmostEqual(float(R.score(TRUCK, 1.0, R.HOLD)), 6.5)
        self.assertAlmostEqual(float(R.score(TRUCK, 30.0, R.HOLD)), 10.0)

    def test_tracked_score_is_flag_score(self):
        self.assertEqual(float(R.score(CRANE, 99.0, R.INSPECT)), 4.0)


if __name__ == "__main__":
    unittest.main()
