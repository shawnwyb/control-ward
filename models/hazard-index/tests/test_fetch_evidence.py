import csv
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch, MagicMock

import fetch_evidence


class FetchEvidenceTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def sample_csv(self) -> Path:
        p = self.dir / "test_scores.csv"
        rows = [
            {
                "eia_plant_id": "621",
                "horizon": "now",
                "score": "4.5",
                "model_version": "hazidx-test",
                "site_name": "Turkey Point",
                "timezone": "America/New_York",
                "local_date": "2026-10-18",
                "top_driver": "flood",
                "rain_24h_mm": "50.0",
                "rain_prev7d_mm": "100.0",
                "gust_max_mph": "35.0",
                "hi_max_f": "85.0",
                "wbgt_max_f": "82.0",
                "rule_max_fc": "3.0"
            },
            {
                "eia_plant_id": "6163",
                "horizon": "now",
                "score": "4.1",
                "model_version": "hazidx-test",
                "site_name": "Grand Coulee",
                "timezone": "America/Los_Angeles",
                "local_date": "2026-10-18",
                "top_driver": "fire",
                "rain_24h_mm": "0.0",
                "rain_prev7d_mm": "0.0",
                "gust_max_mph": "10.0",
                "hi_max_f": "65.0",
                "wbgt_max_f": "55.0",
                "rule_max_fc": "0.0"
            },
            {
                "eia_plant_id": "649",
                "horizon": "now",
                "score": "0.2",
                "model_version": "hazidx-test",
                "site_name": "Vogtle",
                "timezone": "America/New_York",
                "local_date": "2026-10-18",
                "top_driver": "storm",
                "rain_24h_mm": "0.0",
                "rain_prev7d_mm": "0.0",
                "gust_max_mph": "5.0",
                "hi_max_f": "70.0",
                "wbgt_max_f": "60.0",
                "rule_max_fc": "0.0"
            }
        ]
        with open(p, "w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
            w.writeheader()
            w.writerows(rows)
        return p

    def test_build_search_prompt(self):
        row = {
            "site_name": "Turkey Point",
            "top_driver": "flood",
            "score": "4.5",
            "horizon": "now",
            "local_date": "2026-10-18",
            "rain_24h_mm": "50.0"
        }
        nws = {"county_name": "Miami-Dade", "state": "FL", "forecast_zone_name": "Coastal Miami-Dade"}
        prompt = fetch_evidence.build_search_prompt(row, nws)
        self.assertIn("Turkey Point", prompt)
        f"Miami-Dade County" in prompt
        self.assertIn("FLOOD", prompt)
        self.assertIn("4.5/10", prompt)
        self.assertIn("24h rain: 50.0 mm", prompt)

    def test_mock_evidence_for_all_drivers(self):
        for driver in ("flood", "fire", "storm", "heat"):
            row = {"top_driver": driver, "site_name": "Plant X", "local_date": "2026-10-18"}
            nws = {"county_name": "TestCounty", "state": "TS"}
            ev = fetch_evidence.mock_evidence_for_row(row, nws)
            self.assertTrue(len(ev["summary"]) > 20)
            self.assertTrue(len(ev["articles"]) >= 1)
            first = ev["articles"][0]
            self.assertIn("title", first)
            self.assertIn("url", first)
            self.assertIn("source", first)

    def test_build_push_sql(self):
        records = [{
            "eia_plant_id": "621",
            "horizon": "now",
            "driver": "flood",
            "hazard_score": 4.5,
            "summary": "Heavy rain caused local road flood's and ponding.",
            "articles": [{"title": "News Title", "url": "https://example.com/flood", "source": "example.com"}],
            "model_version": "hazidx-test"
        }]
        sql = fetch_evidence.build_push_sql(records, "test.csv")
        self.assertIn("select public.upsert_hazard_evidence", sql)
        self.assertIn("('621', 'now', 'flood', 4.5", sql)
        self.assertIn("flood''s", sql)  # Escaped single quote

    def test_fetch_all_evidence_dry_run(self):
        csv_file = self.sample_csv()
        with patch.object(fetch_evidence, "EVIDENCE_DIR", self.dir / "evidence"):
            records, json_out, sql_out = fetch_evidence.fetch_all_evidence(
                csv_path=csv_file,
                min_score=3.0,
                dry_run=True
            )
            # 621 (4.5) and 6163 (4.1) meet threshold >= 3.0; 649 (0.2) does not.
            self.assertEqual(len(records), 2)
            self.assertEqual({r["eia_plant_id"] for r in records}, {"621", "6163"})
            self.assertTrue(json_out.exists())
            self.assertTrue(sql_out.exists())
            saved_json = json.loads(json_out.read_text(encoding="utf-8"))
            self.assertEqual(len(saved_json), 2)

    def test_query_gemini_search_parsing(self):
        mock_response = {
            "candidates": [{
                "content": {
                    "parts": [{
                        "text": json.dumps({
                            "summary": "Verified local river flood warnings in effect.",
                            "articles": [{
                                "title": "Major River Overflow Notice",
                                "url": "https://news.weather.gov/rivers",
                                "source": "weather.gov",
                                "snippet": "Water levels exceeding moderate flood stage."
                            }]
                        })
                    }]
                },
                "groundingMetadata": {
                    "groundingChunks": [
                        {"web": {"uri": "https://apnews.com/article/flooding", "title": "AP News Flood Report"}}
                    ]
                }
            }]
        }
        with patch("urllib.request.urlopen") as mock_url:
            mock_cm = MagicMock()
            mock_cm.__enter__.return_value.read.return_value = json.dumps(mock_response).encode("utf-8")
            mock_url.return_value = mock_cm

            res = fetch_evidence.query_gemini_search("Test prompt", "fake_key")
            self.assertIn("Verified local river flood warnings", res["summary"])
            # Should have parsed both JSON article and grounding chunk
            urls = [a["url"] for a in res["articles"]]
            self.assertIn("https://news.weather.gov/rivers", urls)
            self.assertIn("https://apnews.com/article/flooding", urls)


if __name__ == "__main__":
    unittest.main()
