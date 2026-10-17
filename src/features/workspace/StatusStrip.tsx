import { Stat, StatusDot } from "../../components/ui";
import {
  connectionLabels,
  type ConnectionState,
} from "../../hooks/useSiteFeed";
import type { SiteMetrics, SiteOverview } from "../../lib/types";
import styles from "./StatusStrip.module.css";

type Props = {
  metrics: SiteMetrics;
  loaded: boolean;
  connection: ConnectionState;
  /** Backend risk score for the site. Absent until it has been scored. */
  overview?: SiteOverview;
  overviewLoaded: boolean;
};

const score = (value: number | null | undefined) =>
  typeof value === "number" ? value.toFixed(1) : undefined;

export function StatusStrip({
  metrics,
  loaded,
  connection,
  overview,
  overviewLoaded,
}: Props) {
  const dash = "—";
  const now = score(overview?.risk_now);
  const tomorrow = score(overview?.risk_tomorrow);
  return (
    <section className={styles.strip} aria-label="Site status">
      <Stat
        label="Site risk"
        valueId="metric-site-risk"
        value={overviewLoaded ? (now ?? dash) : dash}
        note="of 10"
        footnote={tomorrow ? `Tomorrow ${tomorrow}` : undefined}
        title="Site risk now, out of 10. It combines live weather, heat, lightning, flood, wildfire and soil readings with crew reports."
      />
      <Stat
        label="Open hazards"
        valueId="metric-count"
        value={loaded ? String(metrics.openReports) : dash}
        title="Active hazards reported by your crew at this site"
      />
      <Stat
        label="Crew risk"
        valueId="metric-risk"
        value={loaded ? metrics.crewRisk.toFixed(2) : dash}
        note="of 2"
        title="Crew risk contribution, out of 2 maximum"
      />
      <Stat
        label="Wildlife"
        valueId="metric-wildlife"
        value={loaded ? metrics.wildlifeSubscore.toFixed(1) : dash}
        note="of 10"
        title="Wildlife subscore, out of 10, age adjusted"
      />
      {overview?.top_driver ? (
        <p className={styles.driver} id="site-risk-driver">
          {overview.top_driver}
        </p>
      ) : null}
      <div className={styles.connection} title="Shared with your site team">
        <span id="connection" className={styles.status}>
          <StatusDot
            state={
              connection === "live"
                ? "live"
                : connection === "unavailable"
                  ? "off"
                  : "pending"
            }
          />
          {connectionLabels[connection]}
        </span>
      </div>
    </section>
  );
}
