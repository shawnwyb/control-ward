#!/usr/bin/env python3
"""Compute the OSHA severity weight s_h of each hazard family (see hazidx/severity.py).

Inputs:  data/osha-hazards-outcome/January2015toNovember2025.csv (OSHA Severe Injury Reports),
         cache/storm_events/ (fetch_storms.py)
Outputs: artifacts/severity.json, artifacts/severity_matches.csv (every matched injury, to read)

Usage
  python compute_severity.py
Exit codes: 0 ok, 1 error.
"""
from __future__ import annotations

import argparse
import json
import sys

import pandas as pd

from fetch_storms import storm_files
from hazidx import config, labels, paths, severity
from hazidx.http import utc_now_iso
from hazidx.states import NAME_TO_ABBR, STATES


def compute() -> dict:
    sir = pd.read_csv(paths.OSHA_CSV, dtype=str, low_memory=False)
    fed = severity.federal_states(sir)
    fed_fips = {STATES[NAME_TO_ABBR[s]][0] for s in fed if s in NAME_TO_ABBR}
    inj = severity.injuries(sir)
    paths.ensure(paths.ARTIFACTS)
    inj.to_csv(paths.SEVERITY_MATCHES, index=False)
    ev = labels.read_events(list(storm_files().values()))
    units = severity.event_unit_days(ev, fed_fips)
    fams = list(config.FAMILIES)
    n = {f: float((inj["family"] == f).sum()) for f in fams}
    d = {f: float((units["family"] == f).sum()) for f in fams}
    rates, r0 = severity.shrunk_rates(n, d)
    weights = severity.log_weights(rates)
    by_type = units.groupby(["family", "CZ_TYPE"]).size().unstack(fill_value=0)
    out = {
        "generated_at": utc_now_iso(),
        "population": {"naics_prefixes": list(config.NAICS_PREFIXES), "period": [config.OSHA_START, config.OSHA_END],
                       "federal_osha_states": fed, "excluded_states": sorted(set(sir["State"].dropna()) - set(fed))},
        "prior_injuries": config.PRIOR_INJURIES, "r0": r0, "weight_min": config.WEIGHT_MIN,
        "families": {f: {"injuries_N": int(n[f]), "event_days_D": int(d[f]), "raw_rate": n[f] / d[f] if d[f] else None,
                         "shrunk_rate_r": rates[f], "rate_90": list(severity.rate_interval(n[f], d[f], r0)),
                         "weight_s": round(weights[f], 4),
                         "event_days_by_cz_type": {k: int(v) for k, v in by_type.loc[f].items()} if f in by_type.index else {}}
                     for f in fams},
        "note": ("Storm, flood and fire weights rest on very few injuries (fire usually on none), so they mostly "
                 "reflect the prior. D mixes county-days (storm, flash flood) and zone-days (heat, wildfire), "
                 "which inflates the heat rate; the log scale limits any family's reduction to 25%."),
    }
    paths.SEVERITY.write_text(json.dumps(out, indent=1))
    return out


def main(argv: list[str] | None = None) -> int:
    argparse.ArgumentParser(description="OSHA severity weights").parse_args(argv)
    try:
        out = compute()
    except (FileNotFoundError, RuntimeError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1
    print(f"{'family':<7}{'N':>6}{'D':>10}{'shrunk r':>12}{'90% interval':>26}{'s':>8}")
    for f, v in out["families"].items():
        lo, hi = v["rate_90"]
        print(f"{f:<7}{v['injuries_N']:>6}{v['event_days_D']:>10,}{v['shrunk_rate_r']:>12.6f}   [{lo:.6f}, {hi:.6f}]{v['weight_s']:>8.3f}")
    print(f"federal-OSHA states: {len(out['population']['federal_osha_states'])}; wrote {paths.SEVERITY} and {paths.SEVERITY_MATCHES}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
