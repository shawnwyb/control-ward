import type { Reading, Site } from "./types.ts";
import { addDays, localDate, overnightWindow, zonedToUtc } from "./time.ts";
import { heatIndexF, wbgtF } from "./heat.ts";

export const HOURLY = [
  "temperature_2m",
  "relative_humidity_2m",
  "wind_speed_10m",
  "wind_gusts_10m",
  "shortwave_radiation",
  "precipitation",
  "precipitation_probability",
  "soil_moisture_0_to_1cm",
].join(",");

export function openMeteoUrl(
  sites: Pick<Site, "latitude" | "longitude">[],
): string {
  const q = new URLSearchParams({
    latitude: sites.map((s) => s.latitude.toFixed(4)).join(","),
    longitude: sites.map((s) => s.longitude.toFixed(4)).join(","),
    hourly: HOURLY,
    temperature_unit: "fahrenheit",
    wind_speed_unit: "mph",
    precipitation_unit: "mm",
    timezone: "UTC",
    past_days: "2",
    forecast_days: "3",
  });
  return `https://api.open-meteo.com/v1/forecast?${q}`;
}

export interface OpenMeteoLocation {
  hourly: Record<string, (number | null)[]> & { time: string[] };
}

const num = (v: number | null | undefined): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;
const round = (v: number, d = 1) => Math.round(v * 10 ** d) / 10 ** d;

// Live rows use the hour start as observed_at so reruns inside an hour overwrite instead of piling up.
// Forecast rows are one daily value per local day (max, or sum for rain) stamped at local noon.
export function buildReadings(
  site: Site,
  loc: OpenMeteoLocation,
  nowMs: number,
): Reading[] {
  const h = loc.hourly;
  const times = h.time.map((t) => Date.parse(`${t}:00Z`));
  let idx = -1;
  for (let i = 0; i < times.length; i++) if (times[i] <= nowMs) idx = i;
  if (idx < 0) return [];
  const observed = new Date(times[idx]).toISOString();
  const rows: Reading[] = [];
  const add = (
    hazard: Reading["hazard"],
    unit: string,
    value: number | null,
    forecastFor?: number,
  ) => {
    if (value === null || !Number.isFinite(value)) return;
    const row: Reading = {
      site_id: site.id,
      hazard,
      value: round(value, 2),
      unit,
      observed_at: observed,
      source: "open-meteo",
    };
    if (forecastFor !== undefined)
      row.forecast_for = new Date(forecastFor).toISOString();
    rows.push(row);
  };
  const at = (key: string, i: number) => num(h[key]?.[i]);
  const hourly = (i: number) => {
    const t = at("temperature_2m", i),
      rh = at("relative_humidity_2m", i);
    const wind = at("wind_speed_10m", i) ?? 0,
      sun = at("shortwave_radiation", i) ?? 0;
    return {
      temp: t,
      gust: at("wind_gusts_10m", i),
      pop: at("precipitation_probability", i),
      wbgt: t !== null && rh !== null ? wbgtF(t, rh, wind, sun) : null,
      hi: t !== null && rh !== null ? heatIndexF(t, rh) : null,
    };
  };

  const now = hourly(idx);
  add("heat", "wbgt_f", now.wbgt);
  add("heat", "heat_index_f", now.hi);
  add("weather", "temp_f", now.temp);
  add("weather", "wind_gust_mph", now.gust);
  add("weather", "precip_prob_pct", now.pop);
  add("soil", "soil_moisture_frac", at("soil_moisture_0_to_1cm", idx));

  const sum = (from: number, to: number) => {
    let total = 0,
      n = 0;
    for (let i = 0; i < times.length; i++) {
      const v = at("precipitation", i);
      if (times[i] >= from && times[i] < to && v !== null) {
        total += v;
        n++;
      }
    }
    return n ? total : null;
  };
  const night = overnightWindow(nowMs, site.timezone);
  add("flood", "precip_mm_overnight", sum(night.start, night.end + 1));
  add("flood", "precip_mm_24h", sum(nowMs - 24 * 3600_000, nowMs + 1));

  const today = localDate(nowMs, site.timezone);
  for (const offset of [1, 2]) {
    const day = addDays(today, offset);
    const from = zonedToUtc(day, 0, site.timezone),
      to = zonedToUtc(addDays(day, 1), 0, site.timezone);
    const noon = zonedToUtc(day, 12, site.timezone);
    const vals = {
      wbgt: [] as number[],
      hi: [] as number[],
      temp: [] as number[],
      gust: [] as number[],
      pop: [] as number[],
    };
    for (let i = 0; i < times.length; i++) {
      if (times[i] < from || times[i] >= to) continue;
      const r = hourly(i);
      if (r.wbgt !== null) vals.wbgt.push(r.wbgt);
      if (r.hi !== null) vals.hi.push(r.hi);
      if (r.temp !== null) vals.temp.push(r.temp);
      if (r.gust !== null) vals.gust.push(r.gust);
      if (r.pop !== null) vals.pop.push(r.pop);
    }
    const max = (a: number[]) => (a.length ? Math.max(...a) : null);
    add("heat", "wbgt_f", max(vals.wbgt), noon);
    add("heat", "heat_index_f", max(vals.hi), noon);
    add("weather", "temp_f", max(vals.temp), noon);
    add("weather", "wind_gust_mph", max(vals.gust), noon);
    add("weather", "precip_prob_pct", max(vals.pop), noon);
    add("flood", "precip_mm_24h", sum(from, to), noon);
  }
  return rows;
}

export function parseLocations(body: unknown): OpenMeteoLocation[] {
  return Array.isArray(body)
    ? (body as OpenMeteoLocation[])
    : [body as OpenMeteoLocation];
}
