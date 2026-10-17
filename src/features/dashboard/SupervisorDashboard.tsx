import { useCallback, useState } from "react";
import { useLive } from "../../hooks/useLive";
import { useNotice } from "../../hooks/notice";
import {
  fetchAlerts,
  fetchLightning,
  fetchSiteRisk,
  type AlertRow,
  type CrewMember,
  type LightningView,
  type SiteRiskView,
} from "../../lib/monitoring";
import type { Report } from "../../lib/types";
import { AlertsSection } from "./AlertsSection";
import { BriefingPanel } from "./BriefingPanel";
import { CrewPanel } from "./CrewPanel";
import styles from "./Dashboard.module.css";
import { PushComposer } from "./PushComposer";
import { RiskPanel } from "./RiskPanel";
import { SectionNav } from "./SectionNav";

const noRisk: SiteRiskView = {
  riskNow: null,
  riskTomorrow: null,
  topDriver: null,
  subscores: {},
  activeAlerts: 0,
};
const noLightning: LightningView = {
  status: "clear",
  lastStrikeAt: null,
  lastStrikeDistanceM: null,
};

type Props = {
  siteId: string;
  siteName: string;
  userId: string;
  reports: Report[];
  crewTerm: number;
  crew: CrewMember[];
  crewLoaded: boolean;
  /** Reload the roster after someone is added or removed. */
  onCrewChanged: () => void;
  onLocate: (member: CrewMember) => void;
};

/** Everything a supervisor needs above the map: risk, alerts, plan review, crew and messaging. */
export function SupervisorDashboard({
  siteId,
  siteName,
  userId,
  reports,
  crewTerm,
  crew,
  crewLoaded,
  onCrewChanged,
  onLocate,
}: Props) {
  const { announce } = useNotice();
  const onError = useCallback((m: string) => announce(m, true), [announce]);
  const risk = useLive(
    siteId,
    ["site_risk", "site_subscores"],
    fetchSiteRisk,
    noRisk,
    30000,
    onError,
  );
  const alerts = useLive<AlertRow[]>(
    siteId,
    ["alerts"],
    fetchAlerts,
    [],
    30000,
    onError,
  );
  const lightning = useLive(
    siteId,
    ["lightning_state"],
    fetchLightning,
    noLightning,
    30000,
    onError,
  );
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const selectAll = (all: boolean) =>
    setSelected(
      new Set(
        all ? crew.filter((m) => m.role === "crew").map((m) => m.user_id) : [],
      ),
    );

  return (
    <div className={styles.stack} id="supervisor-dashboard">
      <SectionNav />
      <RiskPanel
        risk={risk.data}
        loaded={risk.loaded}
        openHazards={reports.filter((r) => r.is_active).length}
        crewTerm={crewTerm}
      />
      <AlertsSection alerts={alerts} lightning={lightning} userId={userId} />
      <div className={styles.columns}>
        <BriefingPanel siteId={siteId} />
        <CrewPanel
          crew={crew}
          loaded={crewLoaded}
          siteId={siteId}
          siteName={siteName}
          onCrewChanged={onCrewChanged}
          selected={selected}
          onToggle={toggle}
          onSelectAll={selectAll}
          onLocate={onLocate}
        />
        <PushComposer siteId={siteId} selected={selected} reports={reports} />
      </div>
    </div>
  );
}
