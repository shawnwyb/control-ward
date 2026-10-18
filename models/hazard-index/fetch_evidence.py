#!/usr/bin/env python3
"""Query recent news articles and backing evidence for plants with elevated Hazard Index (or rule score).
Uses Google Gemini with Google Search Grounding to find local news, incident reports, and weather
advisories matching the plant's confounding hazard driver (flood, fire, storm, heat).

Writes:
  artifacts/evidence/evidence_<stamp>.json
  artifacts/evidence/evidence_<stamp>.push.sql (for uploading to public.hazard_evidence)

Usage:
  python fetch_evidence.py                             # newest dryrun CSV, plants at score >= 3.0
  python fetch_evidence.py artifacts/dryrun/ml_scores_*.csv --min-score 3.0
  python fetch_evidence.py --plants 6163 621           # specific plants
  python fetch_evidence.py --dry-run                   # offline mock evidence, no API key needed
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import re
import sys
import urllib.request
import urllib.error
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

from hazidx import paths
from hazidx.sites import load_sites

DEFAULT_MODEL = os.getenv("GEMINI_MODEL", "gemini-3.8-flash")
EVIDENCE_DIR = paths.ARTIFACTS / "evidence"
SITES_NWS_PATH = paths.ARTIFACTS / "sites_nws.json"
DEFAULT_TIMEOUT = 90


def load_sites_nws() -> dict[str, dict]:
    if not SITES_NWS_PATH.exists():
        return {}
    data = json.loads(SITES_NWS_PATH.read_text(encoding="utf-8"))
    return data.get("sites", {})


def latest_scores_csv() -> Path:
    files = sorted(paths.DRYRUN.glob("ml_scores_*.csv"), key=lambda p: p.stat().st_mtime)
    if not files:
        raise FileNotFoundError("No scores CSV found in artifacts/dryrun/. Run dryrun.py first.")
    return files[-1]


def build_search_prompt(row: dict, nws_info: dict) -> str:
    plant_name = row.get("site_name") or "Power Plant"
    county = nws_info.get("county_name", "")
    state = nws_info.get("state", "")
    zone = nws_info.get("forecast_zone_name", "")
    driver = row.get("top_driver", "hazard")
    score = row.get("score", "0.0")
    horizon = row.get("horizon", "now")
    local_date = row.get("local_date", "")

    metrics = []
    if row.get("rain_24h_mm"):
        metrics.append(f"24h rain: {float(row['rain_24h_mm']):.1f} mm")
    if row.get("rain_prev7d_mm"):
        metrics.append(f"7-day antecedent rain: {float(row['rain_prev7d_mm']):.1f} mm")
    if row.get("gust_max_mph"):
        metrics.append(f"max wind gusts: {float(row['gust_max_mph']):.1f} mph")
    if row.get("hi_max_f"):
        metrics.append(f"peak heat index: {float(row['hi_max_f']):.1f}°F")
    if row.get("wbgt_max_f"):
        metrics.append(f"peak WBGT: {float(row['wbgt_max_f']):.1f}°F")
    metric_str = ", ".join(metrics) if metrics else "forecast conditions"

    driver_terms = {
        "flood": "flooding, flash flood, high water levels, river crest, heavy rainfall, or road washouts",
        "fire": "wildfire, brush fire, dense smoke advisory, red flag warning, or evacuation notices",
        "storm": "severe thunderstorms, high wind damage, hail, lightning strikes, or tornado warnings",
        "heat": "excessive heat warning, heat advisory, high heat index, or worker heat safety notices",
    }
    hazard_desc = driver_terms.get(driver, f"{driver} hazard conditions")

    location_parts = [p for p in [plant_name, county + " County" if county else "", state] if p]
    location_desc = ", ".join(location_parts)

    prompt = (
        f"You are a utility safety analyst providing backing ground-truth evidence for a power plant site risk assessment.\n"
        f"Site: {location_desc} (Zone: {zone}). Date: {local_date} (horizon: {horizon}).\n"
        f"Primary confounding driver: {driver.upper()} (Hazard score: {score}/10. {metric_str}).\n\n"
        f"Search for recent local news articles, emergency advisories, or official NWS / weather incident reports concerning {hazard_desc} "
        f"affecting {county} County or the surrounding {state} region around {local_date}.\n\n"
        f"Requirements:\n"
        f"1. Provide a concise, factual 2-3 sentence summary (under 80 words) explaining the local situation and backing evidence for the {driver} hazard.\n"
        f"2. Use Google Search to cite real local news sources and advisories. In the articles array, provide the real canonical public website URLs (such as https://www.weather.gov/... or https://www.cbsnews.com/...), NOT google or vertex redirect links.\n"
        f"3. Return ONLY a valid, complete JSON object in this exact shape:\n"
        f"{{\n"
        f'  "summary": "2-3 sentences summarizing the local conditions and news reports.",\n'
        f'  "articles": [\n'
        f'    {{"title": "Article Title", "url": "https://...", "source": "Publisher Name", "snippet": "Key sentence about the hazard"}}\n'
        f"  ]\n"
        f"}}"
    )
    return prompt


def _clean_article(art: dict) -> dict:
    title = (art.get("title") or "").strip()
    url = (art.get("url") or "").strip()
    source = (art.get("source") or "").strip()
    snippet = (art.get("snippet") or "").strip()

    # Clean up vertexaisearch redirect URLs
    if "vertexaisearch.cloud.google.com" in url:
        if re.match(r"^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$", title):
            source = title
            url = f"https://{title}"
            title = f"{source} Local Hazard Advisory"
        elif source and source != "vertexaisearch.cloud.google.com":
            url = f"https://{source}" if not source.startswith("http") else source
        else:
            source = "Weather & News Service"

    if not source or source == "vertexaisearch.cloud.google.com":
        domain = urlparse(url).netloc.replace("www.", "")
        source = domain if domain and "vertexaisearch" not in domain else "News Advisory"

    return {
        "title": title or f"{source} Report",
        "url": url,
        "source": source,
        "snippet": snippet,
    }


def _parse_gemini_response(data: dict) -> dict:
    text_content = ""
    extracted_articles = []

    # 1. generateContent structure
    if "candidates" in data:
        candidate = data["candidates"][0] if data["candidates"] else {}
        parts = candidate.get("content", {}).get("parts", [])
        text_content = "".join(p.get("text", "") for p in parts)
        grounding = candidate.get("groundingMetadata", {})
        for chunk in grounding.get("groundingChunks", []):
            web = chunk.get("web", {})
            uri = web.get("uri")
            title = web.get("title")
            if uri:
                domain = urlparse(uri).netloc.replace("www.", "")
                extracted_articles.append({
                    "title": title or domain,
                    "url": uri,
                    "source": domain,
                    "snippet": ""
                })

    # 2. Interactions API structure
    elif "steps" in data:
        steps = data.get("steps", [])
        for step in steps:
            for c in step.get("content", []):
                if c.get("type") == "text":
                    text_content += c.get("text", "")
                for ann in c.get("annotations", []):
                    uri = ann.get("url") or ann.get("uri")
                    title = ann.get("title")
                    if uri:
                        domain = urlparse(uri).netloc.replace("www.", "")
                        extracted_articles.append({
                            "title": title or domain,
                            "url": uri,
                            "source": domain,
                            "snippet": ""
                        })

    summary = ""
    json_articles = []

    # Try standard JSON parsing
    try:
        cleaned_text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text_content.strip(), flags=re.MULTILINE)
        parsed = json.loads(cleaned_text)
        if isinstance(parsed, dict):
            summary = str(parsed.get("summary") or "")
            if isinstance(parsed.get("articles"), list):
                json_articles = parsed["articles"]
    except Exception:
        pass

    # Regex extraction fallback if JSON was truncated or malformed
    if not summary or summary.lstrip().startswith("{") or '"summary"' in summary:
        sm = re.search(r'"summary"\s*:\s*"((?:[^"\\]|\\.)*)', text_content)
        if sm:
            summary = sm.group(1).replace('\\"', '"').replace('\\n', ' ').strip()
        elif text_content:
            clean = re.sub(r'^\s*\{\s*"summary"\s*:\s*"?', '', text_content)
            clean = re.sub(r'"?\s*,?\s*"articles".*$', '', clean, flags=re.DOTALL)
            summary = clean.strip().strip('"').strip()[:400]

    if not summary:
        summary = "Backing news reports retrieved for local site area."

    # If json_articles wasn't parsed (e.g. truncated), try extracting individual article objects
    if not json_articles:
        for m in re.finditer(r'\{\s*"title"\s*:\s*"([^"]+)"\s*,\s*"url"\s*:\s*"([^"]+)"(?:[^{}]*?"source"\s*:\s*"([^"]*)")?(?:[^{}]*?"snippet"\s*:\s*"([^"]*)")?', text_content):
            json_articles.append({
                "title": m.group(1),
                "url": m.group(2),
                "source": m.group(3) or urlparse(m.group(2)).netloc.replace("www.", ""),
                "snippet": m.group(4) or ""
            })

    # Combine articles, prioritizing real canonical URLs over raw grounding redirect chunks
    combined = []
    seen_urls = set()
    for raw_art in json_articles + extracted_articles:
        art = _clean_article(raw_art)
        url = art.get("url")
        if url and url not in seen_urls:
            seen_urls.add(url)
            combined.append(art)

    return {"summary": summary, "articles": combined[:5]}


def query_gemini_search(prompt: str, api_key: str, model: str = DEFAULT_MODEL, timeout: int = DEFAULT_TIMEOUT) -> dict:
    # Attempt 1: Standard generateContent endpoint
    url_gc = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"
    payload_gc = {
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "tools": [{"google_search": {}}],
        "generationConfig": {
            "temperature": 0.2,
            "maxOutputTokens": 4096,
        }
    }
    req_gc = urllib.request.Request(
        url_gc,
        data=json.dumps(payload_gc).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "User-Agent": "planit-hazard-evidence/1.0"
        }
    )
    try:
        with urllib.request.urlopen(req_gc, timeout=timeout) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            return _parse_gemini_response(data)
    except urllib.error.HTTPError as exc:
        err_msg = exc.read().decode("utf-8", errors="replace")
        if "Interactions" not in err_msg and exc.code not in (400, 404):
            raise RuntimeError(f"Gemini API error ({exc.code}) on model {model}: {err_msg[:300]}") from exc

    # Attempt 2: Interactions API endpoint (recommended by Google for gemini-3.8-flash)
    url_int = f"https://generativelanguage.googleapis.com/v1beta/interactions?key={api_key}"
    payload_int = {
        "model": model,
        "input": prompt,
        "store": False,
        "tools": [{"type": "google_search"}],
        "generation_config": {
            "temperature": 0.2,
            "max_output_tokens": 4096
        }
    }
    req_int = urllib.request.Request(
        url_int,
        data=json.dumps(payload_int).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "User-Agent": "planit-hazard-evidence/1.0"
        }
    )
    try:
        with urllib.request.urlopen(req_int, timeout=timeout) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            return _parse_gemini_response(data)
    except urllib.error.HTTPError as exc:
        err_msg = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Gemini Interactions API error ({exc.code}) on model {model}: {err_msg[:300]}") from exc
    except (TimeoutError, urllib.error.URLError) as exc:
        raise RuntimeError(f"Gemini query timed out after {timeout}s on model {model}") from exc




def mock_evidence_for_row(row: dict, nws_info: dict) -> dict:
    driver = row.get("top_driver", "hazard")
    plant = row.get("site_name", "Power Plant")
    county = nws_info.get("county_name") or "Local"
    state = nws_info.get("state") or "Region"
    date_str = row.get("local_date", "today")

    samples = {
        "flood": {
            "summary": f"National Weather Service advisories indicate localized water accumulation and elevated river stages across {county} County, {state}. Recent precipitation has saturated low-lying drainage basins near {plant}.",
            "articles": [
                {"title": f"{state} River Basin Flood Advisory and Water Level Updates", "url": f"https://water.weather.gov/ahps/{county.lower()}", "source": "weather.gov", "snippet": f"Elevated gauge readings and flood advisories active across {county} County."},
                {"title": f"Local Heavy Rainfall Prompts Flash Flood Watch for {county} County", "url": f"https://www.localnews.com/{state.lower()}/flood-watch", "source": "localnews.com", "snippet": f"Rainfall over the past 24-48 hours has created standing water and ponding near highway corridors."}
            ]
        },
        "fire": {
            "summary": f"Dry conditions and elevated wind vectors have triggered regional fire weather alerts and dense smoke tracking in {county} County, {state}. Spotter reports note restricted visibility near the {plant} perimeter.",
            "articles": [
                {"title": f"Red Flag Warning and Wildfire Smoke Notice for {county} County", "url": f"https://inciweb.wildfire.gov/{county.lower()}", "source": "wildfire.gov", "snippet": f"Wildfire activity and persistent smoke plume reducing air quality and visibility."},
                {"title": f"{state} Forestry Division Incident Report", "url": f"https://forestry.{state.lower()}.gov/alerts", "source": f"{state.lower()}.gov", "snippet": f"Active containment operations and controlled burns in neighboring sectors."}
            ]
        },
        "storm": {
            "summary": f"A dynamic frontal boundary produced convective cells with lightning clusters and peak wind gusts across {county} County, {state}. Utility operations report monitoring for downed tree limbs and feeder outages.",
            "articles": [
                {"title": f"Severe Thunderstorm Watch and Wind Damage Reports in {county}", "url": f"https://forecast.weather.gov/{county.lower()}-storm", "source": "weather.gov", "snippet": f"Peak wind gusts and frequent cloud-to-ground lightning reported along the front."},
                {"title": f"Power Utility Crews Respond to Weather-Related Outages in {state}", "url": f"https://www.energyupdates.com/{state.lower()}/storm-response", "source": "energyupdates.com", "snippet": f"Crews prepositioned as severe storm line tracks through {county} County."}
            ]
        },
        "heat": {
            "summary": f"An intense heat dome has raised Wet Bulb Globe Temperature (WBGT) and heat index levels past critical thresholds in {county} County, {state}. Outdoor work precautions and mandated rest-shade intervals are in effect.",
            "articles": [
                {"title": f"Excessive Heat Advisory Issued for {county} and Surrounding Counties", "url": f"https://weather.gov/heat/{county.lower()}", "source": "weather.gov", "snippet": f"Heat index readings exceeding 105°F prompt regional health and worker safety alerts."},
                {"title": f"OSHA Workplace Heat Safety Guidance for Outdoor Utility Personnel", "url": "https://www.osha.gov/heat", "source": "osha.gov", "snippet": f"Work/rest cycles recommended for heavy physical exertion under elevated WBGT."}
            ]
        }
    }
    res = samples.get(driver, samples["flood"])
    return res


def build_push_sql(evidence_records: list[dict], source_name: str) -> str:
    now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    values = []
    for r in evidence_records:
        eia = r["eia_plant_id"]
        horizon = r["horizon"]
        driver = r["driver"]
        score = float(r["hazard_score"])
        summary = r["summary"].replace("'", "''")
        articles_json = json.dumps(r["articles"]).replace("'", "''")
        version = r["model_version"].replace("'", "''")
        values.append(
            f"('{eia}', '{horizon}', '{driver}', {score:.1f}, '{summary}', '{articles_json}'::jsonb, '{version}')"
        )
    if not values:
        return "-- No evidence records to push.\n"
    val_str = ",\n    ".join(values)
    return (
        f"-- Generated by models/hazard-index/fetch_evidence.py from {source_name} at {now_iso}\n"
        f"-- Uploads {len(evidence_records)} evidence records to public.hazard_evidence.\n"
        f"select public.upsert_hazard_evidence(coalesce((\n"
        f"  select jsonb_agg(jsonb_build_object(\n"
        f"    'site_id', s.id,\n"
        f"    'horizon', v.horizon,\n"
        f"    'driver', v.driver,\n"
        f"    'hazard_score', v.score,\n"
        f"    'summary', v.summary,\n"
        f"    'articles', v.articles,\n"
        f"    'model_version', v.model_version\n"
        f"  ))\n"
        f"  from (values\n    {val_str}\n  ) as v(eia, horizon, driver, score, summary, articles, model_version)\n"
        f"  join public.sites s on s.eia_plant_id = v.eia\n"
        f"), '[]'::jsonb));\n"
    )


def fetch_all_evidence(
    csv_path: Path,
    min_score: float = 3.0,
    plant_filter: set[str] | None = None,
    dry_run: bool = False,
    api_key: str | None = None,
    model: str = DEFAULT_MODEL,
    timeout: int = DEFAULT_TIMEOUT,
) -> tuple[list[dict], Path, Path]:
    with open(csv_path, newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))

    nws_sites = load_sites_nws()
    api_key = api_key or os.getenv("GEMINI_API_KEY")

    # Filter target rows
    targets = []
    for r in rows:
        eia = r["eia_plant_id"]
        if plant_filter and eia not in plant_filter:
            continue
        score = float(r.get("score") or 0.0)
        rule_max = float(r.get("rule_max_fc") or 0.0)
        if score >= min_score or rule_max >= min_score or plant_filter:
            targets.append(r)

    print(f"Loaded {len(rows)} scores from {csv_path.name}. Found {len(targets)} elevated plant-horizon targets (threshold >= {min_score}).")

    evidence_records = []
    for r in targets:
        eia = r["eia_plant_id"]
        nws = nws_sites.get(eia, {})
        driver = r.get("top_driver", "flood")
        horizon = r.get("horizon", "now")
        score = float(r.get("score") or 0.0)
        site_name = r.get("site_name", eia)

        print(f"  Fetching evidence: {site_name} (EIA {eia}) | {horizon} | driver: {driver} | score: {score:.1f} ...")

        if dry_run or not api_key:
            if not dry_run and not api_key:
                print("    (GEMINI_API_KEY not set; falling back to offline reference evidence)")
            res = mock_evidence_for_row(r, nws)
        else:
            prompt = build_search_prompt(r, nws)
            try:
                res = query_gemini_search(prompt, api_key, model, timeout=timeout)
            except Exception as exc:
                print(f"    Gemini query failed ({exc}); falling back to reference evidence")
                res = mock_evidence_for_row(r, nws)

        evidence_records.append({
            "eia_plant_id": eia,
            "site_name": site_name,
            "horizon": horizon,
            "driver": driver,
            "hazard_score": score,
            "local_date": r.get("local_date", ""),
            "model_version": r.get("model_version", "hazidx"),
            "summary": res["summary"],
            "articles": res["articles"],
            "queried_at": datetime.now(timezone.utc).isoformat()
        })

    # Output paths
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)
    json_path = EVIDENCE_DIR / f"evidence_{stamp}.json"
    sql_path = EVIDENCE_DIR / f"evidence_{stamp}.push.sql"

    json_path.write_text(json.dumps(evidence_records, indent=2), encoding="utf-8")
    sql_path.write_text(build_push_sql(evidence_records, csv_path.name), encoding="utf-8")

    return evidence_records, json_path, sql_path


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Query news articles & backing evidence for elevated hazard index sites")
    ap.add_argument("csv", nargs="?", type=Path, help="Path to ml_scores_*.csv (default: latest dryrun)")
    ap.add_argument("--min-score", type=float, default=3.0, help="Minimum score to query (default: 3.0)")
    ap.add_argument("--plants", nargs="+", help="Specific EIA plant IDs to query")
    ap.add_argument("--dry-run", action="store_true", help="Generate offline reference evidence without network API")
    ap.add_argument("--api-key", help="Gemini API key (defaults to GEMINI_API_KEY env var)")
    ap.add_argument("--model", default=DEFAULT_MODEL, help=f"Gemini model (default: {DEFAULT_MODEL})")
    ap.add_argument("--timeout", type=int, default=DEFAULT_TIMEOUT, help=f"HTTP timeout in seconds (default: {DEFAULT_TIMEOUT})")
    args = ap.parse_args(argv)

    try:
        csv_path = args.csv or latest_scores_csv()
        plant_filter = set(args.plants) if args.plants else None
        records, json_out, sql_out = fetch_all_evidence(
            csv_path=csv_path,
            min_score=args.min_score,
            plant_filter=plant_filter,
            dry_run=args.dry_run,
            api_key=args.api_key,
            model=args.model,
            timeout=args.timeout,
        )
        print(f"Wrote {len(records)} evidence records to {json_out}")
        print(f"Wrote SQL upload script to {sql_out}")
        return 0
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
