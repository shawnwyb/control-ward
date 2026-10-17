import json
import tempfile
import unittest
from datetime import date, datetime, timedelta
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import httpx

import fetch_weather
from hazidx import config
from hazidx.http import Client, openmeteo_weight


def archive_body(params: dict) -> dict:
    start = date.fromisoformat(params["start_date"])
    end = date.fromisoformat(params["end_date"])
    hours = ((end - start).days + 1) * 24
    t0 = datetime(start.year, start.month, start.day)
    times = [(t0 + timedelta(hours=i)).strftime("%Y-%m-%dT%H:%M") for i in range(hours)]
    hourly = {"time": times}
    for v in config.ARCHIVE_VARS:
        hourly[v] = [1.0] * hours
    return {"latitude": float(params["latitude"]), "longitude": float(params["longitude"]),
            "elevation": 1.0, "hourly": hourly}


class FakeClock:
    def __init__(self):
        self.t = 1_000_000.0

    def __call__(self):
        return self.t

    def sleep(self, s):
        self.t += s


class DownloadTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.cache = Path(self.tmp.name)
        self.clock = FakeClock()
        self.requests = []

    def tearDown(self):
        self.tmp.cleanup()

    def client(self, handler):
        def wrapped(request: httpx.Request):
            q = {k: v[0] for k, v in parse_qs(urlparse(str(request.url)).query).items()}
            self.requests.append(q)
            return handler(q)
        return Client(client=httpx.Client(transport=httpx.MockTransport(wrapped)), sleep=self.clock.sleep)

    def run_main(self, argv, handler):
        return fetch_weather.main(["--cache-dir", str(self.cache)] + argv, client=self.client(handler),
                                  sleep=self.clock.sleep, clock=self.clock)

    def test_weight_formula(self):
        self.assertAlmostEqual(openmeteo_weight(1, 15, 28), 3.0)
        self.assertAlmostEqual(openmeteo_weight(1, 9, 365), 365 / 14)
        self.assertAlmostEqual(openmeteo_weight(60, 9, 7), 60.0)

    def test_resume_picks_newest_missing_first(self):
        # 2025 already present for both plants; 2024 present for one.
        for eia, year in (("56407", 2025), ("6008", 2025), ("56407", 2024)):
            fetch_weather.weather_file(self.cache, eia, year).write_bytes(b"x")
        ok = lambda q: httpx.Response(200, json=archive_body(q))
        rc = self.run_main(["run", "--plants", "56407", "6008", "--years", "2023", "2024", "2025",
                            "--budget", "60"], ok)
        self.assertEqual(rc, 0)
        # Budget 60 allows two plant-years: the missing 2024 one first, then 2023.
        got = [(q["latitude"], q["start_date"]) for q in self.requests]
        self.assertEqual([d for _, d in got], ["2024-01-01", "2023-01-01"])
        self.assertTrue(fetch_weather.weather_file(self.cache, "6008", 2024).exists())
        manifest = json.loads(Path(str(fetch_weather.weather_file(self.cache, "6008", 2024)) + ".manifest.json").read_text())
        self.assertEqual(manifest["row_count"], 366 * 24)
        self.assertEqual(len((self.cache / "ledger.jsonl").read_text().splitlines()), 2)

    def test_daily_quota_exit_code_3(self):
        calls = {"n": 0}

        def handler(q):
            calls["n"] += 1
            if calls["n"] == 1:
                return httpx.Response(200, json=archive_body(q))
            return httpx.Response(429, json={"error": True, "reason": "Daily API request limit exceeded. Please try again tomorrow."})

        rc = self.run_main(["run", "--plants", "56407", "--years", "2024", "2025", "--budget", "1000"], handler)
        self.assertEqual(rc, 3)
        self.assertTrue(fetch_weather.weather_file(self.cache, "56407", 2025).exists())
        self.assertFalse(fetch_weather.weather_file(self.cache, "56407", 2024).exists())
        # A rerun continues with the missing year only.
        self.requests.clear()
        rc = self.run_main(["run", "--plants", "56407", "--years", "2024", "2025", "--budget", "1000"],
                           lambda q: httpx.Response(200, json=archive_body(q)))
        self.assertEqual(rc, 0)
        self.assertEqual([q["start_date"] for q in self.requests], ["2024-01-01"])

    def test_minutely_limit_is_retried(self):
        calls = {"n": 0}

        def handler(q):
            calls["n"] += 1
            if calls["n"] == 1:
                return httpx.Response(429, json={"error": True, "reason": "Minutely API request limit exceeded. Please try again in one minute."})
            return httpx.Response(200, json=archive_body(q))

        rc = self.run_main(["run", "--plants", "56407", "--years", "2025", "--budget", "100"], handler)
        self.assertEqual(rc, 0)
        self.assertEqual(calls["n"], 2)

    def test_blocked_exit_code_2(self):
        rc = self.run_main(["run", "--plants", "56407", "--years", "2025"], lambda q: httpx.Response(403))
        self.assertEqual(rc, 2)


if __name__ == "__main__":
    unittest.main()
