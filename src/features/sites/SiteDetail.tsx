import { RiskPanel } from "../dashboard/RiskPanel";
import type { SiteRiskView } from "../../lib/monitoring";
import { ConditionsCard } from "../site/ConditionsCard";
import type { LightningView } from "../../lib/monitoring";
import type { Site } from "../../lib/types";
import styles from "./SiteDetail.module.css";

/** The selected site under the table: index now and tomorrow, open hazards, subscore bars. */
export function SiteDetail({
  site,
  lightning,
  risk,
  loaded,
  openHazards,
  crewTerm,
}: {
  site: Site;
  lightning: LightningView;
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
      <p className={styles.site}>{site.name}</p>
      <h3 className={styles.sub}>Conditions</h3>
      <ConditionsCard site={site} lightning={lightning} />
      <RiskPanel
        site={site}
        lightning={lightning}
        risk={risk}
        loaded={loaded}
        openHazards={openHazards}
        crewTerm={crewTerm}
      />
    </section>
  );
}
