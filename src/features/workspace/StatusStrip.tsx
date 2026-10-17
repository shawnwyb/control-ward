import { Stat, StatusDot } from "../../components/ui";
import {
  connectionLabels,
  type ConnectionState,
} from "../../hooks/useSiteFeed";
import type { SiteMetrics } from "../../lib/types";
import styles from "./StatusStrip.module.css";

type Props = {
  metrics: SiteMetrics;
  loaded: boolean;
  connection: ConnectionState;
};

export function StatusStrip({ metrics, loaded, connection }: Props) {
  const dash = "—";
  return (
    <section className={styles.strip} aria-label="Site crew metrics">
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
