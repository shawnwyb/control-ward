import json
import subprocess
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest import mock

import push

RUN_AT = "2026-10-18T04:24:29Z"
NOW = datetime(2026, 10, 18, 5, 0, tzinfo=timezone.utc)
VERSION = "hazidx-0.1.0+2018-2022.23ed6848"
FIELDS = ["eia_plant_id", "horizon", "score", "model_version", "site_name", "local_date", "run_at_utc"]


def write_csv(path: Path, plants=("56407", "6008"), run_at=RUN_AT, version=VERSION):
    lines = [",".join(FIELDS)]
    for i, eia in enumerate(plants):
        lines.append(f"{eia},now,{1.5 + i},{version},Plant {eia},2026-10-18,{run_at}")
        lines.append(f"{eia},tomorrow,{2.0 + i},{version},Plant {eia},2026-10-19,{run_at}")
    path.write_text("\n".join(lines) + "\n")
    return path


class FakeCLI:
    """Stands in for the Supabase CLI: answers read queries by keyword and records every call."""

    def __init__(self, has_model=True, sites=("56407", "6008"), back=None):
        self.calls, self.has_model, self.sites = [], has_model, sites
        self.back = back if back is not None else [{"horizon": "now", "n": 2, "lo": 1.5, "hi": 2.5},
                                                   {"horizon": "tomorrow", "n": 2, "lo": 2.0, "hi": 3.0}]

    def __call__(self, args):
        self.calls.append(args)
        sql = args[-1]
        if "-f" in args:
            return subprocess.CompletedProcess(args, 0, "", "")
        if "information_schema.columns" in sql:
            rows = [{"n": 1 if self.has_model else 0}]
        elif "from public.sites" in sql:
            rows = [{"eia_plant_id": e} for e in self.sites]
        elif "where model = 'hazard_index' group by horizon" in sql:
            rows = self.back
        elif "group by 1 order by 1" in sql:
            rows = [{"model": "hazard_index", "n": 4}, {"model": "mud", "n": 120}]
        else:   # models already present
            rows = [{"model": "mud", "horizon": "now", "n": 60, "lo": 2.2, "hi": 6.5}]
        return subprocess.CompletedProcess(args, 0, json.dumps({"rows": rows}), "")

    def applied(self):
        return [c for c in self.calls if "-f" in c]


class PushTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)
        self.csv = write_csv(self.dir / "ml_scores_20261018T042429Z_for20261018.csv")
        self.out = []
        self.patches = [mock.patch.object(push, "supabase_cli", return_value="supabase"),
                        mock.patch.object(push, "linked_project_ref", return_value="abcref")]
        for p in self.patches:
            p.start()

    def tearDown(self):
        for p in self.patches:
            p.stop()
        self.tmp.cleanup()

    def run_apply(self, fake, **kw):
        with mock.patch.object(push, "_run", fake), mock.patch.object(push.paths, "DRYRUN", self.dir):
            return push.apply(kw.pop("csv", self.csv), now=NOW, out=self.out.append, **kw)

    def test_sql_content(self):
        sql = push.push_sql(push.read_scores(self.csv), self.csv.name)
        self.assertIn("'model', 'hazard_index'", sql)
        self.assertIn("join public.sites s on s.eia_plant_id = v.eia", sql)
        self.assertIn(f"('56407', 'now', 1.5, '{VERSION}')", sql)
        self.assertEqual(sql.count(f"'{VERSION}')"), 4)
        self.assertIn("delete from public.ml_scores where model = 'hazard_index'", push.clear_sql())

    def test_apply_confirmed(self):
        fake = FakeCLI()
        rec = self.run_apply(fake, confirm="abcref")
        self.assertEqual(rec["rows_read_back"], 4)
        self.assertTrue(fake.applied()[0][-1].endswith(".push.sql"))
        applied = json.loads((self.dir / "ml_scores_20261018T042429Z_for20261018.applied.json").read_text())
        self.assertEqual(applied["rows_expected"], 4)
        self.assertIn("mud now: 60 rows", "\n".join(self.out))     # preview names the other model

    def test_refuses_without_model_column(self):
        fake = FakeCLI(has_model=False)
        with self.assertRaisesRegex(push.ApplyError, "overwrite"):
            self.run_apply(fake, confirm="abcref")
        self.assertEqual(fake.applied(), [])

    def test_refuses_stale_scores(self):
        stale = write_csv(self.dir / "ml_scores_old.csv", run_at="2026-10-16T00:00:00Z")
        fake = FakeCLI()
        with self.assertRaisesRegex(push.ApplyError, "h old"):
            self.run_apply(fake, csv=stale, confirm="abcref")
        self.assertEqual(fake.applied(), [])
        self.run_apply(FakeCLI(), csv=stale, confirm="abcref", allow_stale=True)

    def test_refuses_missing_site(self):
        fake = FakeCLI(sites=("56407",))
        with self.assertRaisesRegex(push.ApplyError, "not in production"):
            self.run_apply(fake, confirm="abcref")
        self.assertEqual(fake.applied(), [])

    def test_wrong_confirmation_applies_nothing(self):
        fake = FakeCLI()
        with self.assertRaisesRegex(push.ApplyError, "did not match"):
            self.run_apply(fake, confirm="otherref")
        self.assertEqual(fake.applied(), [])
        with self.assertRaisesRegex(push.ApplyError, "did not match"):
            self.run_apply(FakeCLI(), ask=lambda prompt: "nope")

    def test_read_back_mismatch(self):
        fake = FakeCLI(back=[{"horizon": "now", "n": 2, "lo": 1.5, "hi": 2.5}])
        with self.assertRaisesRegex(push.ApplyError, "read-back does not match"):
            self.run_apply(fake, confirm="abcref")

    def test_clear_deletes_only_hazard_index(self):
        fake = FakeCLI(back=[])
        rec = self.run_apply(fake, csv=None, clear=True, confirm="abcref")
        self.assertEqual(rec["action"], "clear")
        sql = Path(fake.applied()[0][-1]).read_text()
        self.assertIn("where model = 'hazard_index'", sql)
        self.assertNotIn("mud", sql)

    def test_bad_rows_rejected(self):
        bad = self.dir / "bad.csv"
        write_csv(bad, version="hazidx-1'; drop table x; --")
        with self.assertRaises(push.ApplyError):
            push.read_scores(bad)


if __name__ == "__main__":
    unittest.main()
