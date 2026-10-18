#!/usr/bin/env bash
# Hazard Index (0-10): one entry point for the offline model in models/hazard-index/.
# Works from any directory. Nothing here writes to a database.
#
#   ./run.sh                      live scores for today and tomorrow (same as: ./run.sh score)
#   ./run.sh score [args]         dryrun.py [args], e.g. --site-map site_ids.csv   (Open-Meteo, ~220 calls)
#   ./run.sh replay DATE [EIA..]  score a past day from the ERA5 cache, e.g. replay 2024-08-14 56407   (offline)
#   ./run.sh rescore STAMP [args] rescore saved live responses, e.g. rescore 20261018T042429Z --date 2026-10-18
#   ./run.sh train                build_dataset -> compute_severity -> train -> evaluate   (offline, cached data)
#   ./run.sh fetch [BUDGET]       Storm Events, NWS zones (once), Open-Meteo archive (default budget 8500 calls)
#   ./run.sh all [BUDGET]         fetch -> train -> score
#   ./run.sh status               download coverage, current model, test metrics
#   ./run.sh test                 unit tests (node needed for the TypeScript parity test)
#   ./run.sh notebook             execute notebooks/results.ipynb in place
#   ./run.sh evidence [CSV]       query news articles & evidence for elevated hazard index sites
#   ./run.sh push [CSV] [--apply] upload scores to production ml_scores as model 'hazidx' (asks for the project ref);
#                                 without --apply only writes the SQL; --clear --apply removes the hazidx rows
#
# Exit codes are the scripts' own: 0 ok, 1 error, 2 blocked by network policy, 3 API quota used up.
# Set PYTHON to use another interpreter (default: the repository's .venv).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SELF="$HERE/$(basename "${BASH_SOURCE[0]}")"
REPO="$(cd "$HERE/../.." && pwd)"
PY="${PYTHON:-$REPO/.venv/bin/python}"
export HAZIDX_CALLER_PWD="$PWD"   # so relative paths given to push/--site-map still resolve after the cd
cd "$HERE"

usage() { sed -n '2,19p' "$SELF" | sed 's/^# \{0,1\}//'; }

need_python() {
  if [ ! -x "$PY" ]; then
    echo "No Python at $PY. Create the venv and run: $REPO/.venv/bin/pip install -r $REPO/requirements.txt" >&2
    echo "(or set PYTHON=/path/to/python)" >&2
    exit 1
  fi
}

need_model() {
  if [ ! -f artifacts/models/latest.json ]; then
    echo "No trained model yet (artifacts/models/latest.json). Run: $SELF train" >&2
    exit 1
  fi
}

step() { echo; echo "== $*"; }

latest_scores() {
  local csv
  csv="$(ls -t artifacts/dryrun/ml_scores_*.csv 2>/dev/null | head -n 1 || true)"
  [ -n "$csv" ] || return 0
  "$PY" - "$csv" <<'EOF'
import sys
import pandas as pd
d = pd.read_csv(sys.argv[1], dtype={"eia_plant_id": str})
print(f"\n{sys.argv[1]}: {len(d)} rows, model {d['model_version'].iloc[0]}")
cols = ["site_name", "horizon", "local_date", "score", "top_driver", "rule_max_fc", "risk_preview"]
print(d.sort_values("risk_preview", ascending=False)[cols].head(10).to_string(index=False))
EOF
}

cmd_score() {
  need_model
  step "Live scores for today and tomorrow (dryrun.py)"
  "$PY" dryrun.py "$@"
  latest_scores
}

cmd_replay() {
  need_model
  if [ $# -lt 1 ]; then echo "usage: $SELF replay YYYY-MM-DD [EIA_PLANT_ID ...]" >&2; exit 1; fi
  local day="$1"; shift
  step "Replay $day from the ERA5 cache (dryrun.py --replay)"
  if [ $# -gt 0 ]; then
    "$PY" dryrun.py --replay "$day" --plants "$@"
  else
    "$PY" dryrun.py --replay "$day"
  fi
}

cmd_rescore() {
  need_model
  if [ $# -lt 1 ]; then echo "usage: $SELF rescore STAMP [dryrun args]   (STAMP: a file in cache/dryrun_raw/, without .json)" >&2; exit 1; fi
  local stamp="$1"; shift
  step "Rescore saved responses $stamp (dryrun.py --from-raw)"
  "$PY" dryrun.py --from-raw "$stamp" "$@"
  latest_scores
}

cmd_train() {
  step "Build the data set (build_dataset.py)";      "$PY" build_dataset.py
  step "Severity weights (compute_severity.py)";     "$PY" compute_severity.py
  step "Train (train.py)";                           "$PY" train.py
  step "Evaluate on the test years (evaluate.py)";   "$PY" evaluate.py
}

# Returns the weather downloader's exit code; 3 (quota) is reported, not fatal. Every step checks its own
# exit code because `all` calls this function inside `||`, where bash switches off set -e.
cmd_fetch() {
  local budget="${1:-8500}" rc=0
  step "NOAA Storm Events (fetch_storms.py)"
  "$PY" fetch_storms.py || exit $?
  if [ ! -f artifacts/sites_nws.json ]; then
    step "NWS county and forecast zone per plant (fetch_sites.py)"
    "$PY" fetch_sites.py || exit $?
  fi
  step "Open-Meteo archive, budget $budget calls (fetch_weather.py run)"
  "$PY" fetch_weather.py run --budget "$budget" || rc=$?
  if [ "$rc" -eq 3 ]; then
    echo "Quota used up; downloaded files are kept. Run '$SELF fetch' again after 00:00 UTC." >&2
  elif [ "$rc" -ne 0 ]; then
    exit "$rc"
  fi
  return "$rc"
}

cmd_status() {
  step "Download coverage (fetch_weather.py status)"
  "$PY" fetch_weather.py status
  if [ -f artifacts/models/latest.json ]; then
    step "Current model"
    "$PY" - <<'EOF'
import json
from pathlib import Path
v = json.loads(Path("artifacts/models/latest.json").read_text())["model_version"]
d = Path("artifacts/models") / v
print(f"{v}\n  {(d / 'bundle.joblib').resolve()}")
m = d / "metrics.json"
if not m.exists():
    print("  no metrics.json yet (run: ./run.sh train)")
    raise SystemExit
m = json.loads(m.read_text())
f = lambda x: "  -  " if x is None else f"{x:.3f}"
print(f"  test years {m['years']['test']}, {m['test_rows']:,} plant-days")
print(f"  {'family':<7}{'PR-AUC':>8}{'clim':>8}{'BSS':>8}  beats climatology")
for fam, x in m["families"].items():
    print(f"  {fam:<7}{f(x['pr_auc']['full']):>8}{f(x['pr_auc']['climatology']):>8}{f(x['brier_skill']['full']):>8}  {x['beats_climatology']}")
ix = m["index"]
print(f"  index ROC-AUC any event {f(ix['roc_auc_any_event'])} (rule maximum {f(ix['rule_max_roc_auc_any_event'])})")
EOF
  fi
  latest_scores
}

main() {
  local cmd="${1:-score}"
  [ $# -gt 0 ] && shift
  case "$cmd" in
    help|-h|--help) usage; exit 0 ;;
  esac
  need_python
  case "$cmd" in
    score)    cmd_score "$@" ;;
    replay)   cmd_replay "$@" ;;
    rescore)  cmd_rescore "$@" ;;
    train)    cmd_train ;;
    fetch)    cmd_fetch "$@" || exit $? ;;
    all)
      cmd_fetch "$@" || [ $? -eq 3 ]   # a used-up quota still trains on what is downloaded
      cmd_train
      cmd_score ;;
    status)   cmd_status ;;
    test)     "$PY" -m unittest discover -s tests -t . ;;
    notebook) "$PY" -m jupyter nbconvert --to notebook --execute --inplace notebooks/results.ipynb ;;
    evidence) "$PY" fetch_evidence.py "$@" ;;
    push)     "$PY" push.py "$@" ;;
    *) echo "unknown command: $cmd" >&2; usage >&2; exit 1 ;;
  esac
}

main "$@"
