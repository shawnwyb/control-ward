import { RiskPanel } from "../dashboard/RiskPanel";
import type { SiteRiskView } from "../../lib/monitoring";
import styles from "./SiteDetail.module.css";

/** The selected site under the table: index now and tomorrow, open hazards, subscore bars. */
export function SiteDetail({
  siteName,
  risk,
  loaded,
  openHazards,
  crewTerm,
}: {
  siteName: string;
  risk: SiteRiskView;
  loaded: boolean;
  openHazards: number;
  crewTerm: number;
}) {
  return (
    <section className={styles.card} aria-labelledby="site-detail-title">
      <h2 id="site-detail-title" className={styles.title}>
        Hazard detail
      </h2>
      <p className={styles.site}>{siteName}</p>
      <RiskPanel
        risk={risk}
        loaded={loaded}
        openHazards={openHazards}
        crewTerm={crewTerm}
      />
    </section>
  );
}
