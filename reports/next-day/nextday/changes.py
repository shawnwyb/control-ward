"""What changed since the previous report for the same date. The 6 PM report is a forecast. A 5 AM rebuild
for the same day shows how the forecast moved, so a manager can see the overnight changes at a glance."""
from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path

from . import SCHEMA_VERSION, paths, verdict

WINDOW_SHIFT_H = 1          # a work-window start or end that moved at least this many hours
HEAT_INDEX_F = 3            # peak heat index change
HAZARD_INDEX = 1.0
HOLD_SHARE = 0.10           # change in the number of segments at 'hold', as a share of the rated segments
HIGH_TIDE_MIN = 30
LEVEL_WORD = {"go": "Go", "limits": "Go with limits", "reschedule": "Reschedule"}


def load_previous(out_dir: Path, eia: str, for_date: str) -> dict | None:
    f = Path(out_dir) / eia / for_date / "report.json"
    if not f.is_file():
        return None
    try:
        prev = json.loads(f.read_text(encoding="utf-8"))
    except ValueError:
        return None
    return prev if prev.get("schema_version") == SCHEMA_VERSION else None


def _h(value: str | None) -> int | None:
    return None if value is None else int(value[:2])


def _clock(hhmm: str) -> str:
    h = int(hhmm[:2])
    return f"{h % 12 or 12} {'AM' if h < 12 else 'PM'}"


def _minutes(local_iso: str) -> int:
    return int(local_iso[11:13]) * 60 + int(local_iso[14:16])


def _alerts(report: dict) -> set[str]:
    return {a["event"] for a in (report.get("weather") or {}).get("alerts", [])}


def compare(old: dict, new: dict) -> dict:
    items: list[dict] = []

    def add(section: str, text: str) -> None:
        items.append({"section": section, "text": text})

    ov, nv = old["verdict"], new["verdict"]
    if ov["level"] != nv["level"]:
        worse = verdict.LEVELS.index(nv["level"]) > verdict.LEVELS.index(ov["level"])
        add("verdict", f"The verdict {'got worse' if worse else 'improved'}: from {LEVEL_WORD[ov['level']]} to {LEVEL_WORD[nv['level']]}.")
    ow, nw = ov.get("work_window"), nv.get("work_window")
    if (ow is None) != (nw is None):
        add("weather", "A work window appeared." if nw else "The work window is gone: no two-hour stretch is free of limits.")
    elif ow and nw and (abs(_h(ow["start"]) - _h(nw["start"])) >= WINDOW_SHIFT_H or abs(_h(ow["end"]) - _h(nw["end"])) >= WINDOW_SHIFT_H):
        add("weather", f"The best work window moved from {_clock(ow['start'])} to {_clock(ow['end'])} to {_clock(nw['start'])} to {_clock(nw['end'])}.")

    op, np_ = (old.get("heat") or {}).get("peak"), (new.get("heat") or {}).get("peak")
    if op and np_ and abs(np_["hi"] - op["hi"]) >= HEAT_INDEX_F:
        add("heat", f"The peak heat index {'rose' if np_['hi'] > op['hi'] else 'fell'} from {op['hi']:.0f} F to {np_['hi']:.0f} F.")
    elif op and np_ and op["band"] != np_["band"]:
        add("heat", f"The peak heat band changed from {op['band'].replace('_', ' ')} to {np_['band'].replace('_', ' ')}.")

    new_alerts, old_alerts = _alerts(new), _alerts(old)
    for e in sorted(new_alerts - old_alerts):
        add("weather", f"New alert: {e}.")
    for e in sorted(old_alerts - new_alerts):
        add("weather", f"Alert no longer active: {e}.")

    oh, nh = old.get("hazard_index") or {}, new.get("hazard_index") or {}
    if oh.get("status") == "ok" and nh.get("status") == "ok" and abs(nh["score"] - oh["score"]) >= HAZARD_INDEX:
        add("hazard_index", f"The hazard index {'rose' if nh['score'] > oh['score'] else 'fell'} from {oh['score']:.1f} to {nh['score']:.1f}.")

    om, nm = old.get("mud") or {}, new.get("mud") or {}
    if om.get("segment_counts") and nm.get("segment_counts"):
        total = max(sum(nm["segment_counts"].values()), 1)
        d = nm["segment_counts"]["hold"] - om["segment_counts"]["hold"]
        if abs(d) / total >= HOLD_SHARE:
            add("mud", f"Route segments at hold changed from {om['segment_counts']['hold']} to {nm['segment_counts']['hold']}.")

    ot, nt = (old.get("flood") or {}).get("tide") or {}, (new.get("flood") or {}).get("tide") or {}
    if ot.get("highest") and nt.get("highest") and abs(_minutes(nt["highest"]["t"]) - _minutes(ot["highest"]["t"])) >= HIGH_TIDE_MIN:
        add("tide", f"The highest tide moved from {ot['highest']['t'][11:16]} to {nt['highest']['t'][11:16]}.")

    orv, nrv = (old.get("flood") or {}).get("river") or {}, (new.get("flood") or {}).get("river") or {}
    if orv.get("flag") != nrv.get("flag") and (orv.get("flag") or nrv.get("flag")):
        add("river", f"The river flood level changed from {orv.get('flag') or 'unknown'} to {nrv.get('flag') or 'unknown'}.")

    oa, na = ((old.get("air") or {}).get("peak") or {}), ((new.get("air") or {}).get("peak") or {})
    if oa and na and oa["band"]["name"] != na["band"]["name"]:
        add("air", f"The peak air quality changed from {oa['band']['name'].lower()} to {na['band']['name'].lower()}.")

    return {"status": "ok", "since": old["meta"]["generated_at"], "since_kind": old["meta"]["kind"], "items": items}


def build(out_dir: Path, eia: str, for_date: str, new: dict) -> dict:
    old = load_previous(out_dir, eia, for_date)
    if old is None:
        return {"status": "not_applicable", "reason": "No earlier report exists for this date, so there is nothing to compare.", "items": []}
    if old["meta"]["generated_at"] == new["meta"]["generated_at"]:
        return {"status": "not_applicable", "reason": "The earlier report was built at the same time.", "items": []}
    return compare(old, new)
