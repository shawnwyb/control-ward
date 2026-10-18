import type {
  Blocker,
  HourRow,
  TaskProfile,
  TasksSection,
} from "../../lib/nextDayReport";

/*
 * Which hours a task is blocked in, from the report's hourly table. Pure functions with no imports at run time,
 * so Node can test them directly (tests/nextday/taskPlan.test.mjs).
 */

export const WORKDAY = { start: 6, end: 19 } as const;

/** Limits the manager changed, keyed "<profile id>.<blocker id>". */
export type Overrides = Record<string, number>;

export type HourResult = { hour: number; blocked: boolean; reasons: string[] };

export const overrideKey = (profileId: string, blockerId: string) =>
  `${profileId}.${blockerId}`;

export function limitFor(
  profile: TaskProfile,
  blocker: Blocker,
  overrides: Overrides,
): number | undefined {
  const o = overrides[overrideKey(profile.id, blocker.id)];
  return Number.isFinite(o) ? o : blocker.limit;
}

function factorValue(
  row: HourRow,
  factor: NonNullable<Blocker["factor"]>,
): number | null {
  if (factor === "tide_near_high") return row.tide_near_high ? 1 : 0;
  const v = row[factor];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Hour-by-hour result for one task. An hour with no forecast is blocked: the report cannot say it is clear. */
export function blockedHours(
  profile: TaskProfile,
  hourly: HourRow[],
  flags: TasksSection["site_flags"],
  overrides: Overrides = {},
): HourResult[] {
  return hourly.map((row) => {
    const reasons: string[] = [];
    if (!row.have_data) reasons.push("No forecast for this hour");
    for (const b of profile.blockers) {
      if (b.only_if === "tide_shading" && !flags.tide_shading) continue;
      if (b.kind === "site") {
        const flag = b.flag ? flags[b.flag] : null;
        if (flag && b.values?.includes(flag))
          reasons.push(`${b.label}: ${flag}`);
        continue;
      }
      const limit = limitFor(profile, b, overrides);
      if (!b.factor || limit === undefined || !row.have_data) continue;
      const v = factorValue(row, b.factor);
      if (v !== null && v >= limit)
        reasons.push(
          b.factor === "tide_near_high"
            ? b.label
            : `${b.label} ${Math.round(v * 10) / 10}${b.unit ? ` ${b.unit}` : ""} (limit ${limit})`,
        );
    }
    return { hour: row.hour, blocked: reasons.length > 0, reasons };
  });
}

/** Longest run of clear hours in the working day, at least two hours. Same rule as the report's own work window. */
export function longestWindow(
  results: HourResult[],
  dayStart: number = WORKDAY.start,
  dayEnd: number = WORKDAY.end,
): { start: number; end: number } | null {
  let best: [number, number] | null = null;
  let runStart = -1;
  for (let h = dayStart; h <= dayEnd; h++) {
    const ok = h < dayEnd && results[h] !== undefined && !results[h].blocked;
    if (ok && runStart < 0) runStart = h;
    if (!ok && runStart >= 0) {
      if (!best || h - runStart > best[1] - best[0]) best = [runStart, h];
      runStart = -1;
    }
  }
  return best && best[1] - best[0] >= 2
    ? { start: best[0], end: best[1] }
    : null;
}

/** Hours that are clear for every selected task at once. */
export function combine(results: HourResult[][]): HourResult[] {
  if (!results.length) return [];
  return results[0].map((r, i) => {
    const reasons = results.flatMap((res) => res[i].reasons);
    return {
      hour: r.hour,
      blocked: results.some((res) => res[i].blocked),
      reasons: [...new Set(reasons)],
    };
  });
}
