"""File locations, all relative to this package so every command works from any working directory."""
from __future__ import annotations

from pathlib import Path

PKG = Path(__file__).resolve().parent
ROOT = PKG.parent                                    # reports/next-day/
REPO = ROOT.parent.parent                            # repository root

DATA = PKG / "data"
CACHE = ROOT / "cache"
SNAPSHOTS = CACHE / "snapshots"
NLD_CACHE = CACHE / "nld"

PUBLIC_REPORTS = REPO / "public" / "reports"

HAZARD_DRYRUN = REPO / "models" / "hazard-index" / "artifacts" / "dryrun"
MUD_OUTPUT = REPO / "models" / "mud-trafficability" / "output"
MUD_CACHE = REPO / "models" / "mud-trafficability" / "cache"
RIVER_POINTS_CSV = REPO / "data" / "flood-data" / "long_range_river_flood_risk_data.csv"
BRIEFING_TS = REPO / "supabase" / "functions" / "_shared" / "briefing.ts"
