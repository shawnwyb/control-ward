"""Task planner data. The generator writes the task profiles and the site-wide flags. The browser applies the
profile a manager picks to the hourly table, so the manager sees safe hours for each task without a new run.
Profiles live in data/task_profiles.json. Limits that do not come from the alert rules are marked
needs_confirmation: they are defaults until someone checks them against the equipment manual or the site safety plan."""
from __future__ import annotations

import json

from . import paths

FILE = paths.DATA / "task_profiles.json"
HOUR_FACTORS = {"wbgt", "hi", "gust", "pop", "mm", "cape", "aqi", "tide_near_high"}


def load_profiles() -> list[dict]:
    profiles = json.loads(FILE.read_text(encoding="utf-8"))["profiles"]
    for p in profiles:
        for b in p["blockers"]:
            if b["kind"] == "hour" and b["factor"] not in HOUR_FACTORS:
                raise ValueError(f"{p['id']}/{b['id']}: unknown factor {b['factor']!r}")
            if b["kind"] not in ("hour", "site"):
                raise ValueError(f"{p['id']}/{b['id']}: unknown kind {b['kind']!r}")
    return profiles


def site_flags(sections: dict) -> dict:
    mud = sections.get("mud") or {}
    eq = next((e for e in mud.get("equipment", []) if e["key"] == mud.get("default_equipment")), None)
    river = (sections.get("flood") or {}).get("river") or {}
    tide = (sections.get("flood") or {}).get("tide") or {}
    return {"mud": eq["worst_flag"] if eq and mud.get("status") in ("ok", "stale") else None,
            "river": river.get("flag") if river.get("status") == "ok" else None,
            "tide_shading": bool(tide.get("shading_file"))}


def build(sections: dict) -> dict:
    return {"status": "ok", "profiles": load_profiles(), "site_flags": site_flags(sections),
            "note": "Limits marked 'confirm' are defaults. Replace them with the limit in your equipment manual or site safety plan."}
