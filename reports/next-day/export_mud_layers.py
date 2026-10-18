"""Writes one small mud layer file per site for the site map: public/mud/<eia>.json, plus public/mud/index.json.

Independent of the next-day report, so every site in the newest model run can show the layer.
Each file holds the model's label and thresholds and only the inspect/hold routes for the run's first
horizon ("now"). Re-run after each model run:

    cd reports/next-day && PYTHONPATH=. ../../.venv/bin/python export_mud_layers.py [--run PATH]
"""
from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

from nextday import mud

PUBLIC = Path(__file__).resolve().parents[2] / "public" / "mud"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run", type=Path, help="a model run folder (default: output/LATEST)")
    args = parser.parse_args()
    run_dir = args.run or mud.latest_run()
    if run_dir is None:
        raise SystemExit("No mud-trafficability run found. Run models/mud-trafficability/run_daily.sh first.")
    run = json.loads((run_dir / "run.json").read_text(encoding="utf-8"))
    generated = datetime.fromisoformat(run["generated_at"]).astimezone(timezone.utc)
    PUBLIC.mkdir(parents=True, exist_ok=True)
    for old in PUBLIC.glob("*.json"):
        old.unlink()
    index, total = [], 0
    for site in run["sites"]:
        eia = str(site["eia"])
        horizon = site["horizons"][0]
        # as_of is the run time, so the file is never marked stale; the app shows the run date instead.
        section, geo = mud.build(eia, horizon["date"], generated, run_dir)
        if section.get("status") not in ("ok", "stale"):
            print(f"{eia}: skipped ({section.get('status')}: {section.get('reason', '')})")
            continue
        # A site with nothing flagged still gets a file, so the layer can say so.
        geo = geo or {"type": "FeatureCollection", "features": []}
        section.pop("routes_file", None)
        body = {"eia": eia, **section, "routes": geo}
        text = json.dumps(body, separators=(",", ":"))
        (PUBLIC / f"{eia}.json").write_text(text, encoding="utf-8")
        total += len(text)
        index.append({"eia": eia, "horizon": horizon["label"], "date": horizon["date"],
                      "routes": len(geo["features"])})
    (PUBLIC / "index.json").write_text(
        json.dumps({"schema_version": 1, "generated_at": run["generated_at"], "run": run_dir.name, "sites": index},
                   indent=1), encoding="utf-8")
    print(f"wrote {len(index)} sites, {total / 1e6:.1f} MB, from {run_dir.name}")


if __name__ == "__main__":
    main()
