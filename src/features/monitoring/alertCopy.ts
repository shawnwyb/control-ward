import { timeAgo } from "../../lib/format";
import type { Alert, AlertKind, AlertLevel } from "../../lib/types";
import type { IconName } from "../../components/ui";

/*
 * Plain-language wording for backend alerts. Every number comes from the
 * alert's payload. If a value is missing the sentence leaves it out; it never
 * guesses. Payload shapes are defined in docs/api-contract.md and
 * supabase/migrations/*rules_engine.sql.
 */

export const levelLabels: Record<AlertLevel, string> = {
  stop_work: "Stop work",
  warning: "Warning",
  info: "Notice",
};

export const kindIcons: Record<AlertKind, IconName> = {
  lightning: "lightning",
  heat: "heat",
  flood: "washout",
  wildfire: "wildfire",
  other: "alert",
};

const number = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;
const text = (value: unknown): string | undefined =>
  typeof value === "string" && value ? value : undefined;
const sentences = (...parts: (string | undefined | false)[]) =>
  parts.filter(Boolean).join(" ");

export type AlertText = {
  title: string;
  detail: string;
  /** Lightning only: when the stop-work countdown ends, if no new strike. */
  clearAt?: Date;
};

export function describeAlert(alert: Alert, now = Date.now()): AlertText {
  const p = (alert.payload ?? {}) as Record<string, unknown>;

  switch (alert.kind as AlertKind) {
    case "lightning": {
      const miles = number(p.distance_mi);
      const struck = text(p.last_strike_at);
      const clearAt = text(p.clear_at);
      const where = miles !== undefined ? `${miles} mi away` : undefined;
      const when = struck ? timeAgo(struck, now) : undefined;
      const last =
        where && when
          ? `Last strike ${where}, ${when}.`
          : where || when
            ? `Last strike ${where ?? when}.`
            : undefined;
      return {
        title: "Lightning nearby",
        detail: sentences(last, "A new strike restarts the countdown."),
        clearAt: clearAt ? new Date(clearAt) : undefined,
      };
    }
    case "heat": {
      const wbgt = number(p.wbgt_f);
      const heatIndex = number(p.heat_index_f);
      const tier = text(p.tier);
      return {
        title: "High heat",
        detail: sentences(
          wbgt !== undefined && `WBGT ${wbgt}°F.`,
          wbgt === undefined &&
            heatIndex !== undefined &&
            `Heat index ${heatIndex}°F.`,
          tier && `${tier[0].toUpperCase()}${tier.slice(1)}.`,
        ),
      };
    }
    case "flood": {
      const rain = number(p.rain_overnight_mm);
      const stage = number(p.gauge_stage_ft);
      return {
        title: "Flood risk",
        detail: sentences(
          p.nws_flood_warning === true &&
            "The National Weather Service has issued a flood warning.",
          stage !== undefined && `River gauge reads ${stage} ft.`,
          rain !== undefined && `${rain} mm of rain fell overnight.`,
        ),
      };
    }
    case "wildfire": {
      const nearest = number(p.nearest_fire_mi);
      const within = number(p.fires_within_25mi);
      return {
        title: "Wildfire nearby",
        detail: sentences(
          nearest !== undefined && `Nearest active fire is ${nearest} mi away.`,
          within !== undefined && `${within} within 25 mi.`,
          text(p.smoke_note),
        ),
      };
    }
    default: {
      const severity = number(p.nws_alert_severity);
      const gust = number(p.wind_gust_mph);
      return {
        title: "Severe weather",
        detail: sentences(
          severity !== undefined &&
            `National Weather Service alert severity ${severity} of 4.`,
          gust !== undefined && `Wind gusts up to ${gust} mph.`,
        ),
      };
    }
  }
}

/** Most urgent first; within a level, newest first. */
export function sortAlerts(alerts: Alert[]): Alert[] {
  const rank: Record<string, number> = { stop_work: 0, warning: 1, info: 2 };
  return [...alerts].sort(
    (a, b) =>
      (rank[a.level] ?? 3) - (rank[b.level] ?? 3) ||
      b.created_at.localeCompare(a.created_at),
  );
}
