import { Badge, Panel, PanelHeader, SeverityMark } from "../../components/ui";
import {
  formatReportDate,
  formatSiteTime,
  clockFromHHMM,
  type NextDayReport as Report,
} from "../../lib/nextDayReport";
import { useNotice } from "../../hooks/notice";
import { useSiteFeed } from "../../hooks/useSiteFeed";
import type { Site } from "../../lib/types";
import { AirPanel } from "./AirPanel";
import { FloodPanel } from "./FloodPanel";
import { GapsPanel } from "./GapsPanel";
import { HazardIndexPanel } from "./HazardIndexPanel";
import { HeatPanel } from "./HeatPanel";
import { RoutePanel } from "./RoutePanel";
import { TaskPlanner } from "./TaskPlanner";
import { WeatherPanel } from "./WeatherPanel";
import { WildlifePanel } from "./WildlifePanel";
import { useReport } from "./useReport";
import styles from "./NextDayReport.module.css";

const LEVEL_MARK = { go: null, limits: 2, reschedule: 3 } as const;

function Header({ report, stale }: { report: Report; stale: boolean }) {
  const v = report.verdict;
  const mark = LEVEL_MARK[v.level];
  const tz = report.meta.site.timezone;
  return (
    <section
      className={styles.verdict}
      data-level={v.level}
      aria-labelledby="verdict-title"
    >
      <div className={styles.verdictHead}>
        <h2 id="verdict-title" className={styles.verdictLabel}>
          {mark ? <SeverityMark severity={mark} size={22} /> : null}
          {v.label}
        </h2>
        <span>
          Report for <strong>{formatReportDate(report.meta.for_date)}</strong> ·{" "}
          {report.meta.site.name}
        </span>
        <Badge>
          {report.meta.kind === "morning"
            ? "Morning refresh"
            : "Evening report"}{" "}
          · built {formatSiteTime(report.meta.generated_at, tz)}
        </Badge>
      </div>
      {stale ? (
        <p className={styles.banner} role="status">
          This report is more than 24 hours old. Build a new one before you rely
          on it.
        </p>
      ) : null}
      {v.work_window ? (
        <p style={{ margin: 0 }}>
          Best work window:{" "}
          <strong>
            {clockFromHHMM(v.work_window.start)} to{" "}
            {clockFromHHMM(v.work_window.end)}
          </strong>
          .
        </p>
      ) : (
        <p style={{ margin: 0 }}>
          <strong>No two-hour work window was found.</strong>
        </p>
      )}
      {v.reasons.length ? (
        <ul className={styles.list}>
          {v.reasons.map((r) => (
            <li key={r.code + r.text}>{r.text}</li>
          ))}
        </ul>
      ) : (
        <p className={styles.muted} style={{ margin: 0 }}>
          No limit was reached in the data this report could use.
        </p>
      )}
      <Changes report={report} />
      <p className={styles.small} style={{ margin: 0 }}>
        {v.disclaimer}
      </p>
    </section>
  );
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

/** The 6 PM next-day safety report for one site, read from the files that reports/next-day/run.sh writes. */
export function NextDayReport({ site }: { site: Site }) {
  const eia = site.eia_plant_id;
  const result = useReport(eia);
  const { announce } = useNotice();
  // Open crew reports (mud and wildlife) are drawn on the map next to the report's own layers.
  const feed = useSiteFeed(site.id, (message) => announce(message, true));

  if (!eia)
    return (
      <Panel>
        <PanelHeader title="Next-day report" />
        <p className={styles.muted}>
          This site has no EIA plant id, so no report can be built for it.
        </p>
      </Panel>
    );
  if (result === null)
    return (
      <Panel>
        <p role="status" className={styles.muted}>
          Loading the report…
        </p>
      </Panel>
    );
  if (result.kind === "none")
    return (
      <Panel>
        <PanelHeader title="No report yet" />
        <p className={styles.muted}>
          No next-day report has been built for {site.name}. Run{" "}
          <code>reports/next-day/run.sh build --site {eia}</code>, then reload
          this page.
        </p>
      </Panel>
    );
  if (result.kind === "error")
    return (
      <Panel>
        <PanelHeader title="The report could not be shown" />
        <p role="alert">{result.message}</p>
      </Panel>
    );

  const { report, stale } = result;
  return (
    <div className={styles.stack} id="next-day-report">
      <Header report={report} stale={stale} />
      <div className={styles.cols}>
        <HeatPanel report={report} />
        <WeatherPanel report={report} />
      </div>
      <RoutePanel report={report} crewReports={feed.reports} />
      <TaskPlanner report={report} />
      <div className={styles.cols}>
        <FloodPanel report={report} />
        <div className={styles.stack}>
          <HazardIndexPanel report={report} />
          <AirPanel report={report} />
          <WildlifePanel report={report} crewReports={feed.reports} />
        </div>
      </div>
      <GapsPanel report={report} />
    </div>
  );
}
