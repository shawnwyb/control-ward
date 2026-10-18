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

/** Season table and notes on hidden coordinates, for the fold in the wildlife tile. */
export function WildlifeDetails({ report }: { report: NextDayReport }) {
  const w = report.wildlife;
  if (!w || w.status !== "ok" || !w.groups) return null;
  const month = MONTHS[(w.groups[0]?.season.month ?? 1) - 1];
  return (
    <>
      <p className={styles.small}>
        Public sightings within {w.radius_km} km in the last {w.days} days, and
        how many sightings people usually report in {month} within{" "}
        {w.season_radius_km} km.
      </p>
      <div className={styles.tableWrap}>
        <table className={`${styles.table} ${styles.wrap}`}>
          <caption className={styles.small}>
            Sightings reported to iNaturalist. These show where people looked as
            well as where animals are.
          </caption>
          <thead>
            <tr>
              <th scope="col">Group</th>
              <th scope="col">Sightings in the last {w.days} days</th>
              <th scope="col">Reports in past {month}s</th>
              <th scope="col" className={styles.left}>
                Compared with a usual month
              </th>
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
                <td className={styles.left}>{g.season.label}</td>
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
    </>
  );
}
