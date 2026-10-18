import { useState } from "react";
import { Button, SeverityTag } from "../../components/ui";
import { milesText, routeLabel, type FlaggedRoute } from "./routesList";
import styles from "./NextDayReport.module.css";

const SHORT_LIST = 5;

/**
 * The flagged roads as a table, worst first. It is also the text alternative to the map, so the answer does not
 * depend on the map. Picking a row highlights that road on the map and zooms to it.
 */
export function FlaggedRoutes({
  routes,
  failed,
  equipmentName,
  selected,
  onSelect,
}: {
  /** null while the route file loads. */
  routes: FlaggedRoute[] | null;
  failed: boolean;
  equipmentName: string;
  selected: number | null;
  onSelect: (osmId: number | null) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const picked = routes?.find((r) => r.osmId === selected);
  if (failed) return null;
  if (routes === null)
    return <p className={styles.muted}>Loading the route list…</p>;
  if (!routes.length)
    return (
      <p className={styles.muted}>No route is flagged for {equipmentName}.</p>
    );
  const shown = showAll ? routes : routes.slice(0, SHORT_LIST);
  return (
    <section aria-labelledby="flagged-title" className={styles.flagged}>
      <h3 id="flagged-title" className={styles.subFirst}>
        Flagged routes ({routes.length})
      </h3>
      <p className={styles.small}>
        For {equipmentName}. Hold before inspect, longest flagged stretch first.
        Each route is one road from OpenStreetMap.
      </p>
      <div className={styles.routeTableWrap}>
        <table
          className={`${styles.table} ${styles.wrap}`}
          aria-labelledby="flagged-title"
        >
          <thead>
            <tr>
              <th scope="col" className={styles.left}>
                Route
              </th>
              <th scope="col">Flagged</th>
              <th scope="col" className={styles.left}>
                Status
              </th>
              <th scope="col">Predicted rut</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr
                key={r.osmId}
                data-selected={selected === r.osmId ? "true" : undefined}
              >
                <th scope="row" className={styles.left}>
                  <button
                    type="button"
                    className={styles.routeBtn}
                    aria-pressed={selected === r.osmId}
                    onClick={() =>
                      onSelect(selected === r.osmId ? null : r.osmId)
                    }
                  >
                    {routeLabel(r)}
                  </button>
                </th>
                <td>{milesText(r.flaggedFeet)}</td>
                <td className={styles.left}>
                  {r.worstFlag === 2 ? (
                    <SeverityTag severity={3}>Hold</SeverityTag>
                  ) : (
                    <SeverityTag severity={2}>Inspect</SeverityTag>
                  )}
                </td>
                <td>
                  {r.worstRutIn !== null
                    ? `${r.worstRutIn.toFixed(1)} in`
                    : "-"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {routes.length > SHORT_LIST ? (
        <Button onClick={() => setShowAll(!showAll)}>
          {showAll
            ? "Show the worst 5 only"
            : `Show all ${routes.length} routes`}
        </Button>
      ) : null}
      <p className="sr-only" aria-live="polite">
        {picked ? `${routeLabel(picked)} is highlighted on the map.` : ""}
      </p>
    </section>
  );
}
