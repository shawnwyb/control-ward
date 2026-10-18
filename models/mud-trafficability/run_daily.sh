#!/usr/bin/env bash
# Daily rutting-forecast run: tests -> forecast -> map -> preflight -> push --apply -> verify -> site_risk check.
#
# Usage (from anywhere): models/mud-trafficability/run_daily.sh [--eia ID,ID,...] [--metric max|p90] [--skip-prepare]
#
# This NEVER applies to production unattended. The apply step (`stram push --apply`) always shows a preview and
# then reads a typed project ref from the terminal; without a terminal it refuses and this script stops. See
# RUNBOOK.md for the full procedure, one-time setup, and troubleshooting.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
PY="$REPO/.venv/bin/python"
cd "$HERE"

EIA_ARGS=()
METRIC="p90"
SKIP_PREPARE=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --eia) EIA_ARGS=(--eia "$2"); shift 2 ;;
    --metric) METRIC="$2"; shift 2 ;;
    --skip-prepare) SKIP_PREPARE=1; shift ;;
    -h|--help) sed -n '2,/^set -e/p' "$0" | sed '$d; s/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

log() { printf '\n==> %s\n' "$1"; }
die() { printf '\nABORTED: %s\n' "$1" >&2; exit 1; }

[[ -x "$PY" ]] || die "$PY not found. From the repo root: python3.11 -m venv .venv && .venv/bin/pip install -r requirements.txt"
command -v supabase >/dev/null 2>&1 || die "Supabase CLI not on PATH. See RUNBOOK.md -> One-time machine setup."
[[ -f "$REPO/supabase/.temp/project-ref" ]] || die "Not linked to a Supabase project. Run: supabase login && supabase link --project-ref <ref>  (from $REPO)"
REF="$(cat "$REPO/supabase/.temp/project-ref")"
echo "Repo:    $REPO"
echo "Project: $REF (linked)"
echo "Metric:  $METRIC"

log "1/7 unit tests (no network)"
"$PY" -m unittest discover -s tests

if [[ $SKIP_PREPARE -eq 0 ]]; then
  log "2/7 prepare (skips sites already cached; pass --skip-prepare to skip entirely)"
  "$PY" -m stram prepare "${EIA_ARGS[@]}"
else
  log "2/7 prepare skipped (--skip-prepare)"
fi

log "3/7 forecast"
"$PY" -m stram forecast "${EIA_ARGS[@]}"

log "4/7 map"
"$PY" -m stram map

log "5/7 preflight: existing production ml_scores, by model"
supabase db query --linked --workdir "$REPO" --output-format json \
  "select model_version, horizon, count(*)::int as n, min(score)::float as lo, max(score)::float as hi
   from public.ml_scores group by 1,2 order by 1,2" \
  2>/dev/null | python3 -c '
import json, sys
rows = json.load(sys.stdin).get("rows", [])
if not rows:
    print("  (ml_scores is currently empty)")
for r in rows:
    mv, h, n, lo, hi = r["model_version"], r["horizon"], r["n"], r["lo"], r["hi"]
    print(f"  {mv:30s} {h:9s} n={n:<4d} {lo}-{hi}")
'
echo "  A model other than this run's model_version listed above will be left alone (push only touches its own rows)."
echo "  This run's model_version:"
"$PY" -c "from stram import config as C; print(' ', C.MODEL_VERSION)"

log "6/7 push --apply: preview, then type the project ref ($REF) to apply, or Ctrl-C to cancel"
"$PY" -m stram push --metric "$METRIC" --apply

log "7/7 verify (hosted; both roll back; success is an error starting 'ALL ... CHECKS PASSED')"
cd "$REPO"
VM_OUT="$(npm run --silent verify:monitoring 2>&1 || true)"
echo "$VM_OUT" | tail -3
echo "$VM_OUT" | grep -q "ALL CHECKS PASSED" || die "verify:monitoring did not report ALL CHECKS PASSED"
VR_OUT="$(npm run --silent verify:rules 2>&1 || true)"
echo "$VR_OUT" | tail -3
echo "$VR_OUT" | grep -q "ALL RULE CHECKS PASSED" || die "verify:rules did not report ALL RULE CHECKS PASSED"

log "site_risk, now (next evaluate-all-sites run is within 5 min; re-run this block later to see it update)"
supabase db query --linked --workdir "$REPO" --output-format json \
  "select horizon, count(*) filter (where top_driver like 'ML mud trafficability%')::int as ml_driven, count(*)::int as n
   from public.site_risk group by horizon order by horizon" \
  2>/dev/null | python3 -c '
import json, sys
for r in json.load(sys.stdin).get("rows", []):
    h, ml, n = r["horizon"], r["ml_driven"], r["n"]
    print(f"  {h:9s} ML is the driver at {ml}/{n} sites")
'

cat <<EOF

Done. Rollback if needed:
  cd $HERE && $PY -m stram push --clear --apply
EOF
