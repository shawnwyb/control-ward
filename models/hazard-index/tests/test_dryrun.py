import csv
import json
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import httpx
import numpy as np

import dryrun
import train
from hazidx.http import Client
from hazidx.sites import load_sites
from tests.test_train import synthetic_site_days

NOW = datetime(2026, 10, 18, 4, 30, tzinfo=timezone.utc)   # 00:30 in New York, still 17 Oct further west


def location(variables, days_back, days_fwd, seed):
    rng = np.random.default_rng(seed)
    start = datetime(NOW.year, NOW.month, NOW.day) - timedelta(days=days_back)
    n = (days_back + days_fwd) * 24
    hourly = {"time": [(start + timedelta(hours=i)).strftime("%Y-%m-%dT%H:%M") for i in range(n)]}
    base = {"temperature_2m": 80, "relative_humidity_2m": 60, "wind_speed_10m": 6, "wind_gusts_10m": 15,
            "shortwave_radiation": 300, "precipitation": 0.2, "pressure_msl": 1015}
    for v in variables:
        hourly[v] = [round(float(x), 3) for x in base.get(v, 0.3) * rng.uniform(0.8, 1.2, n)]
    return {"hourly": hourly}


class DryRunTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        data = synthetic_site_days(plants=("A", "B"), years=range(2020, 2026))
        cls.bundle, _, _ = train.train(data, {"heat": 1.0, "storm": 0.8, "flood": 0.75, "fire": 0.85}, log=lambda *a: None)
        cls.sites = load_sites()

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def client(self, soil_ok=True):
        def handler(request: httpx.Request):
            q = {k: v[0] for k, v in parse_qs(urlparse(str(request.url)).query).items()}
            n = len(q["latitude"].split(","))
            if "ecmwf" in request.url.path:
                if not soil_ok:
                    return httpx.Response(400, json={"error": True, "reason": "no soil"})
                return httpx.Response(200, json=[location(dryrun.SOIL, 2, 3, i) for i in range(n)])
            self.assertEqual(q["past_days"], "31")
            return httpx.Response(200, json=[location(dryrun.CORE + dryrun.LAYERS, 31, 3, i) for i in range(n)])
        return Client(client=httpx.Client(transport=httpx.MockTransport(handler)), sleep=lambda s: None)

    def run_dry(self, extra=(), soil_ok=True):
        argv = ["--out-dir", str(self.dir / "out"), "--raw-dir", str(self.dir / "raw"),
                "--ledger", str(self.dir / "ledger.jsonl"), *extra]
        rc = dryrun.main(argv, client=self.client(soil_ok), now=NOW, bundle=self.bundle)
        self.assertEqual(rc, 0)
        out = self.dir / "out"
        csv_path = next(out.glob("*.csv"))
        with open(csv_path) as f:
            rows = list(csv.DictReader(f))
        payload = json.loads(next(out.glob("*.payload.json")).read_text())
        return rows, payload

    def test_rows_payload_and_local_dates(self):
        rows, payload = self.run_dry()
        self.assertEqual(len(rows), 120)
        self.assertEqual(list(rows[0])[:4], ["eia_plant_id", "horizon", "score", "model_version"])
        self.assertEqual(len(payload), 120)
        for p in payload:
            self.assertEqual(list(p), ["eia_plant_id", "horizon", "score", "model_version"])
            self.assertIn(p["horizon"], ("now", "tomorrow"))
            self.assertTrue(0 <= p["score"] <= 10)
            self.assertAlmostEqual(p["score"] * 10, round(p["score"] * 10))
        per = {}
        for r in rows:
            per.setdefault(r["eia_plant_id"], []).append(r)
        self.assertEqual(len(per), 60)
        self.assertTrue(all(len(v) == 2 for v in per.values()))
        tz = {s.eia_plant_id: s.timezone for s in self.sites}
        for eia, (now_row, tom_row) in per.items():
            want = "2026-10-18" if tz[eia] in ("America/New_York", "America/Detroit", "America/Indiana/Indianapolis") else "2026-10-17"
            self.assertEqual(now_row["local_date"], want, eia)
            self.assertEqual(tom_row["horizon"], "tomorrow")
            self.assertEqual(tom_row["local_date"], (datetime.fromisoformat(want) + timedelta(days=1)).date().isoformat())
            self.assertEqual(int(tom_row["forecast_hours"]), 24)
            self.assertTrue(0 <= int(now_row["forecast_hours"]) <= 24)
            self.assertGreaterEqual(float(now_row["risk_preview"]), float(now_row["rule_max_fc"]))
            self.assertEqual(now_row["soil_source"], "ecmwf_ifs")
        ny = per["56407"][0]
        self.assertEqual(int(ny["forecast_hours"]), 23)     # 00:30 EDT: hours 01:00..23:00 still to come
        self.assertEqual(int(per["6008"][0]["forecast_hours"]), 2)  # 21:30 MST in Phoenix: 22:00 and 23:00 to come
        ledger = (self.dir / "ledger.jsonl").read_text().splitlines()
        self.assertEqual(len(ledger), 2)

    def test_fixed_date_for_every_plant(self):
        rows, payload = self.run_dry(["--date", "2026-10-18"])
        self.assertEqual(len(rows), 120)
        self.assertEqual({r["local_date"] for r in rows if r["horizon"] == "now"}, {"2026-10-18"})
        self.assertEqual({r["local_date"] for r in rows if r["horizon"] == "tomorrow"}, {"2026-10-19"})
        now = {r["eia_plant_id"]: r for r in rows if r["horizon"] == "now"}
        self.assertEqual(int(now["6008"]["forecast_hours"]), 24)   # 21:30 MST on 17 Oct: all of 18 Oct to come
        self.assertEqual(int(now["56407"]["forecast_hours"]), 23)  # 00:30 EDT on 18 Oct
        self.assertEqual(len(payload), 120)
        self.assertTrue(next((self.dir / "out").glob("*.csv")).stem.endswith("_for20261018"))

    def test_soil_fallback_and_site_map(self):
        site_map = self.dir / "map.csv"
        site_map.write_text("id,eia_plant_id\n" + "\n".join(f"00000000-0000-0000-0000-{i:012d},{s.eia_plant_id}"
                                                           for i, s in enumerate(self.sites)) + "\n")
        rows, payload = self.run_dry(["--site-map", str(site_map)], soil_ok=False)
        self.assertEqual({r["soil_source"] for r in rows}, {"best_match_layers"})
        self.assertEqual(list(payload[0]), ["site_id", "horizon", "score", "model_version"])
        self.assertTrue(payload[0]["site_id"].startswith("00000000-"))

    def test_from_raw_rescoring(self):
        rows, _ = self.run_dry()
        stamp = NOW.strftime("%Y%m%dT%H%M%SZ")
        for f in (self.dir / "out").glob("*"):
            f.unlink()
        rc = dryrun.main(["--from-raw", stamp, "--out-dir", str(self.dir / "out"), "--raw-dir", str(self.dir / "raw")],
                         client=None, now=NOW, bundle=self.bundle)
        self.assertEqual(rc, 0)
        with open(next((self.dir / "out").glob("*.csv"))) as f:
            again = list(csv.DictReader(f))
        self.assertEqual([r["score"] for r in rows], [r["score"] for r in again])


if __name__ == "__main__":
    unittest.main()
