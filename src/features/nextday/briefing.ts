import type {
  AirSection,
  HazardIndexSection,
  LeveeSection,
  NextDayReport,
  RiverSection,
  TideSection,
  WildlifeSection,
} from "../../lib/nextDayReport";

/*
 * Short, field-ready summaries of the report for the hero cards and the compact tiles. Pure functions with no
 * imports at run time, so Node can test them (tests/nextday/briefing.test.mjs). Every sentence is built from report
 * fields. None adds advice the report does not carry.
 */

const hour12 = (h: number) => (h % 12 === 0 ? 12 : h % 12);

/** "5:32 AM" from a site-local ISO string such as "2026-10-19T05:32". */
export function localClock(local: string): string {
  const [h, m] = local.slice(11, 16).split(":").map(Number);
  return `${hour12(h)}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

/** "6:00 AM" from "06:00". */
export function clock(hhmm: string): string {
  return localClock(`0000-00-00T${hhmm}`);
}

const hourWord = (h: number) => `${hour12(h)} ${h < 12 ? "AM" : "PM"}`;

// ---- verdict

export type Bullet = { text: string; detail?: string };

/** The workday the report rates: 6 AM through the 7 PM hour. */
const DAY_FIRST = 6;
const DAY_LAST = 19;

/** Time windows within one hour of a high tide whose peak falls on the report day. */
export function highWaterWindows(tide: TideSection, forDate: string): string[] {
  if (tide.status !== "ok") return [];
  return (tide.near_high ?? [])
    .filter((w) => w.peak.slice(0, 10) === forDate)
    .map((w) => `${localClock(w.start)} to ${localClock(w.end)}`);
}

function weatherBullet(report: NextDayReport): Bullet {
  const runs = report.weather.blocked_runs ?? [];
  if (runs.length) {
    const reasons = [...new Set(runs.flatMap((r) => r.reasons))];
    return {
      text: `Weather stops work: ${reasons.join(", ")}`,
      detail: runs
        .map((r) => `${clock(r.start)} to ${clock(r.end)}`)
        .join("; "),
    };
  }
  const blocked = [
    ...new Set(
      report.hourly
        .filter((h) => h.hour >= DAY_FIRST && h.hour <= DAY_LAST)
        .flatMap((h) => h.blocked_by),
    ),
  ];
  return {
    text: blocked.length
      ? `Weather limits reached: ${blocked.join(", ")}`
      : "Weather limits reached in some hours",
  };
}

function bulletFor(
  report: NextDayReport,
  reason: NextDayReport["verdict"]["reasons"][number],
): Bullet {
  const { heat, hazard_index: hi, air, flood } = report;
  switch (reason.code) {
    case "no_window":
      return { text: "No two-hour work window today" };
    case "short_window": {
      const w = report.verdict.work_window;
      const hours = w
        ? Number(w.end.slice(0, 2)) - Number(w.start.slice(0, 2))
        : null;
      return {
        text:
          hours === null
            ? "Work window is short"
            : `Work window is only ${hours} hours`,
      };
    }
    case "blocked_hours":
      return weatherBullet(report);
    case "nws_alert":
      return { text: reason.text.replace(/ overlaps the day\.?$/, " today") };
    case "heat_band": {
      const p = heat.peak;
      if (!p) return { text: reason.text };
      const band = heat.bands?.find((b) => b.id === p.band)?.name ?? p.band;
      return {
        text: `Heat index peaks at ${Math.round(p.hi)} F (${band})`,
        detail: `Around ${hourWord(p.hour)}`,
      };
    }
    case "wbgt": {
      const w = heat.peak?.wbgt;
      return {
        text:
          w === null || w === undefined
            ? reason.text
            : `Wet bulb globe temperature peaks at ${Math.round(w)} F`,
      };
    }
    case "hazard_index":
      return {
        text:
          hi.score === undefined
            ? reason.text
            : `Hazard index ${hi.score.toFixed(1)} of 10, ${hi.tier}`,
      };
    case "air":
      return {
        text: air.peak
          ? `Air quality peaks at AQI ${Math.round(air.peak.us_aqi)}`
          : reason.text,
      };
    case "river":
      return {
        text: flood.river.flag
          ? `River gauge forecast at ${flood.river.flag} flood stage`
          : reason.text,
      };
    case "mud":
      return { text: "Heavy equipment: hold until routes are inspected" };
    case "tide": {
      const windows = highWaterWindows(flood.tide, report.meta.for_date);
      return {
        text: "Low ground can flood near high tide",
        detail: windows.length ? windows.join("; ") : undefined,
      };
    }
    default:
      return { text: reason.text };
  }
}

/** At most `max` short action lines, worst first, built from the verdict's reason codes. The full sentences stay in the report. */
export function verdictBullets(report: NextDayReport, max = 3): Bullet[] {
  const seen = new Set<string>();
  const out: Bullet[] = [];
  for (const reason of report.verdict.reasons) {
    const b = bulletFor(report, reason);
    if (seen.has(b.text)) continue;
    seen.add(b.text);
    out.push(b);
  }
  return out.slice(0, max);
}

// ---- hazard index

export const FAMILIES = ["heat", "storm", "flood", "fire"] as const;
const FAMILY_WORD = {
  heat: "Heat",
  storm: "Storm",
  flood: "Flood",
  fire: "Fire",
} as const;

export type Pill = {
  key: string;
  label: string;
  percent: string;
  top: boolean;
};

export function hazardPills(hi: HazardIndexSection): Pill[] {
  const p = hi.probabilities;
  if (!p) return [];
  return FAMILIES.map((key) => ({
    key,
    label: FAMILY_WORD[key],
    percent: `${(p[key] * 100).toFixed(1)}%`,
    top: key === hi.top_driver,
  }));
}

/** Needle angle in degrees from straight up: -90 at a score of 0, +90 at 10. */
export function needleAngle(score: number): number {
  const s = Math.min(10, Math.max(0, score));
  return -90 + s * 18;
}

/** Arc path for the part of the half-circle gauge between two scores. Centre (cx, cy), radius r. */
export function gaugeArc(
  cx: number,
  cy: number,
  r: number,
  from: number,
  to: number,
): string {
  const at = (s: number) => {
    const theta = Math.PI * (1 - s / 10);
    return [cx + r * Math.cos(theta), cy - r * Math.sin(theta)] as const;
  };
  const [x0, y0] = at(from);
  const [x1, y1] = at(to);
  return `M${x0.toFixed(1)} ${y0.toFixed(1)} A${r} ${r} 0 0 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`;
}

// ---- mud

export type MudShare = {
  okFt: number;
  inspectFt: number;
  holdFt: number;
  totalFt: number;
};

type RatedPiece = {
  properties: {
    length_ft: number;
    r: Record<string, [number, number, number | null] | undefined>;
  };
};

/**
 * How the rated route length divides into ok, inspect and hold for one equipment class. The totals are the report's
 * own (route_ft, flagged_route_ft). The route file only sets the inspect-to-hold proportion of the flagged part, so
 * the numbers on the card match the miles in the text. Until the file loads, the flagged part takes the worst flag.
 */
export function mudShare(
  eq: { route_ft: number; flagged_route_ft: number; worst_flag: string },
  pieces: RatedPiece[] | null,
  equipment: string,
): MudShare | null {
  const total = eq.route_ft;
  if (!(total > 0)) return null;
  const flagged = Math.min(Math.max(eq.flagged_route_ft, 0), total);
  let holdFrac = eq.worst_flag === "hold" ? 1 : 0;
  if (pieces) {
    let inspect = 0;
    let hold = 0;
    for (const p of pieces) {
      const flag = p.properties.r[equipment]?.[0] ?? 0;
      if (flag === 1) inspect += p.properties.length_ft;
      else if (flag >= 2) hold += p.properties.length_ft;
    }
    if (inspect + hold > 0) holdFrac = hold / (inspect + hold);
  }
  const holdFt = Math.round(flagged * holdFrac);
  return {
    okFt: total - flagged,
    inspectFt: flagged - holdFt,
    holdFt,
    totalFt: total,
  };
}

export const FLAG_WORD = {
  ok: "OK",
  inspect: "Inspect",
  hold: "Hold",
} as const;

/** A point on the slope drawing. */
export type Pt = readonly [number, number];

function lengths(points: readonly Pt[]): number[] {
  return points
    .slice(1)
    .map((p, i) => Math.hypot(p[0] - points[i][0], p[1] - points[i][1]));
}

/** The point a fraction `t` (0 to 1) of the way along a polyline. */
export function pointAlong(points: readonly Pt[], t: number): Pt {
  return polylineSlice(points, t, t)[0];
}

/** The part of a polyline between two fractions of its length, with interpolated end points. */
export function polylineSlice(
  points: readonly Pt[],
  t0: number,
  t1: number,
): Pt[] {
  const seg = lengths(points);
  const total = seg.reduce((a, b) => a + b, 0);
  const at = (d: number): Pt => {
    let run = 0;
    for (let i = 0; i < seg.length; i++) {
      if (d <= run + seg[i] || i === seg.length - 1) {
        const f =
          seg[i] === 0 ? 0 : Math.min(1, Math.max(0, (d - run) / seg[i]));
        return [
          points[i][0] + (points[i + 1][0] - points[i][0]) * f,
          points[i][1] + (points[i + 1][1] - points[i][1]) * f,
        ];
      }
      run += seg[i];
    }
    return points[0];
  };
  const d0 = Math.min(1, Math.max(0, t0)) * total;
  const d1 = Math.min(1, Math.max(t0, t1)) * total;
  const out: Pt[] = [at(d0)];
  let run = 0;
  for (let i = 0; i < seg.length; i++) {
    run += seg[i];
    if (run > d0 && run < d1) out.push(points[i + 1]);
  }
  if (d1 > d0) out.push(at(d1));
  return out;
}

// ---- tide, river, levees, air, wildlife

/** One line about the river: the gauge reading, or why there is none. */
export function riverLine(river: RiverSection): string {
  if (river.status !== "ok" || !river.gauge)
    return `River: ${river.reason ?? "no gauge data"}`;
  const u = river.stage_unit ?? "ft";
  const word = (c: string) =>
    c === "none" ? "below flood stage" : `${c.replace("_", " ")} flood stage`;
  const parts = [river.gauge.name];
  if (river.observed) {
    const o = river.observed;
    parts.push(
      `now ${o.stage} ${u}, ${word(o.category)}${o.trend ? `, ${o.trend}` : ""}`,
    );
  }
  if (river.forecast)
    parts.push(
      `forecast crest ${river.forecast.crest.stage} ${u}, ${word(river.forecast.crest.category)}`,
    );
  return `River: ${parts.join(", ")}`;
}

/** One line about levees: inside a leveed area, or the nearest system and its FEMA status. */
export function leveeLine(levees: LeveeSection): string {
  if (levees.status !== "ok")
    return `Levees: ${levees.reason ?? "no levee data"}`;
  const systems = levees.systems ?? [];
  const sys = systems.find((s) => s.inside) ?? systems[0];
  const name = sys ? (sys.name ?? `System ${sys.id}`) : null;
  if (levees.inside_leveed_area)
    return `The site is inside a mapped leveed area${name ? ` (${name})` : ""}.`;
  if (
    levees.nearest_levee_km !== null &&
    levees.nearest_levee_km !== undefined
  ) {
    const fema = sys?.fema_accreditation
      ? `, FEMA: ${sys.fema_accreditation}`
      : "";
    return `Nearest levee: ${name ?? "unnamed"} (${levees.nearest_levee_km} km${fema}).`;
  }
  return "No mapped levee near the site.";
}

export type TideSummary = {
  highs: { time: string; ft: number }[];
  windows: string[];
};

export function tideSummary(
  tide: TideSection,
  forDate: string,
): TideSummary | null {
  if (tide.status !== "ok" || !tide.events) return null;
  return {
    highs: tide.events
      .filter((e) => e.type === "H" && e.t.slice(0, 10) === forDate)
      .map((e) => ({ time: localClock(e.t), ft: e.ft_mllw })),
    windows: highWaterWindows(tide, forDate),
  };
}

export type AirSummary = {
  peak: number;
  band: string;
  /** Lowest AQI in the workday, or null when the hourly list is missing. */
  low: number | null;
  /** The hourly row is shown in the schedule only when the day reaches this AQI. */
  hourlyRow: boolean;
  fires: string;
};

/** The US AQI at which "unhealthy for sensitive groups" starts. */
export const AQI_SENSITIVE = 101;

export function airSummary(air: AirSection): AirSummary | null {
  if (!air.peak) return null;
  const values = (air.hours ?? [])
    .filter((h) => h.hour >= DAY_FIRST && h.hour <= DAY_LAST)
    .map((h) => h.us_aqi)
    .filter((v): v is number => v !== null);
  const w = air.wildfire;
  return {
    peak: Math.round(air.peak.us_aqi),
    band: air.peak.band.name,
    low: values.length ? Math.round(Math.min(...values)) : null,
    hourlyRow: air.peak.us_aqi >= AQI_SENSITIVE,
    fires: !w
      ? "Wildfire list unavailable"
      : w.within_25_mi > 0
        ? `${w.within_25_mi} active wildfire(s) within 25 mi`
        : "No active wildfire within 25 mi",
  };
}

export function wildlifeChips(
  w: WildlifeSection | undefined,
): { label: string; recent: number }[] {
  return (w?.groups ?? [])
    .filter((g) => g.recent > 0)
    .map((g) => ({ label: g.label, recent: g.recent }));
}
