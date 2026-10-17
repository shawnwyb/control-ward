import type { Site } from "../../../lib/types";

/*
 * Hourly forecast on a coarse grid around a site, from Open-Meteo
 * (open-meteo.com, CC BY 4.0, free for non-commercial use, no key).
 * One request returns the whole grid. It is cached for an hour so a busy
 * crew doesn't burn through the free daily allowance.
 */
const ENDPOINT = "https://api.open-meteo.com/v1/forecast";
const CACHE_TTL_MS = 60 * 60 * 1000;
const CACHE_KEY = "planit.forecast.v1.";
export const FORECAST_HOURS = 13; // this hour plus the next 12

const LON_HALF = 1.6;
const LON_STEP = 0.4;
const LAT_HALF = 1.05;
const LAT_STEP = 0.35;

export const OPEN_METEO_CREDIT = "Weather data by Open-Meteo.com";
export const OPEN_METEO_URL = "https://open-meteo.com/";

/** All arrays are indexed [hour][lat row][lon column], flattened. */
export type ForecastGrid = {
  /** Unix seconds, hourly, ascending. */
  times: number[];
  /** Ascending axes (west→east, south→north). */
  lons: number[];
  lats: number[];
  /** °F */
  temperature: Float32Array;
  /** inches per hour */
  precipitation: Float32Array;
  /** m/s, eastward and northward */
  windU: Float32Array;
  windV: Float32Array;
};

type Bounds = { west: number; south: number; east: number; north: number };

function axis(center: number, half: number, step: number): number[] {
  const count = Math.round((half * 2) / step) + 1;
  return Array.from({ length: count }, (_, k) =>
    Number((center - half + k * step).toFixed(4)),
  );
}

/** The area a forecast covers, known without fetching (used to frame the map). */
export function forecastBounds(
  site: Pick<Site, "latitude" | "longitude">,
): Bounds {
  return {
    west: site.longitude - LON_HALF,
    east: site.longitude + LON_HALF,
    south: site.latitude - LAT_HALF,
    north: site.latitude + LAT_HALF,
  };
}

type Stored = Omit<
  ForecastGrid,
  "temperature" | "precipitation" | "windU" | "windV"
> & {
  temperature: number[];
  precipitation: number[];
  windU: number[];
  windV: number[];
};

function readCache(siteId: string): ForecastGrid | undefined {
  try {
    const raw = localStorage.getItem(CACHE_KEY + siteId);
    if (!raw) return undefined;
    const { at, grid } = JSON.parse(raw) as { at: number; grid: Stored };
    if (Date.now() - at > CACHE_TTL_MS) return undefined;
    // Hours must still be current: a cached grid whose first hour is long past is no use.
    if (grid.times[0] * 1000 < Date.now() - 2 * 3600 * 1000) return undefined;
    return {
      ...grid,
      temperature: Float32Array.from(grid.temperature),
      precipitation: Float32Array.from(grid.precipitation),
      windU: Float32Array.from(grid.windU),
      windV: Float32Array.from(grid.windV),
    };
  } catch {
    return undefined;
  }
}

function writeCache(siteId: string, grid: ForecastGrid): void {
  try {
    const stored: Stored = {
      ...grid,
      temperature: Array.from(grid.temperature),
      precipitation: Array.from(grid.precipitation),
      windU: Array.from(grid.windU),
      windV: Array.from(grid.windV),
    };
    localStorage.setItem(
      CACHE_KEY + siteId,
      JSON.stringify({ at: Date.now(), grid: stored }),
    );
  } catch {
    /* storage full or blocked: fine, just refetch next time */
  }
}

type Hourly = {
  time: number[];
  temperature_2m: (number | null)[];
  precipitation: (number | null)[];
  wind_speed_10m: (number | null)[];
  wind_direction_10m: (number | null)[];
};

export async function fetchForecastGrid(
  site: Site,
  signal?: AbortSignal,
): Promise<ForecastGrid> {
  const cached = readCache(site.id);
  if (cached) return cached;

  const lons = axis(site.longitude, LON_HALF, LON_STEP);
  const lats = axis(site.latitude, LAT_HALF, LAT_STEP);
  const latitudes: number[] = [];
  const longitudes: number[] = [];
  for (const lat of lats)
    for (const lon of lons) {
      latitudes.push(lat);
      longitudes.push(lon);
    }
  const params = new URLSearchParams({
    latitude: latitudes.join(","),
    longitude: longitudes.join(","),
    hourly: "temperature_2m,precipitation,wind_speed_10m,wind_direction_10m",
    temperature_unit: "fahrenheit",
    precipitation_unit: "inch",
    wind_speed_unit: "ms",
    timeformat: "unixtime",
    timezone: "GMT",
    forecast_hours: String(FORECAST_HOURS),
  });
  const response = await fetch(`${ENDPOINT}?${params}`, { signal });
  if (!response.ok)
    throw new Error(`Forecast service returned ${response.status}`);
  const results = (await response.json()) as { hourly: Hourly }[];
  if (!Array.isArray(results) || results.length !== latitudes.length)
    throw new Error("Unexpected forecast response");

  const times = results[0].hourly.time;
  const nT = times.length;
  const nI = lons.length;
  const nJ = lats.length;
  const size = nT * nJ * nI;
  const temperature = new Float32Array(size);
  const precipitation = new Float32Array(size);
  const windU = new Float32Array(size);
  const windV = new Float32Array(size);
  results.forEach((result, k) => {
    const j = Math.floor(k / nI);
    const i = k % nI;
    const h = result.hourly;
    for (let t = 0; t < nT; t++) {
      const at = (t * nJ + j) * nI + i;
      temperature[at] = h.temperature_2m[t] ?? 60;
      precipitation[at] = h.precipitation[t] ?? 0;
      // Direction is where the wind comes FROM; u/v are where it blows TO.
      const speed = h.wind_speed_10m[t] ?? 0;
      const radians = ((h.wind_direction_10m[t] ?? 0) * Math.PI) / 180;
      windU[at] = -speed * Math.sin(radians);
      windV[at] = -speed * Math.cos(radians);
    }
  });
  const grid: ForecastGrid = {
    times,
    lons,
    lats,
    temperature,
    precipitation,
    windU,
    windV,
  };
  writeCache(site.id, grid);
  return grid;
}

const clock = new Intl.DateTimeFormat(undefined, { hour: "numeric" });

/** "3 PM, now" or "5 PM, in 2 h". */
export function describeForecastHour(
  unixSeconds: number,
  now = Date.now(),
): string {
  if (!Number.isFinite(unixSeconds)) return "";
  const hours = Math.round((unixSeconds * 1000 - now) / 3600000);
  return `${clock.format(new Date(unixSeconds * 1000))}, ${hours <= 0 ? "now" : `in ${hours} h`}`;
}
