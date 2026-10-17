// Builds supabase/seed-sites.sql from the EIA-860M workbook.
// Usage: node scripts/load-sites.mjs <path to EIA-860M .xlsx> [site count]
// Then apply: supabase db query --linked -f supabase/seed-sites.sql
import { writeFileSync } from "node:fs";
import ExcelJS from "exceljs";
import tzlookup from "tz-lookup";

const [file, countArg] = process.argv.slice(2);
if (!file)
  throw new Error("Usage: node scripts/load-sites.mjs <eia860m.xlsx> [count]");
const target = Number(countArg ?? 60);

// States with a quota, chosen to cover the brief: Mississippi river, Gulf and Florida (flood,
// lightning, heat), Southwest heat, western wildfire and a spread of the interior.
const quota = {
  FL: 5,
  LA: 4,
  MS: 2,
  AR: 2,
  TN: 2,
  KY: 2,
  MO: 3,
  IL: 3,
  IA: 2,
  MN: 2,
  WI: 2,
  TX: 4,
  OK: 1,
  KS: 1,
  NE: 1,
  ND: 1,
  AL: 2,
  GA: 2,
  SC: 2,
  NC: 2,
  VA: 1,
  OH: 2,
  IN: 2,
  PA: 2,
  NY: 2,
  CA: 3,
  AZ: 2,
  NV: 1,
  NM: 1,
  CO: 1,
  WA: 1,
  OR: 1,
  MT: 1,
  WY: 1,
  ID: 1,
  UT: 1,
  MI: 2,
  MD: 1,
  NJ: 1,
  WV: 1,
};

function cell(row, i) {
  const v = row.values[i + 1];
  return typeof v === "object" && v !== null ? (v.result ?? v.text ?? null) : v;
}

const plants = new Map();
const reader = new ExcelJS.stream.xlsx.WorkbookReader(file, {});
for await (const sheet of reader) {
  if (sheet.name !== "Operating") continue;
  let header;
  let n = 0;
  for await (const row of sheet) {
    n++;
    if (n === 3) {
      header = Object.fromEntries(row.values.slice(1).map((h, i) => [h, i]));
      continue;
    }
    if (n < 4 || !header) continue;
    const status = String(cell(row, header["Status"]) ?? "");
    if (!status.startsWith("(OP)")) continue;
    const lat = Number(cell(row, header["Latitude"]));
    const lon = Number(cell(row, header["Longitude"]));
    const mw = Number(cell(row, header["Nameplate Capacity (MW)"]));
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(mw))
      continue;
    const id = String(cell(row, header["Plant ID"]));
    const tech = String(cell(row, header["Technology"]) ?? "");
    const p = plants.get(id) ?? {
      id,
      name: cell(row, header["Plant Name"]),
      state: cell(row, header["Plant State"]),
      county: cell(row, header["County"]),
      utility: cell(row, header["Entity Name"]),
      lat,
      lon,
      mw: 0,
      techs: new Map(),
    };
    p.mw += mw;
    p.techs.set(tech, (p.techs.get(tech) ?? 0) + mw);
    plants.set(id, p);
  }
}

const byState = new Map();
for (const p of plants.values()) {
  if (p.state in quota && p.mw >= 100) {
    if (!byState.has(p.state)) byState.set(p.state, []);
    byState.get(p.state).push(p);
  }
}
const chosen = [];
for (const [state, list] of byState) {
  list.sort((a, b) => b.mw - a.mw);
  chosen.push(...list.slice(0, quota[state]));
}
chosen.sort((a, b) => b.mw - a.mw);
chosen.splice(Math.max(target, 50));
console.log(
  `Selected ${chosen.length} plants from ${plants.size} operating plants`,
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function getJson(url) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (res.ok) return await res.json();
    } catch {}
    await sleep(500 * (attempt + 1));
  }
  return null;
}
async function getText(url) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (res.ok) return await res.text();
    } catch {}
    await sleep(500 * (attempt + 1));
  }
  return null;
}
function distanceM(lat1, lon1, lat2, lon2) {
  const r = 6371000,
    rad = Math.PI / 180;
  const a =
    Math.sin(((lat2 - lat1) * rad) / 2) ** 2 +
    Math.cos(lat1 * rad) *
      Math.cos(lat2 * rad) *
      Math.sin(((lon2 - lon1) * rad) / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(a));
}
async function floodZone(p) {
  const url =
    "https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28/query?" +
    new URLSearchParams({
      geometry: `${p.lon},${p.lat}`,
      geometryType: "esriGeometryPoint",
      inSR: "4326",
      spatialRel: "esriSpatialRelIntersects",
      outFields: "FLD_ZONE",
      returnGeometry: "false",
      f: "json",
    });
  const data = await getJson(url);
  return data?.features?.[0]?.attributes?.FLD_ZONE ?? null;
}
async function nearestGauge(p) {
  const d = 0.3;
  const url =
    "https://waterservices.usgs.gov/nwis/site/?" +
    new URLSearchParams({
      format: "rdb",
      bBox: [p.lon - d, p.lat - d, p.lon + d, p.lat + d]
        .map((x) => x.toFixed(4))
        .join(","),
      siteType: "ST",
      siteStatus: "active",
      hasDataTypeCd: "iv",
      parameterCd: "00065",
    });
  const text = await getText(url);
  if (!text) return null;
  let best = null;
  for (const line of text.split("\n")) {
    if (line.startsWith("#") || !line.startsWith("USGS")) continue;
    const f = line.split("\t");
    const dist = distanceM(p.lat, p.lon, Number(f[4]), Number(f[5]));
    if (!best || dist < best.dist) best = { id: f[1], dist };
  }
  return best;
}

// Modest concurrency keeps FEMA and USGS happy.
const queue = [...chosen];
await Promise.all(
  Array.from({ length: 4 }, async () => {
    while (queue.length) {
      const p = queue.shift();
      p.tz = tzlookup(p.lat, p.lon);
      [p.flood, p.gauge] = await Promise.all([floodZone(p), nearestGauge(p)]);
      p.tech = [...p.techs.entries()].sort((a, b) => b[1] - a[1])[0][0];
      console.log(
        `${p.state} ${p.name}: zone=${p.flood ?? "?"} gauge=${p.gauge ? `${p.gauge.id} ${Math.round(p.gauge.dist)}m` : "none"}`,
      );
    }
  }),
);

const q = (v) =>
  v === null || v === undefined ? "null" : `'${String(v).replace(/'/g, "''")}'`;
const rows = chosen.map(
  (p) =>
    `  (${q(p.name)},${p.lat},${p.lon},${q(p.tz)},${q(p.id)},${q(p.utility)},${q(p.tech)},${q(p.flood)},` +
    `${p.gauge ? Math.round(p.gauge.dist) : "null"},${q(p.gauge?.id)},${p.gauge ? Math.round(p.gauge.dist) : "null"})`,
);
const sql = `-- Generated by scripts/load-sites.mjs from EIA-860M. Real plants, no demo identities.
insert into public.sites(name,latitude,longitude,timezone,eia_plant_id,utility,plant_type,fema_flood_zone,river_distance_m,usgs_gauge_id,usgs_gauge_distance_m) values
${rows.join(",\n")}
on conflict (eia_plant_id) do update set name=excluded.name,latitude=excluded.latitude,longitude=excluded.longitude,
  timezone=excluded.timezone,utility=excluded.utility,plant_type=excluded.plant_type,
  fema_flood_zone=excluded.fema_flood_zone,river_distance_m=excluded.river_distance_m,
  usgs_gauge_id=excluded.usgs_gauge_id,usgs_gauge_distance_m=excluded.usgs_gauge_distance_m;
`;
writeFileSync("supabase/seed-sites.sql", sql);
console.log("Wrote supabase/seed-sites.sql");
