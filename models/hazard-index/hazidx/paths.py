"""File locations, all relative to this package so every script works from any working directory."""
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent          # models/hazard-index/
REPO = ROOT.parent.parent                              # repository root

SEED_SITES = REPO / "supabase" / "seed-sites.sql"
OSHA_CSV = REPO / "data" / "osha-hazards-outcome" / "January2015toNovember2025.csv"
TS_SHARED = REPO / "supabase" / "functions" / "_shared"

CACHE = ROOT / "cache"
WEATHER = CACHE / "weather"
WEATHER_LEDGER = WEATHER / "ledger.jsonl"
STORMS = CACHE / "storm_events"
DATASET = CACHE / "dataset"
SITE_DAYS = DATASET / "site_days.parquet"
EVENTS_MATCHED = DATASET / "events_matched.parquet"

ARTIFACTS = ROOT / "artifacts"
SITES_NWS = ARTIFACTS / "sites_nws.json"
LABELS_REPORT = ARTIFACTS / "labels_report.json"
SEVERITY = ARTIFACTS / "severity.json"
SEVERITY_MATCHES = ARTIFACTS / "severity_matches.csv"
MODELS = ARTIFACTS / "models"
DRYRUN = ARTIFACTS / "dryrun"


def ensure(*dirs: Path) -> None:
    for d in dirs:
        d.mkdir(parents=True, exist_ok=True)


def user_path(p: Path) -> Path:
    """A path the user typed: relative to the directory run.sh was called from (HAZIDX_CALLER_PWD), else to the
    current directory, else to models/hazard-index/ or the repository root."""
    import os
    if p.is_absolute():
        return p
    for base in (os.environ.get("HAZIDX_CALLER_PWD"), Path.cwd(), ROOT, REPO):
        if base and (Path(base) / p).exists():
            return Path(base) / p
    return p
