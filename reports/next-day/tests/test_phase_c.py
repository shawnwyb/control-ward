import json
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

from shapely.geometry import box, mapping

from hazidx.sites import Site
from nextday import routing, wildlife

UTC = timezone.utc
SITE = Site("Test Plant", 25.0, -80.0, "America/New_York", "999", None, None, None, None, None, None)


def way(wid, pts, **tags):
    return {"type": "way", "id": wid, "nodes": [wid * 100 + i for i in range(len(pts))],
            "geometry": [{"lat": lat, "lon": lon} for lon, lat in pts], "tags": {"highway": "track", **tags}}


class RoutingTest(unittest.TestCase):
    def mud_dir(self, root: Path, flag_by_osm: dict[int, int]):
        seg = root / "segments"
        seg.mkdir(parents=True)
        feats = []
        for osm, flag in flag_by_osm.items():
            feats.append({"type": "Feature", "geometry": {"type": "LineString", "coordinates": [[-80.002, 25.0], [-79.998, 25.0]]},
                          "properties": {"osm_id": osm, "r": {f"{k}|1|d1": [flag, 1, 6.5, 9.0, 8.0, 10.0, 300] for k in routing.EQUIPMENT}}})
        (seg / "999.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": feats}))

    def test_edges_take_the_mud_flag_and_unrated_ways_are_marked(self):
        elements = [way(1, [(-80.002, 25.0), (-80.0, 25.0), (-79.998, 25.0)]),          # rated way, hold
                    way(2, [(-80.0, 25.001), (-80.0, 25.003)], highway="residential")]   # not in the mud model
        with tempfile.TemporaryDirectory() as d:
            self.mud_dir(Path(d), {1: 2})
            rated = routing.load_rated(Path(d), "999", "d1")
        g = routing.build_graph(elements, rated, None, 25.0)
        self.assertEqual(len(g["edges"]), 3)
        hold = [e for e in g["edges"] if e[3] == 2]
        unrated = [e for e in g["edges"] if e[3] == routing.NOT_RATED]
        self.assertEqual((len(hold), len(unrated)), (2, 1))
        self.assertTrue(all(len(e) == 3 + len(routing.EQUIPMENT) + 1 for e in g["edges"]))
        self.assertAlmostEqual(hold[0][2], 205, delta=6)          # 0.002 degrees of longitude at 25 N

    def test_oneway_private_and_wet_bits(self):
        elements = [way(1, [(-80.0, 25.0), (-80.0, 25.001)], oneway="yes", access="private")]
        wet = [box(-80.001, 24.9995, -79.999, 25.0005)]
        g = routing.build_graph(elements, {}, wet, 25.0)
        bits = g["edges"][0][-1]
        self.assertEqual(bits & routing.ONEWAY, routing.ONEWAY)
        self.assertEqual(bits & routing.PRIVATE, routing.PRIVATE)
        self.assertEqual(bits & routing.TIDE_WET, 0)        # the edge midpoint (25.0005) is on the box edge or outside
        g2 = routing.build_graph([way(1, [(-80.0, 25.0), (-80.0, 25.0004)])], {}, wet, 25.0)
        self.assertEqual(g2["edges"][0][-1] & routing.TIDE_WET, routing.TIDE_WET)

    def test_unusable_inputs(self):
        self.assertEqual(routing.build(None, SITE, "2026-10-19", {"status": "missing"}, None)[0]["status"], "not_applicable")
        sec = {"status": "ok", "horizon": {"key": "d1"}}
        self.assertEqual(routing.build(None, SITE, "2026-10-19", sec, None, elements=[])[0]["status"], "not_applicable")

    def test_query_is_bounded_and_excludes_private_no_access(self):
        q = routing.query(25.0, -80.0)
        self.assertIn("around:2500", q)
        self.assertIn('"access"!~"^(no)$"', q)
        self.assertNotIn("footway", q)


class WildlifeTest(unittest.TestCase):
    GROUPS = [{"id": "alligator", "label": "American alligator", "names": ["Alligator mississippiensis"]},
              {"id": "snakes", "label": "Venomous snakes", "names": ["Crotalus"]}]
    TAXA = {"alligator": [26159], "snakes": [30692]}

    def obs(self, oid, taxon_id, ancestors=(), obscured=False, coords=(-80.1, 25.1), date="2026-10-01"):
        return {"id": oid, "observed_on": date, "obscured": obscured, "geojson": {"type": "Point", "coordinates": list(coords)},
                "taxon": {"id": taxon_id, "name": "x", "preferred_common_name": "Thing", "ancestor_ids": list(ancestors)}}

    def test_season_labels_describe_reports_not_animals(self):
        months = {str(m): 4 for m in range(1, 13)}
        months["10"] = 12
        self.assertEqual(wildlife.season_label(months, 10)["label"], "many reports")
        self.assertEqual(wildlife.season_label(months, 3)["label"], "typical number of reports")
        months["6"] = 0
        self.assertEqual(wildlife.season_label(months, 6)["label"], "few reports")
        self.assertEqual(wildlife.season_label({"1": 3}, 1)["label"], "too few records")

    def test_groups_by_lineage_and_never_draws_obscured_points(self):
        observations = [self.obs(1, 26159), self.obs(2, 99999, ancestors=[30692]), self.obs(3, 26159, obscured=True), self.obs(4, 123)]
        sec, geo = wildlife.summarize(observations, 4, {}, self.GROUPS, self.TAXA, 10)
        counts = {g["id"]: g["recent"] for g in sec["groups"]}
        self.assertEqual(counts, {"alligator": 2, "snakes": 1})          # record 4 is in neither group
        self.assertEqual(sec["obscured_not_drawn"], 1)
        self.assertEqual(len(geo["features"]), 2)
        self.assertTrue(all("photo" not in json.dumps(f).lower() for f in geo["features"]))
        self.assertTrue(geo["features"][0]["properties"]["url"].startswith("https://www.inaturalist.org/observations/"))
        self.assertIn("No sightings does not mean no animals", " ".join(sec["caveats"]))

    def test_no_records_has_no_map_file(self):
        sec, geo = wildlife.summarize([], 0, {}, self.GROUPS, self.TAXA, 10)
        self.assertIsNone(geo)
        self.assertIsNone(sec["map_file"])

    def test_shipped_species_list_is_scientific_names(self):
        groups = wildlife.load_groups()
        self.assertGreaterEqual(len(groups), 4)
        for g in groups:
            self.assertTrue(all(n[0].isupper() for n in g["names"]), g)


if __name__ == "__main__":
    unittest.main()
