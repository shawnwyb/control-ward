// Pure logic for the next-day work plan: a ring of forecast points around a site, safe working hours
// from the hourly forecast, and parsing of the Gemini answer. No Deno APIs, so it is unit tested in Node.
import { addDays, localDate, zonedToUtc } from "./time.ts";
import { heatIndexF, wbgtF } from "./heat.ts";
import type { OpenMeteoLocation } from "./openmeteo.ts";

export interface HourPlan {
  hour: number; // local hour 0-23
  wbgt: number | null;
  gust: number | null;
  pop: number | null;
  mm: number | null;
  safe: boolean;
  blocked_by: string[];
}

export interface WorkWindow {
  start: string; // "07:00" local
  end: string;
}

export interface PlanContext {
  traffic: string;
  school: string;
  wildlife: string;
}

// Centre plus six points on a circle, so a storm cell or hot pocket near the site shows up in the plan.
export function ringPoints(
  lat: number,
  lon: number,
  km = 20,
  count = 6,
): { latitude: number; longitude: number }[] {
  const points = [{ latitude: lat, longitude: lon }];
  const dLat = km / 111.32;
  const dLon = km / (111.32 * Math.max(Math.cos((lat * Math.PI) / 180), 0.05));
  for (let i = 0; i < count; i++) {
    const a = (2 * Math.PI * i) / count;
    points.push({
      latitude: Math.max(-90, Math.min(90, lat + dLat * Math.sin(a))),
      longitude: lon + dLon * Math.cos(a),
    });
  }
  return points;
}

const num = (v: number | null | undefined): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;
const maxOf = (values: (number | null)[]): number | null => {
  const nums = values.filter((v): v is number => v !== null);
  return nums.length ? Math.max(...nums) : null;
};

// Thresholds mirror the rules engine: WBGT 88 F is the "danger" tier, gusts 40 mph and 60% storm chance are "caution".
export const LIMITS = { wbgt: 88, gust: 40, pop: 60, mm: 1 } as const;

// Worst value across the ring for each local hour of `forDate` (YYYY-MM-DD).
export function hourlyPlan(
  locations: OpenMeteoLocation[],
  timezone: string,
  forDate: string,
): HourPlan[] {
  const out: HourPlan[] = [];
  for (let hour = 0; hour < 24; hour++) {
    const utc = zonedToUtc(forDate, hour, timezone);
    const perPoint = locations.map((loc) => {
      const h = loc.hourly;
      const i = h.time.findIndex((t) => Date.parse(`${t}:00Z`) === utc);
      if (i < 0) return null;
      const t = num(h.temperature_2m?.[i]);
      const rh = num(h.relative_humidity_2m?.[i]);
      const wind = num(h.wind_speed_10m?.[i]) ?? 0;
      const sun = num(h.shortwave_radiation?.[i]) ?? 0;
      return {
        wbgt: t !== null && rh !== null ? wbgtF(t, rh, wind, sun) : null,
        hi: t !== null && rh !== null ? heatIndexF(t, rh) : null,
        gust: num(h.wind_gusts_10m?.[i]),
        pop: num(h.precipitation_probability?.[i]),
        mm: num(h.precipitation?.[i]),
      };
    });
    const rows = perPoint.filter((p): p is NonNullable<typeof p> => p !== null);
    const wbgt = maxOf(rows.map((r) => r.wbgt));
    const gust = maxOf(rows.map((r) => r.gust));
    const pop = maxOf(rows.map((r) => r.pop));
    const mm = maxOf(rows.map((r) => r.mm));
    const blocked: string[] = [];
    if (wbgt !== null && wbgt >= LIMITS.wbgt) blocked.push("heat");
    if (gust !== null && gust >= LIMITS.gust) blocked.push("wind");
    if (pop !== null && pop >= LIMITS.pop) blocked.push("storms");
    if (mm !== null && mm >= LIMITS.mm) blocked.push("rain");
    out.push({
      hour,
      wbgt: wbgt === null ? null : Math.round(wbgt * 10) / 10,
      gust: gust === null ? null : Math.round(gust),
      pop: pop === null ? null : Math.round(pop),
      mm: mm === null ? null : Math.round(mm * 10) / 10,
      safe: rows.length > 0 && blocked.length === 0,
      blocked_by: blocked,
    });
  }
  return out;
}

const pad = (h: number) => `${String(h).padStart(2, "0")}:00`;

// Longest run of safe hours inside the normal working day (06:00-19:00), at least two hours long.
export function workWindow(
  hours: HourPlan[],
  dayStart = 6,
  dayEnd = 19,
): WorkWindow | null {
  let best: [number, number] | null = null;
  let runStart = -1;
  for (let h = dayStart; h <= dayEnd; h++) {
    const ok = h < dayEnd && hours[h]?.safe;
    if (ok && runStart < 0) runStart = h;
    if (!ok && runStart >= 0) {
      if (!best || h - runStart > best[1] - best[0]) best = [runStart, h];
      runStart = -1;
    }
  }
  return best && best[1] - best[0] >= 2
    ? { start: pad(best[0]), end: pad(best[1]) }
    : null;
}

export function rulesSummary(
  window: WorkWindow | null,
  hours: HourPlan[],
): { summary: string; reasons: string[] } {
  const blocked = new Set<string>();
  for (let h = 6; h < 19; h++)
    for (const b of hours[h]?.blocked_by ?? []) blocked.add(b);
  const reasons = [...blocked].map(
    (b) =>
      ({
        heat: "Heat stress reaches the danger tier at some point in the workday.",
        wind: "Gusts reach 40 mph or more at some point in the workday.",
        storms:
          "Storm chance reaches 60% or more at some point in the workday.",
        rain: "Measurable rain is forecast during the workday.",
      })[b] ?? b,
  );
  return {
    summary: window
      ? `Best working window is ${window.start} to ${window.end} based on the hourly forecast around the site.`
      : "No safe two-hour window was found in the normal workday. Consider postponing non-essential outdoor work.",
    reasons,
  };
}

const text = (v: unknown, max = 500): string =>
  typeof v === "string" ? v.trim().slice(0, max) : "";

const hhmm = (v: unknown): string | null =>
  typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : null;

// Gemini with Google Search grounding cannot be forced into JSON mode, so the answer is extracted from the text.
export function parseGemini(raw: string): {
  work_window: WorkWindow | null;
  summary: string;
  reasons: string[];
  context: PlanContext;
} | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
  const w = data.work_window as Record<string, unknown> | null | undefined;
  const ws = w ? hhmm(w.start) : null;
  const we = w ? hhmm(w.end) : null;
  const ctx = (data.context ?? {}) as Record<string, unknown>;
  const summary = text(data.summary, 400);
  if (!summary) return null;
  return {
    work_window: ws && we && ws < we ? { start: ws, end: we } : null,
    summary,
    reasons: Array.isArray(data.reasons)
      ? data.reasons
          .map((r) => text(r, 200))
          .filter(Boolean)
          .slice(0, 8)
      : [],
    context: {
      traffic: text(ctx.traffic),
      school: text(ctx.school),
      wildlife: text(ctx.wildlife),
    },
  };
}

// Gemini may only narrow the rules-based window, never widen it into unsafe hours.
export function clampWindow(
  proposed: WorkWindow | null,
  safe: WorkWindow | null,
): WorkWindow | null {
  if (!safe || !proposed) return null;
  const start = proposed.start > safe.start ? proposed.start : safe.start;
  const end = proposed.end < safe.end ? proposed.end : safe.end;
  return start < end ? { start, end } : null;
}

export function tomorrowDate(nowMs: number, timezone: string): string {
  return addDays(localDate(nowMs, timezone), 1);
}
