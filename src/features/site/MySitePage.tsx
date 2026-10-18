import type { ComponentProps, ReactNode } from "react";
import { IndexTag } from "../../components/ui";
import { useLive } from "../../hooks/useLive";
import { useNotice } from "../../hooks/notice";
import {
  fetchSiteRisk,
  type LightningView,
  type SiteRiskView,
} from "../../lib/monitoring";
import type { Site } from "../../lib/types";
import { StopWorkBanner } from "../alerts/StopWorkBanner";
import { LocationPill } from "../crewtools/CrewTools";
import styles from "./MySitePage.module.css";

const noRisk: SiteRiskView = {
  riskNow: null,
  riskTomorrow: null,
  topDriver: null,
  subscores: {},
  activeAlerts: 0,
};

/**
 * Crew home: the site's map fills the page. A floating card names the site with its
 * hazard index, the stop-work banner sits under it (independent of the map, so it shows
 * even if the map cannot load), and "Report hazard" floats at the bottom right.
 */
export function MySitePage({
  site,
  lightning,
  map,
  overlay,
  location,
  alertCount,
}: {
  site: Site;
  /** The selected site's live lightning state (drives the banner). */
  lightning: LightningView;
  /** The full-height map. */
  map: ReactNode;
  /** Floats over the map pane (the report button and drawer). */
  overlay?: ReactNode;
  location: ComponentProps<typeof LocationPill>["location"];
  /** Active alerts at this site; a link to them shows when there are any. */
  alertCount: number;
}) {
  const { announce } = useNotice();
  const risk = useLive(
    site.id,
    ["site_risk", "site_subscores"],
    fetchSiteRisk,
    noRisk,
    30000,
    (m) => announce(m, true),
  );
  return (
    <div className={styles.page}>
      <div className={styles.map}>{map}</div>
      <div className={styles.float}>
        <header className={styles.card}>
          <h1 className={styles.name}>{site.name}</h1>
          <IndexTag value={risk.data.riskNow} showLabel />
        </header>
        <StopWorkBanner siteName={site.name} lightning={lightning} />
        {alertCount > 0 ? (
          <a className={styles.alertChip} href="#/alerts">
            {alertCount} active {alertCount === 1 ? "alert" : "alerts"}
          </a>
        ) : null}
        <LocationPill location={location} />
      </div>
      {overlay}
    </div>
  );
}
