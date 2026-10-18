#!/usr/bin/env bash
# Next-day safety report: one entry point for reports/next-day/. Works from any directory.
# Nothing here writes to a database.
#
#   ./run.sh build [args]        write one JSON report per site into public/reports/ (live data)
#                                  --site EIA [EIA..]    only these sites (default: the sample set)
#                                  --all                 all 60 sites
#                                  --for tomorrow|today  report date (default tomorrow; today = 5 AM refresh)
#                                  --offline STAMP       rebuild from the saved responses in cache/snapshots/STAMP
#   ./run.sh refresh [args]      same as build, and lists what changed since the previous report for the date
#   ./run.sh stations            rank NOAA tide stations near each plant and write the review list
#   ./run.sh calibrate-mud CSV   compare crew 'mud' reports (CSV export) with the flagged routes
#   ./run.sh test                unit tests (node is needed for the TypeScript parity test)
#
# Run order each evening, per time-zone group, at about 17:30 local:
#   models/hazard-index/run.sh score  ->  models/mud-trafficability/run_daily.sh  ->  reports/next-day/run.sh build
# Set PYTHON to use another interpreter (default: the repository's .venv).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SELF="$HERE/$(basename "${BASH_SOURCE[0]}")"
REPO="$(cd "$HERE/../.." && pwd)"
PY="${PYTHON:-$REPO/.venv/bin/python}"
export NEXTDAY_CALLER_PWD="$PWD"   # relative paths given on the command line still resolve after the cd
# nextday itself, the hazard-index package (heat, localtime, sites) and the NLD fetcher (nld_fetch.NLDClient)
export PYTHONPATH="$HERE:$REPO/models/hazard-index:$REPO/data/flood-data${PYTHONPATH:+:$PYTHONPATH}"
cd "$HERE"

usage() { sed -n '2,17p' "$SELF" | sed 's/^# \{0,1\}//'; }

if [ ! -x "$PY" ]; then
  echo "No Python at $PY. Create the venv and run: $REPO/.venv/bin/pip install -r $REPO/requirements.txt" >&2
  echo "(or set PYTHON=/path/to/python)" >&2
  exit 1
fi

cmd="${1:-help}"
[ $# -gt 0 ] && shift
case "$cmd" in
  build|refresh|stations|calibrate-mud) exec "$PY" -m nextday "$cmd" "$@" ;;
  test) exec "$PY" -m unittest discover -s tests -t . "$@" ;;
  help|-h|--help) usage ;;
  *) echo "unknown command: $cmd" >&2; usage >&2; exit 1 ;;
esac
