"""Wildlife sightings and a reported-sighting season, from iNaturalist (inaturalist.org, community observations).

Only research-grade records with public coordinates are used, as counts, dates and points. Photos are never used.
Records with obscured coordinates are counted but not drawn. Sightings show where people looked as well as where
animals are: a quiet month can mean few observers. 'No sightings' never means 'no animals'."""
from __future__ import annotations

import json
import time
from datetime import datetime, timedelta

from hazidx.sites import Site

from . import paths
from .fetch import Fetcher, SourceUnavailable

API = "https://api.inaturalist.org/v1"
RECENT_DAYS = 30
RECENT_KM = 10
SEASON_KM = 25
MAX_POINTS = 150
MIN_RECORDS_FOR_SEASON = 10     # fewer records over all months: say so instead of labelling
PEAK_RATIO, ACTIVE_RATIO = 1.5, 0.75   # this month's records against an average month
FILE = paths.DATA / "wildlife_taxa.json"
CREDIT = {"name": "iNaturalist community observations", "url": "https://www.inaturalist.org/",
          "note": "Research-grade records with public coordinates. No photos are used."}
CAVEATS = [
    "Sightings are reported by volunteers and are denser near towns and trails. A month with few sightings can mean few observers.",
    "No sightings does not mean no animals. Plan for wildlife on every wet or vegetated site.",
    "The species list is a starter list and needs confirming for the region.",
]


def load_groups() -> list[dict]:
    return json.loads(FILE.read_text(encoding="utf-8"))["groups"]


def season_label(months: dict[str, int], month: int) -> dict:
    counts = [int(months.get(str(m), 0)) for m in range(1, 13)]
    total = sum(counts)
    this = counts[month - 1]
    if total < MIN_RECORDS_FOR_SEASON:
        return {"label": "too few records", "month": month, "this_month": this, "year_total": total, "months": counts}
    ratio = this / (total / 12)
    # The words describe how many sightings people reported, not how active the animals are.
    label = "many reports" if ratio >= PEAK_RATIO else "typical number of reports" if ratio >= ACTIVE_RATIO else "few reports"
    return {"label": label, "month": month, "this_month": this, "year_total": total, "months": counts}


def resolve_taxa(f: Fetcher, groups: list[dict]) -> dict[str, list[int]]:
    """group id -> iNaturalist taxon ids, looked up by exact scientific name."""
    out: dict[str, list[int]] = {}
    for g in groups:
        ids = []
        for name in g["names"]:
            data = f.get_json(f"inat_taxon_{name}", f"{API}/taxa", {"q": name, "per_page": 5, "is_active": "true"})
            hit = next((t for t in data.get("results", []) if t["name"].lower() == name.lower()), None)
            if hit is None:
                raise SourceUnavailable(f"iNaturalist has no taxon named '{name}'")
            ids.append(int(hit["id"]))
        out[g["id"]] = ids
    return out


def _group_of(obs: dict, taxa: dict[str, list[int]]) -> str | None:
    t = obs.get("taxon") or {}
    lineage = set(t.get("ancestor_ids") or []) | {t.get("id")}
    return next((gid for gid, ids in taxa.items() if lineage & set(ids)), None)


def summarize(observations: list[dict], total: int, histograms: dict[str, dict], groups: list[dict],
              taxa: dict[str, list[int]], month: int) -> tuple[dict, dict | None]:
    counts = {g["id"]: 0 for g in groups}
    points = []
    obscured = 0
    for o in observations:
        gid = _group_of(o, taxa)
        if gid is None:
            continue
        counts[gid] += 1
        geo = o.get("geojson") or {}
        if o.get("obscured") or geo.get("type") != "Point":
            obscured += 1
            continue
        lon, lat = geo["coordinates"]
        t = o.get("taxon") or {}
        points.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": [round(lon, 4), round(lat, 4)]},
                       "properties": {"group": gid, "name": t.get("preferred_common_name") or t.get("name"),
                                      "date": o.get("observed_on"), "url": f"https://www.inaturalist.org/observations/{o['id']}"}})
    section_groups = [{"id": g["id"], "label": g["label"], "recent": counts[g["id"]],
                       "season": season_label(histograms.get(g["id"], {}), month)} for g in groups]
    section = {"status": "ok", "radius_km": RECENT_KM, "days": RECENT_DAYS, "season_radius_km": SEASON_KM,
               "recent_total": total, "recent_shown": len(points[:MAX_POINTS]), "obscured_not_drawn": obscured,
               "groups": section_groups, "map_file": "wildlife.geojson" if points else None,
               "caveats": CAVEATS, "source": CREDIT}
    geo = {"type": "FeatureCollection", "properties": {"source": CREDIT["name"]}, "features": points[:MAX_POINTS]} if points else None
    return section, geo


def build(f: Fetcher, site: Site, for_date: str, as_of: datetime, groups: list[dict] | None = None,
          pause: float = 0.6) -> tuple[dict, dict | None]:
    groups = groups or load_groups()
    try:
        taxa = resolve_taxa(f, groups)
        since = (as_of - timedelta(days=RECENT_DAYS)).strftime("%Y-%m-%d")
        every = ",".join(str(i) for ids in taxa.values() for i in ids)
        recent = f.get_json(f"inat_recent_{site.eia_plant_id}", f"{API}/observations", {
            "lat": site.latitude, "lng": site.longitude, "radius": RECENT_KM, "taxon_id": every, "quality_grade": "research",
            "d1": since, "per_page": 200, "order_by": "observed_on", "order": "desc"})
        hist = {}
        for g in groups:
            if not f.offline:
                time.sleep(pause)            # iNaturalist asks for no more than about one request a second
            data = f.get_json(f"inat_season_{site.eia_plant_id}_{g['id']}", f"{API}/observations/histogram", {
                "lat": site.latitude, "lng": site.longitude, "radius": SEASON_KM, "taxon_id": ",".join(map(str, taxa[g["id"]])),
                "quality_grade": "research", "date_field": "observed", "interval": "month_of_year"})
            hist[g["id"]] = (data.get("results") or {}).get("month_of_year", {})
    except SourceUnavailable as e:
        return {"status": "missing", "reason": str(e)}, None
    return summarize(recent.get("results", []), int(recent.get("total_results", 0)), hist, groups, taxa, int(for_date[5:7]))
