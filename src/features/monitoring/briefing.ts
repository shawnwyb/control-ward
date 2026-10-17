import type { Briefing } from "../../lib/types";

export type BriefingHazard = {
  hazard: string;
  metric: string;
  forecast: number;
  unit: string;
  level: string;
};

export type BriefingView = {
  forDate: string;
  hazards: BriefingHazard[];
  predictedRisk?: number;
  topDriver?: string;
  openCrewHazards: number;
  smokeNote?: string;
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Reads a briefing's JSON defensively: a missing or odd field is skipped, never a crash. */
export function parseBriefing(briefing: Briefing): BriefingView {
  const content = isObject(briefing.content) ? briefing.content : {};
  const hazards: unknown[] = Array.isArray(content.hazards)
    ? content.hazards
    : [];
  return {
    forDate: briefing.for_date,
    hazards: hazards.filter(isObject).flatMap((h) =>
      typeof h.metric === "string" && typeof h.forecast === "number"
        ? [
            {
              hazard: String(h.hazard ?? ""),
              metric: h.metric,
              forecast: h.forecast,
              unit: String(h.unit ?? ""),
              level: String(h.level ?? "normal"),
            },
          ]
        : [],
    ),
    predictedRisk:
      typeof content.predicted_risk === "number"
        ? content.predicted_risk
        : undefined,
    topDriver:
      typeof content.top_driver === "string" ? content.top_driver : undefined,
    openCrewHazards: Array.isArray(content.open_crew_hazards)
      ? content.open_crew_hazards.length
      : 0,
    smokeNote:
      typeof content.smoke_note === "string" ? content.smoke_note : undefined,
  };
}

/** Tone for a briefing level word such as "caution", "danger" or "stop heavy work". */
export function levelTone(level: string): "normal" | "notice" | "severe" {
  if (level === "normal" || level === "info") return "normal";
  if (level === "caution") return "notice";
  return "severe";
}
