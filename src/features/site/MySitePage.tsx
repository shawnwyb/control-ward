import { useState, type ComponentProps, type ReactNode } from "react";
import { Icon, IndexTag } from "../../components/ui";
import { useLive } from "../../hooks/useLive";
import { useNotice } from "../../hooks/notice";
import {
  fetchSiteRisk,
  type LightningView,
  type SiteRiskView,
  type Subscores,
} from "../../lib/monitoring";
import { explainIndex } from "../../lib/explain";
import { hazardInfo } from "../sites/hazards";
import type { Site } from "../../lib/types";
import { StopWorkBanner } from "../alerts/StopWorkBanner";
import { LocationPill } from "../crewtools/CrewTools";
import { ConditionsCard } from "./ConditionsCard";
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
  crewTerm,
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
  /** Points the open crew reports add to the index, out of 2. */
  crewTerm: number;
}) {
  const { announce } = useNotice();
  const [open, setOpen] = useState(
    () => typeof window === "undefined" || window.innerWidth >= 1024,
  );
  const risk = useLive(
    site.id,
    ["site_risk", "site_subscores"],
    fetchSiteRisk,
    noRisk,
    30000,
    (m) => announce(m, true),
  );
  const worst = (
    Object.entries(risk.data.subscores) as [keyof Subscores, number][]
  )
    .filter(([key, v]) => key in hazardInfo && typeof v === "number")
    .sort((a, b) => b[1] - a[1])[0];
  return (
    <div className={styles.page}>
      <div className={styles.map}>{map}</div>
      <div className={styles.float}>
        <header className={styles.card}>
          <h1 className={styles.name}>{site.name}</h1>
          <IndexTag value={risk.data.riskNow} showLabel />
          {risk.loaded && risk.data.riskNow !== null ? (
            <p id="risk-now-explain" className={styles.why}>
              {explainIndex(
                risk.data.riskNow,
                worst
                  ? { name: hazardInfo[worst[0]].name, score: worst[1] }
                  : null,
                crewTerm,
              )}
            </p>
          ) : null}
        </header>
        <StopWorkBanner siteName={site.name} lightning={lightning} />
        {alertCount > 0 ? (
          <a className={styles.alertChip} href="#/alerts">
            {alertCount} active {alertCount === 1 ? "alert" : "alerts"}
          </a>
        ) : null}
        <LocationPill location={location} />
        <section className={styles.conditions} aria-label="Site conditions">
          <button
            type="button"
            className={styles.toggle}
            aria-expanded={open}
            aria-controls="conditions-body"
            onClick={() => setOpen((o) => !o)}
          >
            <Icon name="rain" size={16} />
            Conditions
            <Icon
              name="chevron"
              size={14}
              className={open ? styles.chevOpen : undefined}
            />
          </button>
          <div id="conditions-body" hidden={!open} className={styles.body}>
            <ConditionsCard
              site={site}
              lightning={lightning}
              subscores={risk.data.subscores}
              subscoresLoaded={risk.loaded}
            />
          </div>
        </section>
      </div>
      {overlay}
    </div>
  );
}
