/*
 * Plain-words explanations of the 0 to 10 hazard scores. Pure, with no imports of the
 * Supabase client, so Node tests can load it.
 *
 * MIRRORS the rules engine in supabase/migrations/20261017001000_rules_engine.sql:
 *   private.heat_tier / private.heat_score      -> heat
 *   private.flood_score                          -> flood
 *   private.wildfire_score                       -> wildfire
 *   private.soil_score                           -> soil
 *   private.weather_score                        -> weather
 *   evaluate_site (lightning, reading windows)   -> lightning and the max ages below
 *   private.latest_reading                       -> latest live reading per (hazard, unit)
 *   public.compute_site_risk                     -> explainIndex
 * Keep thresholds, multipliers and caps identical to the SQL. If they drift, the score
 * shown from site_overview and the recomputed score disagree and the UI says so.
 */

/** A row of public.readings (only the columns the explanation needs). */
export type Reading = {
  hazard: string;
  unit: string;
  value: number;
  observed_at: string;
  forecast_for?: string | null;
};

export type ExplainSite = {
  fema_flood_zone?: string | null;
  river_distance_m?: number | null;
};

export type HazardKind =
  "heat" | "weather" | "lightning" | "flood" | "wildfire" | "soil" | "wildlife";

export type ExplainExtra = {
  /** Clock for reading ages; defaults to now. */
  now?: number;
  /** Lightning state from lightning_state. */
  lightning?: {
    status: "clear" | "stop_work";
    lastStrikeAt: string | null;
    lastStrikeDistanceM: number | null;
  };
  /** Wildlife comes from crew reports, not readings: the stored score and report count. */
  wildlifeScore?: number;
  wildlifeReports?: number;
};

export type Explanation = {
  /** The score recomputed from the readings, 0 to 10, one decimal. */
  score: number;
  /** The raw value that matters most, short enough to sit next to the score. */
  headline: string;
  /** Every input that was read. */
  reading: string;
  /** The rule row that produced the score. */
  rule: string;
  /** The next step up, or an at-the-top note. */
  next: string;
  /** True when no recent reading existed for this hazard. */
  noData: boolean;
};

const HOUR = 3600_000;
/** Max ages mirror the interval arguments in evaluate_site; the default is 3 hours. */
const MAX_AGE = {
  "flood/precip_mm_overnight": 18 * HOUR,
  "flood/precip_mm_24h": 6 * HOUR,
  "flood/gauge_flood_stage_ft": 72 * HOUR,
  "soil/soil_moisture_frac": 6 * HOUR,
  "wildfire/nearest_fire_mi": 6 * HOUR,
  "wildfire/fires_within_25mi": 6 * HOUR,
} as Record<string, number>;
const DEFAULT_AGE = 3 * HOUR;
/** The oldest a reading can be and still count; fetchReadings only needs to go back this far. */
export const READINGS_WINDOW_MS = 72 * HOUR;

const ZONES = ["A", "AE", "AH", "AO", "AR", "A99", "V", "VE"];

/** private.latest_reading: newest live (non-forecast) value for the pair within its max age. */
export function latestReading(
  readings: Reading[],
  hazard: string,
  unit: string,
  now = Date.now(),
): number | null {
  const maxAge = MAX_AGE[`${hazard}/${unit}`] ?? DEFAULT_AGE;
  let best: Reading | null = null;
  let bestAt = -Infinity;
  for (const r of readings) {
    if (r.hazard !== hazard || r.unit !== unit) continue;
    if (r.forecast_for && r.forecast_for !== "-infinity") continue;
    const at = Date.parse(r.observed_at);
    if (!Number.isFinite(at) || at <= now - maxAge) continue;
    if (at > bestAt) {
      best = r;
      bestAt = at;
    }
  }
  return best ? best.value : null;
}

/** numeric(3,1) rounding, as site_subscores stores it. */
const round1 = (n: number) => Math.round(n * 10 + 1e-9) / 10;
const s1 = (n: number) => round1(n).toFixed(1);
const num = (n: number) => String(round1(n));
const mmToIn = (mm: number) => (mm / 25.4).toFixed(2);
const none = (): Explanation => ({
  score: 0,
  headline: "No recent reading",
  reading: "No recent reading",
  rule: "",
  next: "",
  noData: true,
});

type Rung = { at: number; score: number; label: string };

/** Highest rung whose threshold the value reaches (rungs ascending). */
function climb(rungs: Rung[], value: number | null) {
  let hit: Rung | null = null;
  if (value === null) return null;
  for (const r of rungs) if (value >= r.at) hit = r;
  return hit;
}

/** The rule text for the rung a value sits in, with its range up to the next threshold. */
function band(
  rungs: Rung[],
  hit: Rung | null,
  name: string,
  unit: string,
  fmt: (n: number) => string = num,
) {
  if (!hit) return `${name} under ${fmt(rungs[0].at)}${unit} → 0.0`;
  const i = rungs.indexOf(hit);
  const upper = rungs[i + 1];
  const range = upper
    ? `${fmt(hit.at)}–${fmt(upper.at)}${unit}`
    : `${fmt(hit.at)}${unit} or more`;
  return `${name} ${range} → ${s1(hit.score)}${hit.label ? ` · ${hit.label}` : ""}`;
}

type Step = { score: number; text: string };

/** The smallest score above the current one among the candidate steps. */
function nextStep(current: number, steps: Step[]): string {
  const higher = steps.filter((s) => s.score > current + 0.05);
  if (!higher.length) return "At the highest level for this hazard";
  higher.sort((a, b) => a.score - b.score);
  return higher[0].text;
}

const HEAT_WBGT: Rung[] = [
  { at: 82, score: 3, label: "caution" },
  { at: 85, score: 5, label: "scheduled rest breaks" },
  { at: 88, score: 7.5, label: "danger, limit heavy work" },
  { at: 90, score: 10, label: "stop heavy work" },
];
const HEAT_INDEX: Rung[] = [
  { at: 90, score: 3, label: "" },
  { at: 103, score: 6, label: "" },
  { at: 125, score: 9, label: "" },
];

function explainHeat(readings: Reading[], now: number): Explanation {
  const wbgt = latestReading(readings, "heat", "wbgt_f", now);
  const hi = latestReading(readings, "heat", "heat_index_f", now);
  if (wbgt === null && hi === null) return none();
  const w = climb(HEAT_WBGT, wbgt);
  const h = climb(HEAT_INDEX, hi);
  const ws = w?.score ?? 0;
  const hs = h?.score ?? 0;
  const score = Math.max(ws, hs);
  // WBGT leads when it ties, since the alert tiers are WBGT.
  const byWbgt = wbgt !== null && ws >= hs;
  const rule = byWbgt
    ? band(HEAT_WBGT, w, "WBGT", "°F")
    : band(HEAT_INDEX, h, "Heat index", "°F");
  // The next step follows the metric that sets the score (the other one is in "reading").
  const steps: Step[] = (byWbgt ? HEAT_WBGT : HEAT_INDEX)
    .filter((r) => r.score > score)
    .map((r) => ({
      score: r.score,
      text: `Rises to ${s1(r.score)} at ${byWbgt ? "WBGT" : "heat index"} ${r.at}°F`,
    }));
  const parts = [
    wbgt !== null ? `WBGT ${Math.round(wbgt)}°F` : null,
    hi !== null ? `heat index ${Math.round(hi)}°F` : null,
  ].filter(Boolean);
  return {
    score,
    headline:
      hi !== null
        ? `Heat index ${Math.round(hi)}°F`
        : `WBGT ${Math.round(wbgt as number)}°F`,
    reading: capital(parts.join(" · ")),
    rule,
    next: nextStep(score, steps),
    noData: false,
  };
}

const FLOOD_RAIN: Rung[] = [
  { at: 10, score: 2, label: "" },
  { at: 25, score: 4, label: "" },
  { at: 50, score: 6, label: "" },
  { at: 100, score: 9, label: "" },
];

function explainFlood(
  readings: Reading[],
  site: ExplainSite,
  now: number,
): Explanation {
  const rainO = latestReading(readings, "flood", "precip_mm_overnight", now);
  const rain24 = latestReading(readings, "flood", "precip_mm_24h", now);
  const stage = latestReading(readings, "flood", "gauge_stage_ft", now);
  const fstage = latestReading(readings, "flood", "gauge_flood_stage_ft", now);
  const warn = latestReading(readings, "flood", "nws_flood_warning", now);
  const rain =
    rainO === null && rain24 === null
      ? null
      : Math.max(rainO ?? -Infinity, rain24 ?? -Infinity);
  const hasGauge = stage !== null && fstage !== null && fstage > 0;
  if (rain === null && stage === null && warn === null) return none();

  const rainRung = climb(FLOOD_RAIN, rain);
  const rainScore = rainRung?.score ?? 0;
  const gaugeScore = !hasGauge
    ? 0
    : stage >= fstage
      ? 9
      : stage >= 0.8 * fstage
        ? 6
        : 0;
  const warnScore = (warn ?? 0) >= 1 ? 8 : 0;
  const base = Math.max(rainScore, gaugeScore, warnScore);

  const zone = site.fema_flood_zone ?? null;
  const zoneMult = zone !== null && ZONES.includes(zone) ? 1.3 : 1;
  const river = site.river_distance_m ?? null;
  const riverMult =
    river === null ? 1 : river <= 5000 ? 1.2 : river > 25000 ? 0.8 : 1;
  const factor = zoneMult * riverMult;
  const total = (b: number) => round1(Math.min(10, b * factor));
  const score = total(base);
  const km = river === null ? "" : `${num(river / 1000)} km`;
  const mults = [
    zoneMult !== 1 ? `×1.3 FEMA zone ${zone}` : null,
    riverMult !== 1 ? `×${riverMult} river ${km} away` : null,
  ].filter(Boolean) as string[];

  let rule: string;
  let headline: string;
  if (base === 0) {
    rule = "Rain under 10 mm, gauge under 80% of flood stage, no warning → 0.0";
  } else if (
    base === warnScore &&
    warnScore >= gaugeScore &&
    warnScore >= rainScore
  ) {
    rule = "NWS flood warning in effect → 8.0";
  } else if (base === gaugeScore && gaugeScore >= rainScore) {
    rule =
      gaugeScore === 9
        ? "River at or above flood stage → 9.0"
        : "River at 80% of flood stage or more → 6.0";
  } else {
    rule = band(FLOOD_RAIN, rainRung, "Rain", " mm");
  }
  if (base > 0 && mults.length) rule += ` · ${mults.join(" · ")}`;
  if (base > 0 && factor !== 1) rule += ` = ${s1(score)}`;
  if (base > 0 && base * factor > 10) rule += " (capped at 10)";

  if (warnScore && base === warnScore) headline = "NWS flood warning";
  else if (gaugeScore && base === gaugeScore && gaugeScore >= rainScore)
    headline = `River ${num(stage as number)} of ${num(fstage as number)} ft flood stage`;
  else if (rain !== null)
    headline = `Rain ${mmToIn(rain)} in (${Math.round(rain)} mm)`;
  else headline = "No rain reading";

  const parts = [
    rain !== null ? `rain ${Math.round(rain)} mm (${mmToIn(rain)} in)` : null,
    hasGauge ? `river ${num(stage)} ft, flood stage ${num(fstage)} ft` : null,
    warn !== null
      ? warn >= 1
        ? "NWS flood warning"
        : "no NWS flood warning"
      : null,
    zone ? `FEMA zone ${zone}` : null,
    river !== null ? `river ${km} away` : null,
  ].filter(Boolean) as string[];

  const steps: Step[] = [
    ...FLOOD_RAIN.filter((r) => total(r.score) > score).map((r) => ({
      score: total(r.score),
      text: `Rises to ${s1(total(r.score))} at rain ${r.at} mm (${mmToIn(r.at)} in)`,
    })),
  ];
  if (hasGauge) {
    if (total(6) > score)
      steps.push({
        score: total(6),
        text: `Rises to ${s1(total(6))} when the river reaches ${num(0.8 * fstage)} ft`,
      });
    if (total(9) > score)
      steps.push({
        score: total(9),
        text: `Rises to ${s1(total(9))} when the river reaches ${num(fstage)} ft`,
      });
  }
  if (total(8) > score)
    steps.push({
      score: total(8),
      text: `Rises to ${s1(total(8))} with an NWS flood warning`,
    });
  return {
    score,
    headline,
    reading: capital(parts.join(" · ")),
    rule,
    next: nextStep(score, steps),
    noData: false,
  };
}

const FIRE: { under: number; score: number }[] = [
  { under: 5, score: 10 },
  { under: 10, score: 8 },
  { under: 25, score: 6 },
  { under: 50, score: 3 },
  { under: 100, score: 1 },
];

function explainWildfire(readings: Reading[], now: number): Explanation {
  const mi = latestReading(readings, "wildfire", "nearest_fire_mi", now);
  const count = latestReading(readings, "wildfire", "fires_within_25mi", now);
  if (mi === null) return none();
  const i = FIRE.findIndex((r) => mi < r.under);
  const score = i < 0 ? 0 : FIRE[i].score;
  const shown = `${num(mi)} mi`;
  const lower =
    i < 0 ? FIRE[FIRE.length - 1].under : i > 0 ? FIRE[i - 1].under : 0;
  const rule =
    i < 0
      ? "Nearest fire 100 mi or more away → 0.0"
      : `Nearest fire ${lower}–${FIRE[i].under} mi away → ${s1(score)}`;
  const up = i < 0 ? FIRE.length - 1 : i - 1;
  return {
    score,
    headline: `Nearest fire ${shown}`,
    reading: `Nearest fire ${shown}${count !== null ? ` · ${Math.round(count)} within 25 mi` : ""}`,
    rule,
    next:
      up >= 0
        ? `Rises to ${s1(FIRE[up].score)} within ${FIRE[up].under} mi`
        : "At the highest level for this hazard",
    noData: false,
  };
}

const SOIL: Rung[] = [
  { at: 0.3, score: 2, label: "" },
  { at: 0.35, score: 4, label: "" },
  { at: 0.4, score: 6, label: "" },
  { at: 0.45, score: 8, label: "" },
];
const pct = (f: number) => String(Math.round(f * 100));

function explainSoil(readings: Reading[], now: number): Explanation {
  const frac = latestReading(readings, "soil", "soil_moisture_frac", now);
  if (frac === null) return none();
  const hit = climb(SOIL, frac);
  const score = hit?.score ?? 0;
  const next = SOIL.find((r) => r.score > score);
  return {
    score,
    headline: `Soil moisture ${pct(frac)}%`,
    reading: `Soil moisture ${pct(frac)}%`,
    rule: band(SOIL, hit, "Soil moisture", "%", pct),
    next: next
      ? `Rises to ${s1(next.score)} at ${pct(next.at)}%`
      : "At the highest level for this hazard",
    noData: false,
  };
}

const GUST: Rung[] = [
  { at: 30, score: 3, label: "" },
  { at: 40, score: 6, label: "" },
  { at: 58, score: 9, label: "" },
];

function explainWeather(readings: Reading[], now: number): Explanation {
  const sev = latestReading(readings, "weather", "nws_alert_severity", now);
  const gust = latestReading(readings, "weather", "wind_gust_mph", now);
  if (sev === null && gust === null) return none();
  const sevScore = Math.min((sev ?? 0) * 2, 8);
  const g = climb(GUST, gust);
  const gScore = g?.score ?? 0;
  const score = Math.max(sevScore, gScore);
  const bySev = sevScore > gScore;
  const rule = bySev
    ? `NWS alert severity ${num(sev as number)} × 2 → ${s1(sevScore)} (max 8)`
    : gust !== null
      ? band(GUST, g, "Gusts", " mph")
      : "No NWS alert → 0.0";
  const steps: Step[] = GUST.filter((r) => r.score > score).map((r) => ({
    score: r.score,
    text: `Rises to ${s1(r.score)} at gusts ${r.at} mph`,
  }));
  const nextSev = Math.floor(sev ?? 0) + 1;
  if (nextSev <= 4)
    steps.push({
      score: nextSev * 2,
      text: `Rises to ${s1(nextSev * 2)} at NWS alert severity ${nextSev}`,
    });
  const parts = [
    gust !== null ? `gusts ${Math.round(gust)} mph` : null,
    sev !== null ? `NWS alert severity ${num(sev)}` : null,
  ].filter(Boolean) as string[];
  return {
    score,
    headline: bySev
      ? `NWS alert severity ${num(sev as number)}`
      : gust !== null
        ? `Gusts ${Math.round(gust)} mph`
        : `NWS alert severity ${num(sev as number)}`,
    reading: capital(parts.join(" · ")),
    rule,
    next: nextStep(score, steps),
    noData: false,
  };
}

const STRIKE_RADIUS_M = 40233.6;

function explainLightning(extra: ExplainExtra, now: number): Explanation {
  const l = extra.lightning;
  if (!l) return none();
  const at = l.lastStrikeAt ? Date.parse(l.lastStrikeAt) : NaN;
  const mins = Number.isFinite(at)
    ? Math.max(0, Math.round((now - at) / 60000))
    : null;
  const miles =
    l.lastStrikeDistanceM === null
      ? null
      : num(l.lastStrikeDistanceM / 1609.344);
  const last =
    mins !== null
      ? `Last strike ${mins} min ago${miles ? `, ${miles} mi away` : ""}`
      : "No strikes recorded";
  if (l.status === "stop_work")
    return {
      score: 10,
      headline: "Stop work",
      reading: last,
      rule: "Lightning stop-work active → 10.0",
      next: "At the highest level for this hazard",
      noData: false,
    };
  const recent =
    mins !== null &&
    mins <= 60 &&
    l.lastStrikeDistanceM !== null &&
    l.lastStrikeDistanceM <= STRIKE_RADIUS_M;
  return {
    score: recent ? 4 : 0,
    headline: recent ? "Strike within 25 mi" : "No strikes nearby",
    reading: last,
    rule: recent
      ? "Strike within 25 mi in the last 60 min → 4.0"
      : "No strike within 25 mi in the last 60 min → 0.0",
    next: "Rises to 4.0 on a strike within 25 mi, 10.0 at stop-work",
    noData: false,
  };
}

function explainWildlife(extra: ExplainExtra): Explanation {
  const score = round1(extra.wildlifeScore ?? 0);
  const n = extra.wildlifeReports;
  return {
    score,
    headline: score > 0 ? "Recent wildlife report" : "No open wildlife reports",
    reading:
      n !== undefined
        ? `${n} open wildlife ${n === 1 ? "report" : "reports"}`
        : "From open crew wildlife reports",
    rule: "Each open wildlife report adds up to 10 by severity, fading over 48 h",
    next: "Rises with each new or re-confirmed wildlife report",
    noData: false,
  };
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The recomputed score and its explanation for one hazard. */
export function explainHazard(
  kind: HazardKind,
  readings: Reading[],
  site: ExplainSite,
  extra: ExplainExtra = {},
): Explanation {
  const now = extra.now ?? Date.now();
  switch (kind) {
    case "heat":
      return explainHeat(readings, now);
    case "flood":
      return explainFlood(readings, site, now);
    case "wildfire":
      return explainWildfire(readings, now);
    case "soil":
      return explainSoil(readings, now);
    case "weather":
      return explainWeather(readings, now);
    case "lightning":
      return explainLightning(extra, now);
    case "wildlife":
      return explainWildlife(extra);
  }
}

/** True when the stored subscore and the recomputed one are different numbers. */
export function scoreDiffers(stored: number, computed: number): boolean {
  return Math.abs(round1(stored) - round1(computed)) > 0.05;
}

/**
 * How the overall index is built: the worst hazard plus the crew-report term
 * (compute_site_risk: min(10, max(ML index, worst subscore) + crew term)).
 */
export function explainIndex(
  riskNow: number | null,
  worst: { name: string; score: number } | null,
  crewTerm: number,
): string {
  if (riskNow === null) return "No index yet";
  const crew = round1(crewTerm);
  const w = worst ?? { name: "No hazard", score: 0 };
  // The index is never below its worst hazard; if it is, the two were computed at different times.
  if (round1(riskNow) < round1(w.score) - 0.05)
    return `${s1(riskNow)} · ${w.name} is now ${s1(w.score)}, index not yet updated`;
  const capped = round1(w.score + crew) > 10 && riskNow >= 9.95;
  // Below the cap, a base above the worst subscore can only be the ML index.
  const base = capped ? round1(w.score) : round1(riskNow - crew);
  const ml = base > round1(w.score) + 0.05;
  const lead = ml
    ? `ML hazard index ${s1(base)}`
    : w.score > 0
      ? `${w.name} ${s1(w.score)} (worst hazard)`
      : "no active hazards";
  const crewText = crew > 0 ? ` + ${s1(crew)} from open crew reports` : "";
  return `${s1(riskNow)} = ${lead}${crewText}${capped ? ", capped at 10" : ""}`;
}
