"""Hazard index section: reads the dry-run CSV written by models/hazard-index/run.sh score. Nothing is
fetched and nothing is written. A run older than MAX_AGE_HOURS is refused, as push.py refuses it."""
from __future__ import annotations

import csv
import json
from datetime import datetime, timezone
from pathlib import Path

from . import paths

MAX_AGE_HOURS = 24
FAMILIES = ("heat", "storm", "flood", "fire")
# Same 0-10 scale as the rule sub-scores: about 3 watch, 7.5 warning, 10 stop work.
TIERS = ((10.0, "stop work"), (7.5, "warning"), (3.0, "watch"), (0.0, "low"))
FAMILY_TEXT = {"heat": "heat illness", "storm": "thunderstorm, hail, lightning or tornado",
               "flood": "flash flood, flood or heavy rain", "fire": "wildfire or dense smoke"}


def tier(score: float) -> str:
    return next(name for floor, name in TIERS if score >= floor)


def load_rows(dryrun_dir: Path = paths.HAZARD_DRYRUN) -> list[dict]:
    rows = []
    for f in sorted(Path(dryrun_dir).glob("ml_scores_*.csv")):
        with f.open(newline="", encoding="utf-8") as fh:
            for r in csv.DictReader(fh):
                r["_file"] = f.name
                rows.append(r)
    return rows


def _ts(iso: str) -> datetime:
    return datetime.fromisoformat(iso.replace("Z", "+00:00")).astimezone(timezone.utc)


def _caveats(model_version: str, models_dir: Path) -> list[str]:
    out = ["The score is the chance that NOAA records a severe event of that kind near the plant, weighted by "
           "how often OSHA injuries follow. It is not a count of injuries.",
           "The model was trained on 60 power plants and on reanalysis weather, then scored on live forecasts."]
    try:
        metrics = json.loads((Path(models_dir) / model_version / "metrics.json").read_text(encoding="utf-8"))
        weak = [f for f in FAMILIES if not metrics["families"][f].get("beats_climatology", True)]
    except (OSError, KeyError, ValueError):
        weak = []
        out.append("Model test metrics were not found, so skill per hazard is not shown.")
    for f in weak:
        out.append(f"In tests the {f} model did not beat a simple seasonal average. Do not act on a {f} driver alone.")
    return out


def build(eia: str, for_date: str, as_of: datetime, rows: list[dict] | None = None,
          models_dir: Path = paths.HAZARD_DRYRUN.parent / "models") -> dict:
    rows = load_rows() if rows is None else rows
    mine = [r for r in rows if r["eia_plant_id"] == eia and r["local_date"] == for_date]
    cmd = f"models/hazard-index/run.sh score --date {for_date}"
    if not mine:
        return {"status": "missing", "reason": f"No hazard-index run covers {for_date}. Run `{cmd}` first."}
    best = max(mine, key=lambda r: _ts(r["run_at_utc"]))
    age_h = (as_of - _ts(best["run_at_utc"])).total_seconds() / 3600
    if age_h > MAX_AGE_HOURS:
        return {"status": "missing", "run_at_utc": best["run_at_utc"],
                "reason": f"The newest hazard-index run is {age_h:.0f} hours old (limit {MAX_AGE_HOURS}). Run `{cmd}` again."}
    score = float(best["score"])
    probs = {f: float(best[f"p_{f}"]) for f in FAMILIES}
    return {
        "status": "ok", "score": score, "tier": tier(score), "top_driver": best["top_driver"],
        "top_driver_text": FAMILY_TEXT.get(best["top_driver"], best["top_driver"]),
        "probabilities": probs, "risk_preview": float(best["risk_preview"]), "rule_max_forecast": float(best["rule_max_fc"]),
        "drift_flags": [x for x in best["drift_flags"].split(";") if x] if best["drift_flags"] else [],
        "inputs": {"wbgt_max_f": float(best["wbgt_max_f"]), "heat_index_max_f": float(best["hi_max_f"]),
                   "gust_max_mph": float(best["gust_max_mph"]), "rain_24h_mm": float(best["rain_24h_mm"]),
                   "rain_prev_7d_mm": float(best["rain_prev7d_mm"])},
        "model_version": best["model_version"], "forecast_model": best["forecast_model"],
        "run_at_utc": best["run_at_utc"], "horizon": best["horizon"], "source_file": best["_file"],
        "caveats": _caveats(best["model_version"], models_dir),
    }
