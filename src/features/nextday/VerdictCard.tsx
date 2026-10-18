import { Badge, Panel, SeverityMark } from "../../components/ui";
import {
  clockFromHHMM,
  formatReportDate,
  formatSiteTime,
  type NextDayReport as Report,
} from "../../lib/nextDayReport";
import { AboutData } from "./AboutData";
import { verdictBullets } from "./briefing";
import { blockedHours, WORKDAY } from "./taskPlan";
import styles from "./NextDayReport.module.css";

const LEVEL_MARK = { go: null, limits: 2, reschedule: 3 } as const;

/**
 * The best work window comes from weather limits only. When the first task profile (heavy equipment) is blocked for
 * the whole workday by a site-wide flag, such as routes at hold, say so right under the window.
 */
function weatherOnlyNote(report: Report): string | null {
  const t = report.tasks;
  const first = t?.profiles[0];
  if (!t || t.status !== "ok" || !first || !report.verdict.work_window)
    return null;
  const day = blockedHours(first, report.hourly, t.site_flags).filter(
    (r) => r.hour >= WORKDAY.start && r.hour < WORKDAY.end,
  );
  if (!day.length || !day.every((r) => r.blocked)) return null;
  const fired = first.blockers.filter((b) => {
    const flag = b.kind === "site" && b.flag ? t.site_flags[b.flag] : null;
    return flag && b.values?.includes(flag);
  });
  if (!fired.length) return null;
  return `Weather only. ${first.label} are blocked all day: ${fired
    .map((b) => b.label.toLowerCase())
    .join(", ")}. See the work schedule.`;
}

/** What moved since the previous report for the same date (a 5 AM rebuild against the 6 PM report). */
function Changes({ report }: { report: Report }) {
  const c = report.changes;
  if (!c || c.status !== "ok") return null;
  const when = formatSiteTime(c.since!, report.meta.site.timezone);
  return (
    <div>
      <h3 className={styles.sub} style={{ margin: "0 0 var(--space-2)" }}>
        Changed since the {c.since_kind === "morning" ? "morning" : "evening"}{" "}
        report ({when})
      </h3>
      {c.items.length ? (
        <ul className={styles.list}>
          {c.items.map((i) => (
            <li key={i.text}>{i.text}</li>
          ))}
        </ul>
      ) : (
        <p className={styles.muted} style={{ margin: 0 }}>
          Nothing material changed.
        </p>
      )}
    </div>
  );
}

export function VerdictCard({
  report,
  stale,
}: {
  report: Report;
  stale: boolean;
}) {
  const v = report.verdict;
  const mark = LEVEL_MARK[v.level];
  const tz = report.meta.site.timezone;
  const bullets = verdictBullets(report);
  const note = weatherOnlyNote(report);
  return (
    <Panel
      id="verdict"
      className={`${styles.heroCard} ${styles.verdict}`}
      data-level={v.level}
      aria-labelledby="verdict-title"
    >
      <h2 id="verdict-title" className={styles.verdictLabel}>
        {mark ? <SeverityMark severity={mark} size={22} /> : null}
        {v.label}
      </h2>
      <p className={styles.muted}>
        Report for <strong>{formatReportDate(report.meta.for_date)}</strong> ·{" "}
        {report.meta.site.name}
      </p>
      <Badge>
        {report.meta.kind === "morning" ? "Morning refresh" : "Evening report"}{" "}
        · built {formatSiteTime(report.meta.generated_at, tz)}
      </Badge>
      {stale ? (
        <p className={styles.banner} role="status">
          This report is more than 24 hours old. Build a new one before you rely
          on it.
        </p>
      ) : null}
      {v.work_window ? (
        <p className={styles.window}>
          Best window{" "}
          <strong>
            {clockFromHHMM(v.work_window.start)} to{" "}
            {clockFromHHMM(v.work_window.end)}
          </strong>{" "}
          <span className={styles.muted}>(weather limits only)</span>
        </p>
      ) : (
        <p className={styles.window}>
          <strong>No two-hour work window was found.</strong>
        </p>
      )}
      {bullets.length ? (
        <ul className={styles.bullets}>
          {bullets.map((b) => (
            <li key={b.text}>
              {b.text}
              {b.detail ? (
                <span className={styles.muted}> · {b.detail}</span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.muted}>
          No limit was reached in the data this report could use.
        </p>
      )}
      <p className={styles.small}>{report.meta.label || v.disclaimer}</p>
      <AboutData label="Full reasons and changes">
        {v.reasons.length ? (
          <ul className={styles.list}>
            {v.reasons.map((r) => (
              <li key={r.code + r.text}>{r.text}</li>
            ))}
          </ul>
        ) : null}
        {note ? <p className={styles.banner}>{note}</p> : null}
        <Changes report={report} />
        <p className={styles.small}>{v.disclaimer}</p>
      </AboutData>
    </Panel>
  );
}
