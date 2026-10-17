import unittest

from hazidx.sites import load_sites, parse_row


class SitesTest(unittest.TestCase):
    def test_sixty_plants(self):
        sites = load_sites()
        self.assertEqual(len(sites), 60)
        self.assertEqual(len({s.eia_plant_id for s in sites}), 60)
        for s in sites:
            self.assertTrue(24 < s.latitude < 49 and -125 < s.longitude < -66, s)
            self.assertTrue(s.timezone.startswith("America/"), s)

    def test_names_with_commas_and_parentheses(self):
        by = {s.eia_plant_id: s for s in load_sites()}
        self.assertEqual(by["8102"].name, "Gavin Power, LLC")
        self.assertEqual(by["1733"].name, "Monroe (MI)")
        self.assertEqual(by["2712"].utility, "Duke Energy Progress - (NC)")
        self.assertEqual(by["56407"].fema_flood_zone, "AO")
        self.assertEqual(by["56407"].river_distance_m, 11838)
        self.assertIsNone(by["66923"].river_distance_m)
        self.assertIsNone(by["6163"].fema_flood_zone)

    def test_parse_row_escaped_quote(self):
        self.assertEqual(parse_row("'O''Brien, Plant (X)',1.5,null,-2"), ["O'Brien, Plant (X)", "1.5", None, "-2"])


if __name__ == "__main__":
    unittest.main()
