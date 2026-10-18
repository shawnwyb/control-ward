"""`push --apply` refusals, confirmation and read-back, with the Supabase CLI replaced by a fake. No network."""
import csv
import json
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from subprocess import CompletedProcess
from unittest import mock

from stram import config as C, push

REF = "abcdefghijklmnopqrst"
SITES = {"649": "Vogtle", "6008": "Palo Verde"}


def make_run(tmp: Path, age_hours: float = 1.0) -> Path:
    run = tmp / "run_test"
    run.mkdir()
    generated = (datetime.now(timezone.utc) - timedelta(hours=age_hours)).isoformat(timespec="seconds")
    (run / "run.json").write_text(json.dumps({"generated_at": generated,
                                              "sites": [{"eia": e, "name": n} for e, n in SITES.items()]}))
    rows = []
    for eia, (p90, mx) in {"649": (6.5, 6.5), "6008": (3.3, 6.5)}.items():
        for h in ("now", "d1", "d2"):
            rows.append({"eia": eia, "horizon": h, "passes": C.DEFAULT_PASSES, "equipment": "road_truck",
                         "score": mx, "score_p90": p90})
    with open(run / "sites.csv", "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(rows)
    return run


class FakeCLI:
    """Answers the three queries apply() makes, and records every call."""

    def __init__(self, sites=tuple(SITES), applied=True, read_back=None, apply_rc=0):
        self.calls, self.sites, self.applied, self.read_back, self.apply_rc = [], sites, applied, read_back, apply_rc

    def __call__(self, args):
        self.calls.append(args)
        if "-f" in args:
            return CompletedProcess(args, self.apply_rc, "", "boom" if self.apply_rc else "")
        sql = args[-1]
        if "from public.sites" in sql:
            rows = [{"eia_plant_id": e} for e in self.sites]
        elif "group by horizon" in sql:
            rows = self.read_back if self.read_back is not None else (
                [{"horizon": "now", "n": 2, "lo": 3.3, "hi": 6.5}, {"horizon": "tomorrow", "n": 2, "lo": 3.3, "hi": 6.5}]
                if self.applied else [])
        else:  # clear: current row count
            rows = [{"n": 4}]
        return CompletedProcess(args, 0, json.dumps({"rows": rows}), "")


class Apply(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.run = make_run(Path(self.tmp.name))
        self.out = []
        self.patches = [mock.patch.object(push, "supabase_cli", return_value="/usr/bin/supabase"),
                        mock.patch.object(push, "linked_project_ref", return_value=REF)]
        for p in self.patches:
            p.start()

    def tearDown(self):
        for p in self.patches:
            p.stop()
        self.tmp.cleanup()

    def call(self, fake, **kw):
        with mock.patch.object(push, "_run", fake):
            return push.apply(self.run, out=self.out.append, **kw)

    def test_refuses_without_cli_or_link(self):
        with mock.patch.object(push, "supabase_cli", return_value=None):
            with self.assertRaisesRegex(push.ApplyError, "CLI not found"):
                self.call(FakeCLI(), confirm=REF)
        with mock.patch.object(push, "linked_project_ref", return_value=None):
            with self.assertRaisesRegex(push.ApplyError, "not linked"):
                self.call(FakeCLI(), confirm=REF)

    def test_wrong_confirmation_applies_nothing(self):
        fake = FakeCLI()
        with self.assertRaisesRegex(push.ApplyError, "did not match"):
            self.call(fake, confirm="some-other-project")
        self.assertFalse(any("-f" in c for c in fake.calls))
        self.assertFalse((self.run / "applied.json").exists())

    def test_interactive_confirmation(self):
        fake = FakeCLI()
        self.call(fake, ask=lambda prompt: REF + "\n")
        self.assertTrue(any("-f" in c for c in fake.calls))

    def test_refuses_stale_run_unless_allowed(self):
        old = Path(self.tmp.name) / "old"
        old.mkdir()
        stale = make_run(old, age_hours=30)
        with mock.patch.object(push, "_run", FakeCLI()):
            with self.assertRaisesRegex(push.ApplyError, "30 h old"):
                push.apply(stale, confirm=REF, out=self.out.append)
            push.apply(stale, confirm=REF, allow_stale=True, out=self.out.append)

    def test_refuses_when_sites_are_missing(self):
        fake = FakeCLI(sites=("649",))
        with self.assertRaisesRegex(push.ApplyError, "not in production"):
            self.call(fake, confirm=REF)
        self.assertFalse(any("-f" in c for c in fake.calls))

    def test_success_runs_expected_commands_and_records(self):
        fake = FakeCLI()
        record = self.call(fake, confirm=REF)
        applied = [c for c in fake.calls if "-f" in c]
        self.assertEqual(len(applied), 1)
        self.assertEqual(applied[0][:6], ["/usr/bin/supabase", "db", "query", "--linked", "--workdir", str(C.REPO)])
        self.assertTrue(applied[0][-1].endswith("ml_scores_push.sql"))
        self.assertEqual((record["rows_expected"], record["rows_read_back"], record["metric"]), (4, 4, "p90"))
        self.assertEqual(json.loads((self.run / "applied.json").read_text())["project_ref"], REF)
        preview = "\n".join(self.out)
        self.assertIn(f"production project {REF}", preview)
        self.assertIn("Rows: 4 (2 sites", preview)
        self.assertIn("Undo: python -m stram push --clear --apply", preview)
        self.assertIn("p90", preview)

    def test_read_back_mismatch_is_reported(self):
        fake = FakeCLI(read_back=[{"horizon": "now", "n": 1, "lo": 6.5, "hi": 6.5}])
        with self.assertRaisesRegex(push.ApplyError, "read-back does not match"):
            self.call(fake, confirm=REF)
        self.assertTrue(json.loads((self.run / "applied.json").read_text()).get("rows_read_back") == 1)

    def test_apply_failure_is_reported(self):
        with self.assertRaisesRegex(push.ApplyError, "apply failed: boom"):
            self.call(FakeCLI(apply_rc=1), confirm=REF)

    def test_clear(self):
        fake = FakeCLI(applied=False)
        record = self.call(fake, clear=True, confirm=REF)
        self.assertEqual((record["action"], record["rows_read_back"]), ("clear", 0))
        self.assertTrue([c for c in fake.calls if "-f" in c][0][-1].endswith("ml_scores_clear.sql"))
        self.assertIn("Deletes 4 ml_scores rows", "\n".join(self.out))


class Parse(unittest.TestCase):
    def test_rows_envelopes(self):
        self.assertEqual(push._rows('[{"a": 1}]'), [{"a": 1}])
        self.assertEqual(push._rows('{"rows": [{"a": 1}]}'), [{"a": 1}])
        self.assertEqual(push._rows('[[{"x": 0}], [{"a": 1}]]'), [{"a": 1}])
        with self.assertRaises(push.ApplyError):
            push._rows('{"rows": "nope"}')


if __name__ == "__main__":
    unittest.main()
