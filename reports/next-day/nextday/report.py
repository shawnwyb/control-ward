"""Builds one next-day report per site and writes it under public/reports/<eia>/.

Layout:  public/reports/index.json                      one row per site, newest report
         public/reports/<eia>/latest.json              the newest report (a copy of <for_date>/report.json)
         public/reports/<eia>/<for_date>/report.json   the report; report.prev.json is the build before it
         public/reports/<eia>/<for_date>/*.geojson     map layers (mud routes, tide shading, levees)
Paths inside a report (routes_file, shading_file, map_file) are relative to public/reports/<eia>/."""
from __future__ import annotations

import json
import shutil
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from hazidx import localtime
from hazidx.sites import Site

from . import SCHEMA_VERSION, air, changes, forecast, hazard_index, heat_plan, levees, mud, paths, river, routing, tasks, tide, verdict, weather_plan, wildlife
from .fetch import Fetcher, SourceUnavailable

KNOWN_LIMITS = [
    "Storm chance is the forecast chance of rain. There is no lightning forecast. Live lightning stops work through the site alerts.",
    "Hourly values are the highest of seven forecast points within 20 km of the site.",
    "A forecast can change. Check the report again in the morning.",
]


@dataclass
class Context:
    fetcher: Fetcher
    as_of: datetime
    when: str = "tomorrow"                      # "tomorrow" (6 PM report) or "today" (5 AM refresh)
    hazard_rows: list[dict] | None = None
    fires: list[dict] | None = None
    gauges: list[dict] | None = None
    nld_client: Any = None
    mud_run: Path | None = None
    stations: dict | None = None
    out_dir: Path = paths.PUBLIC_REPORTS
    wildlife: bool = True
    routing: bool = True
    notes: list[str] = field(default_factory=list)


def report_date(as_of: datetime, tz: str, when: str) -> str:
    today = localtime.local_date(int(as_of.timestamp() * 1000), tz)
    return localtime.add_days(today, 1) if when == "tomorrow" else today


def _safe(section_fn, *args, **kw):
    try:
        return section_fn(*args, **kw)
    except SourceUnavailable as e:
        return {"status": "missing", "reason": str(e)}


def build_site(site: Site, ctx: Context) -> tuple[dict, dict[str, dict]]:
    f, tz = ctx.fetcher, site.timezone
    for_date = report_date(ctx.as_of, tz, ctx.when)
    as_ms = int(ctx.as_of.timestamp() * 1000)
    day0, day1 = forecast.day_bounds(for_date, tz)
    geo: dict[str, dict] = {}
    sections: dict[str, Any] = {}

    # ---- forecast: hourly, sun, NWS
    hours, plan_error = None, None
    try:
        hours = weather_plan.hourly_plan(forecast.fetch_hourly(f, site), tz, for_date)
        if not any(h["have_data"] for h in hours):
            hours, plan_error = None, f"The forecast does not cover {for_date}."
    except SourceUnavailable as e:
        plan_error = str(e)
    sun = _safe(forecast.fetch_sun, f, site)
    alerts = _safe(forecast.fetch_alerts, f, site, day0, day1)
    text = _safe(forecast.fetch_text, f, site, day0, day1)
    alerts_ok, text_ok = isinstance(alerts, list), isinstance(text, list)

    window = weather_plan.work_window(hours) if hours else None
    if hours:
        sections["weather"] = {
            "status": "ok", "hours": weather_plan.storm_strip(hours), "limits": weather_plan.LIMITS, "work_window": window,
            "blocked_runs": weather_plan.blocked_runs(hours), "alerts": alerts if alerts_ok else [],
            "alerts_status": "ok" if alerts_ok else "missing", "alerts_reason": None if alerts_ok else alerts["reason"],
            "text": text if text_ok else [], "text_reason": None if text_ok else text["reason"],
            "sun": sun.get(for_date) if isinstance(sun, dict) and "status" not in sun else None,
        }
        sections["heat"] = heat_plan.build(hours)
    else:
        sections["weather"] = {"status": "missing", "reason": plan_error or "No hourly forecast.", "alerts": alerts if alerts_ok else []}
        sections["heat"] = {"status": "missing", "reason": plan_error or "No hourly forecast."}

    # ---- model outputs and other sources
    sections["hazard_index"] = hazard_index.build(site.eia_plant_id, for_date, ctx.as_of, rows=ctx.hazard_rows)
    sections["mud"], mud_geo = mud.build(site.eia_plant_id, for_date, ctx.as_of, ctx.mud_run)
    if mud_geo:
        geo["mud_routes"] = mud_geo
    p_fire = sections["hazard_index"].get("probabilities", {}).get("fire")
    sections["air"] = air.build(f, site, for_date, ctx.fires, alerts if alerts_ok else [], p_fire)
    tide_sec, tide_geo = tide.build(f, site, for_date, ctx.stations)
    if tide_geo and tide_geo["features"]:
        geo["tide_shading"] = tide_geo
    lev_sec, lev_geo = levees.build(f, site, ctx.nld_client)
    if lev_geo:
        geo["levees"] = lev_geo
    river_sec = river.build(f, site, for_date, ctx.as_of, ctx.gauges)
    if ctx.routing:
        sections["routing"], road_graph = routing.build(f, site, for_date, sections["mud"], tide_geo, ctx.mud_run)
        if road_graph:
            geo["road_graph"] = road_graph
    else:
        sections["routing"] = {"status": "not_applicable", "reason": "Detour planning was turned off for this build."}
    sections["wildlife"], wild_geo = _wildlife(f, site, for_date, ctx)
    if wild_geo:
        geo["wildlife"] = wild_geo
    subs = {"river": river_sec, "levees": lev_sec, "tide": tide_sec}
    sections["flood"] = {"status": "ok" if any(s["status"] == "ok" for s in subs.values()) else "not_applicable", **subs}

    # ---- map file names are relative to public/reports/<eia>/
    rel = lambda name: f"{for_date}/{name}.geojson"
    if "mud_routes" in geo:
        sections["mud"]["routes_file"] = rel("mud_routes")
    else:
        sections["mud"].pop("routes_file", None)
    if "tide_shading" in geo:
        tide_sec["shading_file"] = rel("tide_shading")
    else:
        tide_sec.pop("shading_file", None)
    if "levees" in geo:
        lev_sec["map_file"] = rel("levees")
    else:
        lev_sec.pop("map_file", None)
    if "road_graph" in geo:
        sections["routing"]["graph_file"] = f"{for_date}/road_graph.json"
    else:
        sections["routing"].pop("graph_file", None)
    if "wildlife" in geo:
        sections["wildlife"]["map_file"] = rel("wildlife")
    else:
        sections["wildlife"].pop("map_file", None)

    # ---- hour table that the browser planners use
    hourly = []
    if hours:
        aqi = {h["hour"]: h["us_aqi"] for h in sections["air"].get("hours", [])}
        near = [(tide._local(w["start"].replace("T", " ")), tide._local(w["end"].replace("T", " "))) for w in tide_sec.get("near_high", [])] \
            if tide_sec.get("status") == "ok" else []
        from datetime import timedelta
        base = datetime.fromisoformat(for_date)
        for h in hours:
            t0 = base + timedelta(hours=h["hour"])
            band = next((x["band"] for x in sections["heat"].get("hours", []) if x["hour"] == h["hour"]), None)
            hourly.append({**{k: h[k] for k in ("hour", "safe", "blocked_by", "hi", "wbgt", "gust", "pop", "mm", "cape", "uv", "temp", "feels", "rh", "have_data")},
                           "band": band, "aqi": aqi.get(h["hour"]),
                           "tide_near_high": any(a < t0 + timedelta(hours=1) and t0 < b for a, b in near)})

    sections["verdict"] = verdict.evaluate(sections, window, [h for h in hourly if 6 <= h["hour"] < 19])

    # The report is the 6 PM report when it is for tomorrow and the morning refresh when it is for today. The clock time of
    # the run does not decide it: a build at 2 AM for tomorrow is still the evening report.
    kind = "evening" if ctx.when == "tomorrow" else "morning"
    report = {
        "schema_version": SCHEMA_VERSION,
        "meta": {
            "site": {"eia": site.eia_plant_id, "name": site.name, "latitude": site.latitude, "longitude": site.longitude,
                     "timezone": tz, "utility": site.utility, "plant_type": site.plant_type},
            "for_date": for_date, "kind": kind, "generated_at": ctx.as_of.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "snapshot": f.stamp, "sources": f.sources,
            "label": "Decision support from forecasts and models. It does not clear any task, route or crossing as safe.",
        },
        **sections, "hourly": hourly, "tasks": tasks.build(sections), "limits": KNOWN_LIMITS,
    }
    report["changes"] = changes.build(ctx.out_dir, site.eia_plant_id, for_date, report)
    report["gaps"] = gaps(sections)
    return report, geo


def _wildlife(f, site, for_date, ctx):
    if not ctx.wildlife:
        return {"status": "not_applicable", "reason": "The wildlife layer was turned off for this build."}, None
    return wildlife.build(f, site, for_date, ctx.as_of)


def gaps(sections: dict) -> list[dict]:
    out = []
    def visit(name: str, sec: Any) -> None:
        if not isinstance(sec, dict) or "status" not in sec:
            return
        if sec["status"] in ("missing", "stale", "not_applicable") and sec.get("reason"):
            out.append({"section": name, "status": sec["status"], "reason": sec["reason"]})
        if sec["status"] == "ok" and sec.get("alerts_status") == "missing":
            out.append({"section": f"{name}.alerts", "status": "missing", "reason": sec.get("alerts_reason")})
        if sec["status"] == "ok" and sec.get("text_reason"):
            out.append({"section": f"{name}.text", "status": "missing", "reason": sec["text_reason"]})
        if sec["status"] == "ok" and sec.get("forecast_note"):
            out.append({"section": name, "status": "ok", "reason": sec["forecast_note"]})
        if sec["status"] == "ok" and sec.get("inspection_rating_note"):
            out.append({"section": name, "status": "ok", "reason": sec["inspection_rating_note"]})
        if sec["status"] == "ok" and sec.get("shading_reason"):
            out.append({"section": name, "status": "ok", "reason": sec["shading_reason"]})
        if sec["status"] == "ok" and (sec.get("station") or {}).get("reviewed") is False:
            out.append({"section": name, "status": "ok", "reason": "The tide station was chosen by distance and has not been confirmed by a person."})
    for name, sec in sections.items():
        if name == "flood":
            for sub in ("river", "levees", "tide"):
                visit(f"flood.{sub}", sec.get(sub))
        else:
            visit(name, sec)
    return out


def write(report: dict, geo: dict[str, dict], out_dir: Path = paths.PUBLIC_REPORTS) -> Path:
    eia, day = report["meta"]["site"]["eia"], report["meta"]["for_date"]
    site_dir = Path(out_dir) / eia
    day_dir = site_dir / day
    day_dir.mkdir(parents=True, exist_ok=True)
    for stale in [*day_dir.glob("*.geojson"), day_dir / "road_graph.json"]:     # a layer that no longer applies must not linger
        stale.unlink(missing_ok=True)
    for name, g in geo.items():
        ext = "json" if name == "road_graph" else "geojson"
        (day_dir / f"{name}.{ext}").write_text(json.dumps(g, separators=(",", ":"), allow_nan=False), encoding="utf-8")
    current = day_dir / "report.json"
    if current.is_file():
        shutil.copyfile(current, day_dir / "report.prev.json")
    text = json.dumps(report, indent=1, allow_nan=False)
    current.write_text(text + "\n", encoding="utf-8")
    (site_dir / "latest.json").write_text(text + "\n", encoding="utf-8")
    update_index(report, Path(out_dir))
    return current


def update_index(report: dict, out_dir: Path) -> None:
    path = out_dir / "index.json"
    rows = {r["eia"]: r for r in (json.loads(path.read_text(encoding="utf-8"))["sites"] if path.is_file() else [])}
    m = report["meta"]
    rows[m["site"]["eia"]] = {"eia": m["site"]["eia"], "name": m["site"]["name"], "for_date": m["for_date"],
                              "generated_at": m["generated_at"], "verdict": report["verdict"]["level"]}
    path.write_text(json.dumps({"schema_version": SCHEMA_VERSION, "sites": sorted(rows.values(), key=lambda r: r["name"])}, indent=1) + "\n", encoding="utf-8")
