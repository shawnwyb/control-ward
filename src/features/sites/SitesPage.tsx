import { useCallback, useState, type ReactNode } from "react";
import { cx } from "../../components/ui";
import { useLive } from "../../hooks/useLive";
import { useNotice } from "../../hooks/notice";
import { useSiteOverviews } from "../../hooks/useSiteOverviews";
import {
  fetchSiteRisk,
  type LightningView,
  type SiteRiskView,
  type SiteSummary,
} from "../../lib/monitoring";
import type { Report, Site } from "../../lib/types";
import { StopWorkBanner } from "../alerts/StopWorkBanner";
import { SiteDetail } from "./SiteDetail";
import { SitesTable, type SitesView } from "./SitesTable";
import styles from "./SitesPage.module.css";

const noRisk: SiteRiskView = {
  riskNow: null,
  riskTomorrow: null,
  topDriver: null,
  subscores: {},
  activeAlerts: 0,
};

/**
 * Supervisor home: the ranked sites table beside the live map, the stop-work banner over
 * the map, and the selected site's detail under the table.
 */
export function SitesPage({
  site,
  reports,
  crewTerm,
  lightning,
  onSelectSite,
  renderMap,
  children,
}: {
  site: Site;
  reports: Report[];
  crewTerm: number;
  /** The selected site's live lightning state (drives the banner). */
  lightning: LightningView;
  /** A row was chosen: select that site. */
  onSelectSite: (siteId: string) => void;
  /** The map, given every site's summary for the pins and the banner to float over it. */
  renderMap: (sites: SiteSummary[], banner: ReactNode) => ReactNode;
  /** Under the detail (the report form, until it moves into a drawer). */
  children?: ReactNode;
}) {
  const { announce } = useNotice();
  const onError = useCallback((m: string) => announce(m, true), [announce]);
  // Every site the user can see; kept across site switches (this page is not keyed by site).
  const overview = useSiteOverviews(onError);
  const risk = useLive(
    site.id,
    ["site_risk", "site_subscores"],
    fetchSiteRisk,
    noRisk,
    30000,
    onError,
  );
  const [view, setView] = useState<SitesView>("table");
  return (
    <div className={cx(styles.page, view === "map" && styles.mapView)}>
      <SitesTable
        className={styles.table}
        sites={overview.sites}
        selectedId={site.id}
        onSelect={onSelectSite}
        view={view}
        onViewChange={setView}
        loaded={overview.loaded}
        error={overview.error}
      />
      <div className={styles.map}>
        {renderMap(
          overview.sites,
          <StopWorkBanner siteName={site.name} lightning={lightning} />,
        )}
      </div>
      <div className={styles.detail}>
        <SiteDetail
          siteName={site.name}
          risk={risk.data}
          loaded={risk.loaded}
          openHazards={reports.filter((r) => r.is_active).length}
          crewTerm={crewTerm}
        />
        {children}
      </div>
    </div>
  );
}
