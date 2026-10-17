import { useMemo } from "react";
import { Button, Panel, StatusTag, cx } from "../../components/ui";
import type { Briefing } from "../../lib/types";
import { levelTone, parseBriefing } from "./briefing";
import styles from "./BriefingPanel.module.css";

type Props = {
  briefing: Briefing;
  read: boolean;
  onMarkRead: () => void;
  className?: string;
};

const day = new Intl.DateTimeFormat(undefined, {
  weekday: "long",
  month: "short",
  day: "numeric",
});

/** "2026-10-18" is a calendar date, not a moment: build it in local time so it can't slip a day. */
function formatForDate(forDate: string): string {
  const [year, month, date] = forDate.split("-").map(Number);
  return day.format(new Date(year, month - 1, date));
}

function formatValue(value: number, unit: string): string {
  if (unit === "F") return `${value}°F`;
  if (unit === "%") return `${value}%`;
  return `${value} ${unit}`.trim();
}

/** The evening briefing for the next day. Open until you mark it read. */
export function BriefingPanel({
  briefing,
  read,
  onMarkRead,
  className,
}: Props) {
  const view = useMemo(() => parseBriefing(briefing), [briefing]);
  return (
    <Panel className={className} aria-labelledby="briefing-title">
      <details className={styles.details} open={!read}>
        <summary className={styles.summary}>
          <span className={styles.summaryText}>
            <h2 id="briefing-title" className={styles.title}>
              Tomorrow’s briefing
            </h2>
            <span className={styles.date}>{formatForDate(view.forDate)}</span>
          </span>
          <StatusTag>{read ? "Read" : "New"}</StatusTag>
        </summary>
        <div className={styles.body}>
          {view.predictedRisk !== undefined ? (
            <p>
              <strong>
                Predicted site risk: {view.predictedRisk.toFixed(1)} of 10.
              </strong>{" "}
              {view.topDriver}
            </p>
          ) : null}
          {view.hazards.length ? (
            <ul className={styles.hazards}>
              {view.hazards.map((hazard) => (
                <li
                  key={`${hazard.hazard}:${hazard.metric}`}
                  className={styles.hazard}
                >
                  <span className={styles.metric}>
                    {hazard.metric[0].toUpperCase()}
                    {hazard.metric.slice(1)}
                  </span>
                  <span className={styles.value}>
                    {formatValue(hazard.forecast, hazard.unit)}
                  </span>
                  <span
                    className={cx(
                      styles.level,
                      styles[levelTone(hazard.level)],
                    )}
                  >
                    {hazard.level}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p>No forecast hazards were recorded for this site.</p>
          )}
          {view.smokeNote ? <p>{view.smokeNote}</p> : null}
          <p>
            {view.openCrewHazards
              ? `${view.openCrewHazards} open crew ${view.openCrewHazards === 1 ? "hazard" : "hazards"} at this site.`
              : "No open crew hazards at this site."}
          </p>
          {read ? null : (
            <Button variant="secondary" onClick={onMarkRead}>
              Mark as read
            </Button>
          )}
        </div>
      </details>
    </Panel>
  );
}
