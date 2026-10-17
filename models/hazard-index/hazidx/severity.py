"""OSHA severity weights s_h: severe injuries per Storm Events event-day for each family, shrunk
toward the overall rate, then mapped on a log scale to WEIGHT_MIN..1.0.

  N_h  SIR injuries in family h (NAICS 2211 and 237, federal-OSHA states, Jan 2015 - Nov 2025).
       Heat: OIICS event code starting 531. Other families: narrative search, after known false
       matches are removed ("lightning arrester", "storm drain", "gust" inside "August", ...).
  D_h  distinct county-days or zone-days with a family-h event in the same states and period.
  r_h  (N_h + k) / (D_h + k / r0), r0 = sum N / sum D, k = PRIOR_INJURIES (Gamma-Poisson).
  s_h  WEIGHT_MIN + (1 - WEIGHT_MIN) * (ln r_h - ln r_min) / (ln r_max - ln r_min); 1.0 when all equal.
"""
from __future__ import annotations

import math
import re

import numpy as np
import pandas as pd
from scipy import stats

from . import config

# Narrative patterns. Order matters only for reporting; a narrative can match several families.
FALSE_MATCHES = re.compile(
    r"lightning (arrest[eo]rs?|protection|rods?)|storm ?(drain|sewer|water|pipe|inlet|structure|manhole|line|basin|"
    r"box|culvert|grate|catch|system|main|trench|door|window)s?|brainstorm|\bstormed\b|"
    r"\b(snow|ice|winter) ?storms?\b|"   # winter weather is not the storm family
    r"flood ?lights?|floodlights?|flood(ed|ing)? (the|with) (gas|fuel|oil)|flood coat|"
    r"hail(ed)? (a|him|her|the) |fire ?(alarm|extinguisher|hose|hydrant|truck|department|fighter)s?",
    re.IGNORECASE)
NARRATIVE = {
    "storm": re.compile(r"\b(lightning|tornado(es)?|thunder ?storms?|hail ?storms?|hail|wind ?gusts?|gusts? of wind|"
                        r"gusts?|high winds?|strong winds?|storms?|microburst|downburst|severe weather)\b", re.IGNORECASE),
    "flood": re.compile(r"\b(flash flood(s|ing)?|flood(s|ed|ing)?|flood ?waters?|heavy rain(s|fall)?|torrential rain|"
                        r"swift water|rising water)\b", re.IGNORECASE),
    "fire": re.compile(r"\b(wild ?fires?|forest fires?|brush fires?|wildland fires?|grass fires?|dense smoke|"
                       r"wildfire smoke|smoke from (a|the) (wild|forest|brush) ?fire)\b", re.IGNORECASE),
}


def federal_states(sir: pd.DataFrame) -> list[str]:
    """States (SIR spelling) where at least half of the rows are federal-OSHA jurisdiction."""
    share = sir.groupby("State")["FederalState"].apply(lambda s: (s.astype(str).str.strip() == "1").mean())
    return sorted(share[share >= 0.5].index.tolist())


def classify(narrative: str, event_code: str) -> list[tuple[str, str]]:
    """[(family, matched text)] for one SIR row."""
    out = []
    if str(event_code).strip().startswith("531"):
        # The OIICS code names the injury mechanism, so a heat injury that mentions a storm in
        # passing ("damaged during a storm") counts as heat only.
        return [("heat", f"OIICS {str(event_code).strip()}")]
    text = FALSE_MATCHES.sub(" ", str(narrative or ""))
    for fam, pat in NARRATIVE.items():
        m = pat.search(text)
        if m:
            out.append((fam, m.group(0)))
    return out


def injuries(sir: pd.DataFrame) -> pd.DataFrame:
    """Matched injuries in the worker population and federal-OSHA states, one row per (row, family)."""
    fed = set(federal_states(sir))
    d = pd.to_datetime(sir["EventDate"], format="%m/%d/%Y", errors="coerce")
    pop = sir[sir["Primary NAICS"].fillna("").astype(str).str.match(rf"^({'|'.join(config.NAICS_PREFIXES)})")
              & sir["State"].isin(fed) & d.between(config.OSHA_START, config.OSHA_END)]
    rows = []
    for _, r in pop.iterrows():
        for fam, hit in classify(r.get("Final Narrative"), r.get("Event")):
            rows.append({"ID": r["ID"], "EventDate": r["EventDate"], "State": r["State"],
                         "NAICS": r["Primary NAICS"], "family": fam, "matched": hit,
                         "Event": str(r.get("Event")).strip(), "EventTitle": r.get("EventTitle"),
                         "Hospitalized": r.get("Hospitalized"), "Amputation": r.get("Amputation"),
                         "Final Narrative": r.get("Final Narrative")})
    return pd.DataFrame(rows, columns=["ID", "EventDate", "State", "NAICS", "family", "matched", "Event", "EventTitle",
                                       "Hospitalized", "Amputation", "Final Narrative"])


def event_unit_days(ev: pd.DataFrame, state_fips: set[int]) -> pd.DataFrame:
    """Distinct (family, state, county-or-zone, local date) units in the given states and period.
    Dates are the event's own local dates (standard time), start to end, at most EVENT_DAY_CAP."""
    e = ev[ev["STATE_FIPS"].isin(state_fips) & ev["CZ_TYPE"].isin(["C", "Z"])].copy()
    off = pd.to_timedelta(e["CZ_TIMEZONE"].map(_offset), unit="h")
    start = (e["begin_utc"].dt.tz_localize(None) + off).dt.normalize()
    end = (e["end_utc"].dt.tz_localize(None) + off).dt.normalize()
    n = ((end - start).dt.days + 1).clip(lower=1, upper=config.EVENT_DAY_CAP).to_numpy()
    idx = np.repeat(np.arange(len(e)), n)
    offs = np.concatenate([np.arange(k) for k in n]) if len(n) else np.array([], int)
    out = pd.DataFrame({"family": e["family"].to_numpy()[idx], "STATE_FIPS": e["STATE_FIPS"].to_numpy()[idx],
                        "CZ_TYPE": e["CZ_TYPE"].to_numpy()[idx], "CZ_FIPS": e["CZ_FIPS"].to_numpy()[idx],
                        "date": start.to_numpy()[idx] + offs.astype("timedelta64[D]")})
    out = out[(out["date"] >= pd.Timestamp(config.OSHA_START)) & (out["date"] <= pd.Timestamp(config.OSHA_END))]
    return out.drop_duplicates()


def _offset(code) -> float:
    from .labels import tz_offset_hours
    return tz_offset_hours(code)


def shrunk_rates(n: dict[str, float], d: dict[str, float], k: float = config.PRIOR_INJURIES) -> tuple[dict, float]:
    r0 = sum(n.values()) / sum(d.values())
    return {f: (n[f] + k) / (d[f] + k / r0) for f in n}, r0


def rate_interval(n: float, d: float, r0: float, k: float = config.PRIOR_INJURIES, level: float = 0.90) -> tuple[float, float]:
    a, rate = n + k, d + k / r0
    lo, hi = stats.gamma.ppf([(1 - level) / 2, (1 + level) / 2], a, scale=1 / rate)
    return float(lo), float(hi)


def log_weights(rates: dict[str, float], wmin: float = config.WEIGHT_MIN) -> dict[str, float]:
    lo, hi = min(rates.values()), max(rates.values())
    if math.isclose(lo, hi, rel_tol=1e-12):
        return {f: 1.0 for f in rates}
    span = math.log(hi) - math.log(lo)
    return {f: wmin + (1 - wmin) * (math.log(r) - math.log(lo)) / span for f, r in rates.items()}
