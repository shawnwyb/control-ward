import { useEffect, useState } from "react";
import { ErrorBoundary } from "../../components/ErrorBoundary";
import { NextDayReport } from "../nextday/NextDayReport";
import {
  type AlertRow,
  type CrewMember,
  type LightningView,
  type Role,
} from "../../lib/monitoring";
import { Icon, type IconName } from "../../components/ui";
import type { Report, Site } from "../../lib/types";
import { CrewPlanCard, DeviceSettings } from "../crewtools/CrewTools";
import { AlertsSection } from "../dashboard/AlertsSection";
import { BriefingPanel } from "../dashboard/BriefingPanel";
import { CrewPanel } from "../dashboard/CrewPanel";
import dashboard from "../dashboard/Dashboard.module.css";
import { PushComposer } from "../dashboard/PushComposer";
import { ReportFeed } from "../feed/ReportFeed";
import { SafetyPanel } from "../safety/SafetyPanel";
import styles from "./pages.module.css";

type Live<T> = {
  data: T;
  loaded: boolean;
  failed: boolean;
  refresh: () => Promise<void>;
};

type Base = { site: Site; role: Role; userId: string };

function PageTitle({
  title,
  icon,
  hint,
}: {
  title: string;
  icon: IconName;
  hint?: string;
}) {
  return (
    <header className={styles.head}>
      <h1 className={styles.title}>
        <Icon name={icon} size={20} />
        {title}
      </h1>
      {hint ? <p className={styles.hint}>{hint}</p> : null}
    </header>
  );
}

export function AlertsPage({
  site,
  role,
  userId,
  alerts,
  lightning,
}: Base & { alerts: Live<AlertRow[]>; lightning: Live<LightningView> }) {
  const supervisor = role === "supervisor";
  return (
    <div className={dashboard.stack}>
      <PageTitle title="Alerts" icon="bell" hint={site.name} />
      <AlertsSection
        alerts={alerts}
        lightning={lightning}
        userId={userId}
        compact={!supervisor}
        canClear={supervisor}
      />
      <DeviceSettings userId={userId} />
    </div>
  );
}

export function DailySafetyPage({ site, role }: Base) {
  const [reportOpened, setReportOpened] = useState(
    () => window.location.hash === "#/next-day-report",
  );
  useEffect(() => {
    const openLegacyReport = () => {
      if (window.location.hash === "#/next-day-report") setReportOpened(true);
    };
    window.addEventListener("hashchange", openLegacyReport);
    return () => window.removeEventListener("hashchange", openLegacyReport);
  }, []);
  const supervisor = role === "supervisor";
  return (
    <div className={dashboard.stack}>
      <PageTitle title="Daily safety" icon="brief" hint={site.name} />
      <SafetyPanel site={site} role={role} />
      {supervisor ? (
        <BriefingPanel siteId={site.id} />
      ) : (
        <CrewPlanCard siteId={site.id} />
      )}
      <details
        className={styles.forecast}
        open={reportOpened || undefined}
        onToggle={(event) => setReportOpened(event.currentTarget.open)}
      >
        <summary>View detailed forecast &amp; sources</summary>
        {reportOpened ? (
          <div className={styles.forecastBody}>
            <p className={styles.hint}>
              Check the dates: this forecast may cover a different day from the
              checklist or work plan. Its data gaps and freshness are shown
              below.
            </p>
            <ErrorBoundary
              fallback={
                <p role="alert">
                  The detailed forecast could not load. Reload the page to try
                  again.
                </p>
              }
            >
              <NextDayReport site={site} />
            </ErrorBoundary>
          </div>
        ) : null}
      </details>
    </div>
  );
}

export function CrewPage({
  site,
  reports,
  crew,
  crewLoaded,
  onCrewChanged,
  onLocate,
  selected,
  onSelectedChange,
}: Base & {
  /** Workers ticked for a message. Held by the site workspace so it survives page changes. */
  selected: Set<string>;
  onSelectedChange: (next: Set<string>) => void;
  reports: Report[];
  crew: CrewMember[];
  crewLoaded: boolean;
  /** Reload the roster after someone is added or removed. */
  onCrewChanged: () => void;
  onLocate: (member: CrewMember) => void;
}) {
  const toggle = (id: string) => {
    const next = new Set(selected);
    if (!next.delete(id)) next.add(id);
    onSelectedChange(next);
  };
  const selectAll = (all: boolean) =>
    onSelectedChange(
      new Set(
        all ? crew.filter((m) => m.role === "crew").map((m) => m.user_id) : [],
      ),
    );
  return (
    <div className={dashboard.stack}>
      <PageTitle title="Crew" icon="paw" hint={site.name} />
      <div className={dashboard.columns}>
        <CrewPanel
          crew={crew}
          loaded={crewLoaded}
          siteId={site.id}
          siteName={site.name}
          onCrewChanged={onCrewChanged}
          selected={selected}
          onToggle={toggle}
          onSelectAll={selectAll}
          onLocate={onLocate}
        />
        <PushComposer siteId={site.id} selected={selected} reports={reports} />
      </div>
    </div>
  );
}

export function ReportsPage({
  site,
  userId,
  reports,
  reminderCount,
  busy,
  onCheckin,
  onSelect,
}: Base & {
  reports: Report[];
  reminderCount: number;
  busy: boolean;
  onCheckin: (reportId: string, stillThere: boolean) => void;
  onSelect: (reportId: string) => void;
}) {
  const [mine, setMine] = useState(false);
  const shown = mine
    ? reports.filter((report) => report.reporter_id === userId)
    : reports;
  return (
    <div className={dashboard.stack}>
      <PageTitle title="Reports" icon="camera" hint={site.name} />
      <label className={styles.mine}>
        <input
          type="checkbox"
          checked={mine}
          onChange={(event) => setMine(event.target.checked)}
        />
        Mine
      </label>
      <ReportFeed
        reports={shown}
        reminderCount={reminderCount}
        busy={busy}
        mine={mine}
        onCheckin={onCheckin}
        onSelect={onSelect}
      />
    </div>
  );
}
