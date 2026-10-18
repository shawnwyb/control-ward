/*
 * Current conditions at one point, from Open-Meteo (same provider as the map's forecast).
 * Pure parsing and formatting live here so plain Node tests can load them.
 */
export const CONDITIONS_ENDPOINT = "https://api.open-meteo.com/v1/forecast";

export type Conditions = {
  tempF: number;
  feelsLikeF: number;
  /** Inches per hour. */
  rainIn: number;
  windMph: number;
  gustMph: number;
  /** Compass point the wind blows from, e.g. "WSW". */
  windDir: string;
};

const POINTS = [
  "N",
  "NNE",
  "NE",
  "ENE",
  "E",
  "ESE",
  "SE",
  "SSE",
  "S",
  "SSW",
  "SW",
  "WSW",
  "W",
  "WNW",
  "NW",
  "NNW",
];

/** 16-point compass name for a bearing in degrees. */
export function compass(deg: number): string {
  const d = ((deg % 360) + 360) % 360;
  return POINTS[Math.round(d / 22.5) % 16];
}

export function conditionsUrl(lat: number, lon: number): string {
  const q = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    current:
      "temperature_2m,apparent_temperature,precipitation,wind_speed_10m,wind_direction_10m,wind_gusts_10m",
    temperature_unit: "fahrenheit",
    precipitation_unit: "inch",
    wind_speed_unit: "mph",
  });
  return `${CONDITIONS_ENDPOINT}?${q}`;
}

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

/** The `current` block of an Open-Meteo answer, or null when it is missing or incomplete. */
export function parseConditions(json: unknown): Conditions | null {
  const c = (json as { current?: Record<string, unknown> } | null)?.current;
  if (!c || typeof c !== "object") return null;
  const tempF = num(c.temperature_2m);
  const feelsLikeF = num(c.apparent_temperature);
  const rainIn = num(c.precipitation);
  const windMph = num(c.wind_speed_10m);
  const dir = num(c.wind_direction_10m);
  const gustMph = num(c.wind_gusts_10m);
  if (
    tempF === null ||
    feelsLikeF === null ||
    rainIn === null ||
    windMph === null ||
    dir === null ||
    gustMph === null
  )
    return null;
  return {
    tempF,
    feelsLikeF,
    rainIn,
    windMph,
    gustMph,
    windDir: compass(dir),
  };
}

export const formatTemp = (f: number) => `${Math.round(f)}°F`;
export const formatRain = (inches: number) => `${inches.toFixed(2)} in/hr`;
export const formatWind = (mph: number) => `${Math.round(mph)} mph`;

/** Meters to miles, one decimal. */
export function metersToMiles(m: number): string {
  return (m / 1609.344).toFixed(1);
}

/** "just now", "3 min ago", "2 h ago". */
export function ago(fromMs: number, nowMs: number): string {
  const min = Math.max(0, Math.floor((nowMs - fromMs) / 60000));
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  return `${Math.floor(min / 60)} h ago`;
}
