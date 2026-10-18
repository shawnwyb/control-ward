import { Panel, PanelHeader } from "../../components/ui";
import type { Report } from "../../lib/types";
import type { NextDayReport } from "../../lib/nextDayReport";
import styles from "./NextDayReport.module.css";

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

export function WildlifePanel({
  report,
  crewReports,
}: {
  report: NextDayReport;
  crewReports: Report[];
}) {
  const w = report.wildlife;
  const crew = crewReports.filter((r) => r.type === "wildlife" && r.is_active);
  if (!w || w.status !== "ok" || !w.groups)
    return (
      <Panel id="wildlife" aria-labelledby="wildlife-title">
        <PanelHeader title="Wildlife" titleId="wildlife-title" />
        <p className={styles.muted}>
          {w?.reason ?? "No wildlife data in this report."}
        </p>
        <p>
          <strong>Crew reports on this site:</strong>{" "}
          {crew.length
            ? `${crew.length} open wildlife report(s). See the map.`
            : "no open wildlife reports."}
        </p>
      </Panel>
    );
  const month = MONTHS[(w.groups[0]?.season.month ?? 1) - 1];
  return (
    <Panel id="wildlife" aria-labelledby="wildlife-title">
      <PanelHeader
        title="Wildlife"
        titleId="wildlife-title"
        description={`Public sightings within ${w.radius_km} km in the last ${w.days} days, and how many sightings people usually report in ${month} within ${w.season_radius_km} km.`}
      />
      <p>
        <strong>Crew reports on this site:</strong>{" "}
        {crew.length
          ? `${crew.length} open wildlife report(s). See the map.`
          : "no open wildlife reports."}
      </p>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <caption className={styles.small}>
            Sightings reported to iNaturalist. These show where people looked as
            well as where animals are.
          </caption>
          <thead>
            <tr>
              <th scope="col">Group</th>
              <th scope="col">Sightings, last {w.days} days</th>
              <th scope="col">{month} reports in past years</th>
              <th scope="col">Usual for {month}</th>
            </tr>
          </thead>
          <tbody>
            {w.groups.map((g) => (
              <tr key={g.id}>
                <th scope="row">{g.label}</th>
                <td>{g.recent}</td>
                <td>
                  {g.season.this_month} of {g.season.year_total}
                </td>
                <td style={{ whiteSpace: "normal", textAlign: "left" }}>
                  {g.season.label}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {w.obscured_not_drawn ? (
        <p className={styles.small}>
          {w.obscured_not_drawn} recent sighting(s) have hidden coordinates, so
          they are counted but not drawn.
        </p>
      ) : null}
      <ul className={styles.list}>
        {(w.caveats ?? []).map((c) => (
          <li key={c} className={styles.muted}>
            {c}
          </li>
        ))}
      </ul>
      {w.source ? (
        <p className={styles.small}>
          Source: <a href={w.source.url}>{w.source.name}</a>. {w.source.note}
        </p>
      ) : null}
    </Panel>
  );
}
