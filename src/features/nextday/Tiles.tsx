import { Icon, Panel, PanelHeader } from "../../components/ui";
import { formatHour, type NextDayReport } from "../../lib/nextDayReport";
import type { Report } from "../../lib/types";
import { Abbr } from "./Abbr";
import { AboutData } from "./AboutData";
import {
  airSummary,
  leveeLine,
  riverLine,
  tideSummary,
  wildlifeChips,
} from "./briefing";
import { FloodDetails } from "./FloodPanel";
import { WildlifeDetails } from "./WildlifePanel";
import styles from "./NextDayReport.module.css";

/** Tide, river and levees in four lines. The two caveats that change a decision stay visible; the detail is folded. */
export function TideTile({ report }: { report: NextDayReport }) {
  const { tide, river, levees } = report.flood;
  const sum = tideSummary(tide, report.meta.for_date);
  const surge = sum ? tide.caveats?.[0] : undefined;
  const leveeNote = levees.status === "ok" ? levees.caveats?.at(-1) : undefined;
  return (
    <Panel id="flood" className={styles.tile} aria-labelledby="flood-title">
      <PanelHeader title="Tide and flood" titleId="flood-title" />
      {sum ? (
        <>
          <p className={styles.tileHead}>
            {sum.highs.length ? (
              <>
                <strong>High tide:</strong>{" "}
                {sum.highs.map((h) => `${h.time} (${h.ft} ft)`).join(" and ")}{" "}
                above{" "}
                <Abbr long="mean lower low water: the average of the lowest tide each day">
                  MLLW
                </Abbr>
              </>
            ) : (
              "No high tide falls on the report day."
            )}
          </p>
          <p className={styles.tileAction}>
            <Icon name="alert" size={16} />
            <span>
              <strong>Within one hour of high water:</strong>{" "}
              {sum.windows.length ? sum.windows.join("; ") : "none on this day"}
            </span>
          </p>
        </>
      ) : (
        <p className={styles.muted}>{tide.reason ?? "No tide data."}</p>
      )}
      <ul className={styles.tileLines}>
        <li>{riverLine(river)}</li>
        <li>{leveeLine(levees)}</li>
      </ul>
      {surge ? <p className={styles.small}>{surge}</p> : null}
      {leveeNote ? <p className={styles.small}>{leveeNote}</p> : null}
      <AboutData label="Tide, river and levee details">
        <FloodDetails report={report} />
      </AboutData>
    </Panel>
  );
}

/** One headline and one line. The hourly row appears in the work schedule only when the day reaches the sensitive-groups band. */
export function AirTile({ report }: { report: NextDayReport }) {
  const air = report.air;
  const a = airSummary(air);
  return (
    <Panel id="air" className={styles.tile} aria-labelledby="air-title">
      <PanelHeader title="Air and smoke" titleId="air-title" />
      {a && air.peak ? (
        <>
          <p className={styles.tileHead}>
            <strong>Peak AQI {a.peak}</strong> ({a.band}) at{" "}
            {formatHour(air.peak.hour)}
          </p>
          <p className={styles.muted}>
            {a.low !== null && a.low !== a.peak
              ? `${a.low} to ${a.peak} across the workday`
              : `${a.peak} across the workday`}{" "}
            · {a.fires}
          </p>
          {a.hourlyRow ? (
            <p className={styles.banner}>
              {air.peak.band.meaning} The hourly values are in the work
              schedule.
            </p>
          ) : null}
        </>
      ) : (
        <p className={styles.muted}>
          {air.reason ?? "No air quality forecast is available."}
        </p>
      )}
      {(air.alerts ?? []).length ? (
        <ul className={styles.plain}>
          {(air.alerts ?? []).map((al) => (
            <li key={al.event + al.starts}>
              <strong>{al.event}.</strong> {al.headline}
            </li>
          ))}
        </ul>
      ) : null}
    </Panel>
  );
}

/** Only the groups with recent sightings, as chips. The "no sightings is not no animals" caveat stays visible. */
export function WildlifeTile({
  report,
  crewReports,
}: {
  report: NextDayReport;
  crewReports: Report[];
}) {
  const w = report.wildlife;
  const crew = crewReports.filter((r) => r.type === "wildlife" && r.is_active);
  const ok = Boolean(w && w.status === "ok" && w.groups);
  const chips = wildlifeChips(w);
  return (
    <Panel
      id="wildlife"
      className={styles.tile}
      aria-labelledby="wildlife-title"
    >
      <PanelHeader title="Wildlife" titleId="wildlife-title" />
      {ok && w ? (
        chips.length ? (
          <ul
            className={styles.chips}
            aria-label={`Sightings in the last ${w.days} days by group`}
          >
            {chips.map((c) => (
              <li key={c.label}>
                {c.label} <b>{c.recent}</b>
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.muted}>
            No public sightings within {w.radius_km} km in the last {w.days}{" "}
            days.
          </p>
        )
      ) : (
        <p className={styles.muted}>
          {w?.reason ?? "No wildlife data in this report."}
        </p>
      )}
      <p>
        <strong>Crew reports on this site:</strong>{" "}
        {crew.length
          ? `${crew.length} open wildlife report(s). See the map.`
          : "no open wildlife reports."}
      </p>
      <p>Check banks and flooded ruts before entry.</p>
      {ok && w ? <p className={styles.small}>{(w.caveats ?? [])[1]}</p> : null}
      {ok ? (
        <AboutData label="Sightings by group">
          <WildlifeDetails report={report} />
        </AboutData>
      ) : null}
    </Panel>
  );
}
