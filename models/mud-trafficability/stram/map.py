"""Self-contained Leaflet map of a forecast run: output/run_<stamp>/map.html.

Data is embedded so the pages open straight from disk: map.html plus map/<eia>.html per site, linked to each other.
Flags for every machine, pass count and horizon are packed into two strings per segment (flag digit, source letter).
"""
from __future__ import annotations

import csv
import json
from pathlib import Path

SOURCE_LETTERS = "snowu"  # stram, nrcs, nrcs_organic, wet_area, soil_unknown


DETAIL_HORIZONS = ("now", "d1")  # ground index, ranges and drivers in popups; other days show flag and source only


def _summaries(rows: list[dict]) -> dict:
    return {f"{r['equipment']}|{r['passes']}|{r['horizon']}": [
        float(r["score"]), float(r["score_p90"]), r["worst_flag"], float(r["inspect_acres"]), float(r["hold_acres"]),
        float(r["flagged_route_ft"]), r["wetness"], float(r["fia_ha"]), float(r["rain_in"]), r["plant_cell_flag"]]
        for r in rows}


def _index_entry(site: dict, rows: list[dict]) -> dict:
    first = rows[0] if rows else {}
    return {"eia": site["eia"], "name": site["name"], "lat": site["lat"], "lon": site["lon"],
            "horizons": [{k: h[k] for k in ("key", "label", "theta", "theta_min", "theta_max", "frozen")} for h in site["horizons"]],
            "route_ft": float(first.get("route_ft") or 0), "corridor_acres": float(first.get("corridor_acres") or 0),
            "summary": _summaries(rows)}


def _detail(run: dict, run_dir: Path, site: dict) -> dict:
    eqs = [e["key"] for e in run["equipment"]]
    hkeys = [h["key"] for h in site["horizons"]]
    keys = [f"{e}|{p}|{h}" for e in eqs for p in run["passes"] for h in hkeys]
    zkeys = [f"{p}|{h}" for p in run["passes"] for h in DETAIL_HORIZONS if h in hkeys]
    soils: list[str] = []
    segs = []
    for f in json.loads((run_dir / "segments" / f"{site['eia']}.geojson").read_text())["features"]:
        pr, r = f["properties"], f["properties"]["r"]
        soil = pr["soil"] or "unknown"
        if soil not in soils:
            soils.append(soil)
        segs.append([
            f["geometry"]["coordinates"], pr["id"], pr["highway"], pr["surface"], pr["surface_confidence"] == "tagged",
            pr["name"], pr["length_ft"], soils.index(soil), pr["organic"], pr["extrapolated"],
            "".join(str(r[k][0]) if k in r else "0" for k in keys),
            "".join(SOURCE_LETTERS[r[k][1]] if k in r else "s" for k in keys),
            [r.get(f"road_truck|{zk}", [None] * 7)[3:6] for zk in zkeys],
            [pr["d"].get(h) for h in DETAIL_HORIZONS],
        ])
    polys = json.loads((run_dir / "polygons" / f"{site['eia']}.geojson").read_text())["features"]
    return {"eia": site["eia"], "soil": site["soil"], "gauge": site["flood_gauge"], "keys": keys, "zkeys": zkeys,
            "soils": soils, "segments": segs, "polygons": polys}


def build_map(run_dir: Path) -> Path:
    """map.html (overview, opens on the highest-scoring site) plus map/<eia>.html for every site."""
    run = json.loads((run_dir / "run.json").read_text())
    with open(run_dir / "sites.csv", newline="") as f:
        rows = list(csv.DictReader(f))
    by_site: dict[str, list[dict]] = {}
    for r in rows:
        by_site.setdefault(r["eia"], []).append(r)
    common = {k: run[k] for k in ("generated_at", "model_version", "label", "equipment", "passes", "default_passes",
                                  "passes_note", "thresholds_in", "ground_band_in", "polygon_horizons", "corridor_ft",
                                  "agreement")}
    common["detail_horizons"] = list(DETAIL_HORIZONS)
    common["index"] = [_index_entry(s, by_site.get(s["eia"], [])) for s in run["sites"]]
    (run_dir / "map").mkdir(exist_ok=True)

    def page(site: dict, prefix: str) -> str:
        data = {**common, "site": _detail(run, run_dir, site), "link_prefix": prefix}
        return TEMPLATE.replace("/*DATA*/null", json.dumps(data, separators=(",", ":")).replace("</", "<\\/"))

    for site in run["sites"]:
        (run_dir / "map" / f"{site['eia']}.html").write_text(page(site, ""))
    key = f"road_truck|{run['default_passes']}|d1"
    top = max(run["sites"], key=lambda s: (_summaries(by_site.get(s["eia"], [])).get(key) or [0])[0])
    out = run_dir / "map.html"
    out.write_text(page(top, "map/"))
    return out


TEMPLATE = r"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Rutting Inspection Forecast</title>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css">
<script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js"></script>
<style>
:root{--bg:#f6f5f1;--panel:#ffffff;--ink:#1d2125;--muted:#5c636a;--line:#d9d6ce;--accent:#1f5f8b;
  --ok:#2f7d4f;--inspect:#d98a00;--hold:#b3261e;--banner:#fff4d6;--banner-ink:#5a4200;--chip:#eeece6}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#15181b;--panel:#1d2125;--ink:#e8e6e1;
  --muted:#a2a8ae;--line:#343a40;--accent:#7cb7e0;--ok:#5cb87f;--inspect:#f0a830;--hold:#ef6a5f;--banner:#3a3016;
  --banner-ink:#f3dc9a;--chip:#2a2f34}}
:root[data-theme="dark"]{--bg:#15181b;--panel:#1d2125;--ink:#e8e6e1;--muted:#a2a8ae;--line:#343a40;--accent:#7cb7e0;
  --ok:#5cb87f;--inspect:#f0a830;--hold:#ef6a5f;--banner:#3a3016;--banner-ink:#f3dc9a;--chip:#2a2f34}
*{box-sizing:border-box}
html,body{margin:0;height:100%;background:var(--bg);color:var(--ink);
  font:14px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
header{padding:12px 16px 8px;border-bottom:1px solid var(--line);background:var(--panel)}
h1{font-size:17px;margin:0 0 2px}
.sub{color:var(--muted);font-size:12px}
.banner{margin:8px 0 0;padding:8px 10px;border-radius:6px;background:var(--banner);color:var(--banner-ink);font-weight:600;font-size:13px}
.controls{display:flex;flex-wrap:wrap;gap:8px 12px;padding:10px 16px;background:var(--panel);border-bottom:1px solid var(--line)}
.controls label{display:flex;flex-direction:column;font-size:11px;color:var(--muted);gap:2px;min-width:0;flex:1 1 160px}
select{font:inherit;padding:6px 8px;border:1px solid var(--line);border-radius:6px;background:var(--bg);color:var(--ink);width:100%;min-width:0;text-overflow:ellipsis}
main{display:grid;grid-template-columns:minmax(0,1fr) 360px;height:calc(100% - 160px);min-height:420px}
#map{height:100%;min-height:420px}
aside{overflow:auto;min-width:0;padding:12px 16px;background:var(--panel);border-left:1px solid var(--line)}
aside h2{font-size:15px;margin:4px 0 6px}
aside h3{font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);margin:14px 0 6px}
.kv{display:grid;grid-template-columns:auto 1fr;gap:2px 10px;font-size:13px}
.kv dt{color:var(--muted)}.kv dd{margin:0;min-width:0;overflow-wrap:anywhere}
.flag{display:inline-block;padding:1px 8px;border-radius:10px;font-weight:600;font-size:12px;color:#fff}
.flag.ok{background:var(--ok)}.flag.inspect{background:var(--inspect);color:#1d1600}.flag.hold{background:var(--hold)}
ol.worst{padding-left:18px;margin:4px 0}ol.worst li{margin:2px 0;cursor:pointer}ol.worst li:hover{color:var(--accent)}
.legend{font-size:12px;display:grid;gap:4px}
.sw{display:inline-block;width:28px;height:0;border-top:4px solid;vertical-align:middle;margin-right:6px}
.note{font-size:12px;color:var(--muted)}
.chip{display:inline-block;background:var(--chip);border-radius:4px;padding:0 6px;margin:1px 2px 1px 0;font-size:12px}
.leaflet-popup-content{font-size:12.5px;line-height:1.4;min-width:240px}
.leaflet-popup-content table{border-collapse:collapse}.leaflet-popup-content td{padding:1px 6px 1px 0;vertical-align:top}
@media (max-width:820px){.controls label{flex:1 1 45%}main{grid-template-columns:minmax(0,1fr);height:auto}#map{height:60vh}aside{border-left:0;border-top:1px solid var(--line)}}
</style>
</head>
<body>
<header>
  <h1>Rutting inspection forecast: access routes near power plants</h1>
  <div class="sub" id="meta"></div>
  <div class="banner" id="banner"></div>
</header>
<div class="controls">
  <label>Site<select id="site"></select></label>
  <label>Equipment<select id="eq"></select></label>
  <label>Passes<select id="passes"></select></label>
  <label>Forecast<select id="hz"></select></label>
</div>
<main>
  <div id="map" role="region" aria-label="Map of route segments"></div>
  <aside id="panel" aria-live="polite"></aside>
</main>
<script>
const D = /*DATA*/null;
const FLAGS = ["ok","inspect","hold"];
const SRC = {s:"STRAM ground index",n:"NRCS trafficability rating",o:"organic soil (NRCS only)",w:"wet area (DTW < 1.6 ft)",u:"soil data unknown"};
const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const $ = id => document.getElementById(id);
const S = D.site, ME = D.index.find(x => x.eia === S.eia);
const eqLabel = Object.fromEntries(D.equipment.map(e => [e.key, e.label]));
const fmt = (v, d=1) => v === null || v === undefined || Number.isNaN(+v) ? "–" : (+v).toFixed(d);
function summ(entry, k){
  const a = entry.summary[`${k.eq}|${k.p}|${k.h}`];
  return a ? {score:a[0], p90:a[1], worst:a[2], ia:a[3], ha:a[4], fr:a[5], wet:a[6], fia:a[7], rain:a[8], pc:a[9]} : null;
}
$("banner").textContent = D.label;
$("meta").textContent = `Model ${D.model_version} · generated ${D.generated_at} · ${D.index.length} sites · inspect ≥ ${D.thresholds_in.inspect} in, hold ≥ ${D.thresholds_in.hold} in`;

// Selection: from the URL hash, so it survives moving between site pages.
const hash = Object.fromEntries(new URLSearchParams(location.hash.slice(1)));
for (const e of D.equipment) $("eq").add(new Option(e.label, e.key));
for (const p of D.passes) $("passes").add(new Option(p + (p === 1 ? " (one crossing)" : p === 2 ? " (in and out)" : " (convoy / day of shuttling)"), p));
for (const h of ME.horizons) $("hz").add(new Option(h.label, h.key));
$("eq").value = D.equipment.some(e => e.key === hash.eq) ? hash.eq : D.equipment[0].key;
$("passes").value = D.passes.includes(+hash.p) ? hash.p : D.default_passes;
$("hz").value = ME.horizons.some(h => h.key === hash.h) ? hash.h : (ME.horizons.find(h => h.key === "d1") || ME.horizons[0]).key;
const sel = () => ({eq: $("eq").value, p: +$("passes").value, h: $("hz").value});
const hashOf = k => `#eq=${k.eq}&p=${k.p}&h=${k.h}`;
const pageOf = eia => `${D.link_prefix}${eia}.html`;

const map = L.map("map", {preferCanvas: true});
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'}).addTo(map);
const markers = L.layerGroup().addTo(map), segLayer = L.layerGroup().addTo(map), polyLayer = L.layerGroup().addTo(map);
let segById = {};

function fillSites(){
  const k = sel(), score = e => (summ(e, k) || {score: 0}).score;
  const ranked = [...D.index].sort((a, b) => score(b) - score(a) || a.name.localeCompare(b.name));
  $("site").innerHTML = "";
  for (const e of ranked) { const m = summ(e, k); $("site").add(new Option(`${e.name} (${e.eia})${m ? " · " + m.worst + " · " + fmt(m.score) : ""}`, e.eia)); }
  $("site").value = S.eia;
}
function drawMarkers(){
  markers.clearLayers(); const k = sel();
  for (const e of D.index){
    const m = summ(e, k), f = m ? m.worst : "ok";
    L.circleMarker([e.lat, e.lon], {radius: e.eia === S.eia ? 9 : 7, color: e.eia === S.eia ? css("--ink") : "#fff", weight: 2,
      fillColor: css("--" + f), fillOpacity: 1})
      .bindTooltip(`${e.name}: ${f}${m ? " · score " + fmt(m.score) : ""}`)
      .on("click", () => { if (e.eia !== S.eia) location.href = pageOf(e.eia) + hashOf(sel()); })
      .addTo(markers);
  }
}
function popup(seg, k, i){
  const [, id, hw, sf, tagged, nm, len, soilIdx, org, ex, flags, srcs, zs, ds] = seg;
  const f = FLAGS[+flags[i]], zi = S.zkeys.indexOf(`${k.p}|${k.h}`), di = D.detail_horizons.indexOf(k.h);
  const z = zi >= 0 ? zs[zi] : null, d = di >= 0 ? ds[di] : null;
  let rows = `<tr><td>Flag</td><td><span class="flag ${f}">${f}</span> set by ${SRC[srcs[i]]}</td></tr>`;
  if (k.eq === "road_truck" && z && z[0] !== null) {
    rows += `<tr><td>Ground index</td><td>${fmt(z[0])} in (study forwarder, ${k.p} pass${k.p > 1 ? "es" : ""})</td></tr>
      <tr><td>Ground band</td><td>${fmt(Math.max(0, z[0] - D.ground_band_in))}–${fmt(z[0] + D.ground_band_in)} in (Eq 5 RMSE)</td></tr>
      <tr><td>Forecast range</td><td>${fmt(z[1])}–${fmt(z[2])} in (soil-moisture models)</td></tr>`;
  }
  if (d) rows += `<tr><td>Drivers</td><td>pore-filled moisture ${fmt(d[0], 0)}% · CI ${fmt(d[1], 0)} psi · NCI<sub>adj</sub> ${fmt(d[2], 2)} · DTW ${fmt(d[3])} ft</td></tr>`;
  if (!z && !d) rows += `<tr><td>Detail</td><td class="note">Ground index and drivers are shown for now and tomorrow.</td></tr>`;
  rows += `<tr><td>Route</td><td>${hw}${nm ? " · " + nm : ""} · surface ${sf || "untagged"}${tagged ? "" : " (assumed unpaved)"} · ${len} ft</td></tr>
    <tr><td>Soil</td><td>${S.soils[soilIdx]}${org ? " (organic)" : ""}</td></tr>
    <tr><td>Validity</td><td>${ex ? "Outside the study's calibration range. " : ""}Not locally validated.${k.p === 1 ? " " + D.passes_note : ""}</td></tr>`;
  return `<strong>Segment ${id}</strong><table>${rows}</table>`;
}
function drawSite(fit){
  segLayer.clearLayers(); polyLayer.clearLayers(); segById = {};
  const k = sel(), i = S.keys.indexOf(`${k.eq}|${k.p}|${k.h}`);
  if (k.p === D.default_passes && D.polygon_horizons.includes(k.h))
    for (const p of S.polygons) if (p.properties.equipment === k.eq && p.properties.horizon === k.h)
      L.geoJSON(p, {style: {color: css("--" + p.properties.flag), weight: 0, fillOpacity: .22}, interactive: false}).addTo(polyLayer);
  const bounds = L.latLngBounds([[ME.lat, ME.lon]]);
  for (const seg of S.segments){
    const f = i < 0 ? 0 : +seg[10][i], src = i < 0 ? "s" : seg[11][i];
    const ll = seg[0].map(c => [c[1], c[0]]); ll.forEach(p => bounds.extend(p));
    segById[seg[1]] = L.polyline(ll, {color: css("--" + FLAGS[f]), weight: f === 2 ? 5 : f === 1 ? 4 : 2.5, opacity: .95,
      dashArray: seg[9] ? "8 5" : (src === "n" || src === "o") ? "2 5" : null})
      .bindPopup(() => popup(seg, k, i)).addTo(segLayer);
  }
  if (fit) map.fitBounds(bounds.pad(0.05));
  panel(k, i);
}
function panel(k, i){
  const m = summ(ME, k) || {}, h = ME.horizons.find(x => x.key === k.h) || {}, zi = S.zkeys.indexOf(`${k.p}|${k.h}`);
  const worst = i < 0 ? [] : S.segments.map(s => ({s, f: +s[10][i], z: zi >= 0 && s[12][zi] ? s[12][zi][0] || 0 : 0}))
    .filter(x => x.f > 0).sort((a, b) => b.f - a.f || b.z - a.z).slice(0, 6);
  const g = S.gauge;
  $("panel").innerHTML = `
    <h2>${ME.name} <span class="note">EIA ${ME.eia}</span></h2>
    <div>${eqLabel[k.eq]} · ${k.p} pass${k.p > 1 ? "es" : ""} · ${h.label || k.h}</div>
    <h3>Summary</h3>
    <dl class="kv">
      <dt>Worst segment</dt><dd><span class="flag ${m.worst || "ok"}">${m.worst || "ok"}</span></dd>
      <dt>Site score</dt><dd>${fmt(m.score)} worst segment · ${fmt(m.p90)} at 90th pct of route length</dd>
      <dt>Flagged route</dt><dd>${Math.round(m.fr || 0).toLocaleString()} of ${Math.round(ME.route_ft).toLocaleString()} ft (${S.segments.length} segments)</dd>
      <dt>Corridor area</dt><dd>${fmt(m.ia)} ac inspect · ${fmt(m.ha)} ac hold, within ${D.corridor_ft} ft of routes (${fmt(ME.corridor_acres, 0)} ac)</dd>
      <dt>Wetness</dt><dd>${(m.wet || "").replace("_", " ")} · ${fmt(m.rain, 2)} in rain (72 h + day) · FIA ${m.fia} ha</dd>
      <dt>Soil moisture</dt><dd>θ ${fmt(h.theta, 3)} (models ${fmt(h.theta_min, 3)}–${fmt(h.theta_max, 3)}) m³/m³${h.frozen ? " · frozen" : ""}</dd>
      <dt>Plant cell</dt><dd>${m.pc || "–"}</dd>
    </dl>
    <h3>Inspect first</h3>
    ${worst.length ? `<ol class="worst">${worst.map(x => `<li data-id="${x.s[1]}" tabindex="0"><span class="flag ${FLAGS[x.f]}">${FLAGS[x.f]}</span> ${x.s[2]} ${x.s[1]}${x.z ? " · " + fmt(x.z) + " in" : ""}</li>`).join("")}</ol>` : `<div class="note">No flagged segments for this selection.</div>`}
    <h3>Legend</h3>
    <div class="legend">
      <div><span class="sw" style="border-color:var(--ok)"></span>ok</div>
      <div><span class="sw" style="border-color:var(--inspect)"></span>inspect (ground index ≥ ${D.thresholds_in.inspect} in, or an NRCS or wet-area rule)</div>
      <div><span class="sw" style="border-color:var(--hold)"></span>hold mobilization until inspected (≥ ${D.thresholds_in.hold} in, or NRCS poor)</div>
      <div><span class="sw" style="border-color:var(--muted);border-top-style:dashed"></span>dashed: outside the study's calibration range</div>
      <div><span class="sw" style="border-color:var(--muted);border-top-style:dotted"></span>dotted: flag set by an NRCS rating</div>
      <div class="note">Shaded areas (default pass count, now and tomorrow) are flagged ground within ${D.corridor_ft} ft of a route.</div>
    </div>
    <h3>Calibration</h3>
    <div class="note">Soil medians outside the study range: ${(S.soil.median_domain_reasons || []).map(r => `<span class="chip">${r}</span>`).join("") || "none"}.
      Organic share ${fmt(100 * S.soil.organic_frac, 0)}%. ${D.passes_note}</div>
    <div class="note" style="margin-top:6px">Road trucks share one flag: they are all NRCS MIL type 7, and STRAM runs for the study's own forwarder as a ground-condition index, not for a specific truck.</div>
    ${g ? `<h3>River context</h3><div class="note">Nearest NWS long-range point: ${g.name} (${g.lid}), ${g.distance_mi} mi away · minor-flood probability ${g.minor} (${g.interval}, issued ${g.date_produced.slice(0, 10)}). Not used in the score.</div>` : ""}
    <h3>Cross-check</h3>
    <div class="note">STRAM wet case vs NRCS rutting hazard across sites: Spearman ρ = ${D.agreement.spearman_rho ?? "n/a"} (n = ${D.agreement.n}). Neither is ground truth.</div>`;
  for (const li of $("panel").querySelectorAll("li[data-id]")) {
    const go = () => { const line = segById[li.dataset.id]; if (line) { map.fitBounds(line.getBounds().pad(2)); line.openPopup(); } };
    li.onclick = go; li.onkeydown = e => { if (e.key === "Enter") go(); };
  }
}
function render(fit){ history.replaceState(null, "", hashOf(sel())); fillSites(); drawMarkers(); drawSite(fit); }
$("site").onchange = () => { if ($("site").value !== S.eia) location.href = pageOf($("site").value) + hashOf(sel()); };
for (const id of ["eq", "passes", "hz"]) $(id).onchange = () => render(false);
render(true);
</script>
</body>
</html>
"""
