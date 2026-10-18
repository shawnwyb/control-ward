import { useState, type ReactNode } from "react";
import {
  type AlertRow,
  type CrewMember,
  type LightningView,
  type Role,
} from "../../lib/monitoring";
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

function PageTitle({ title, hint }: { title: string; hint?: string }) {
  return (
    <header className={styles.head}>
      <h1 className={styles.title}>{title}</h1>
      {hint ? <p className={styles.hint}>{hint}</p> : null}
    </header>
  );
}

/** Crew home: the site's map and report form, plus this device's opt-ins. */
export function MySitePage({
  site,
  userId,
  children,
}: Base & { children: ReactNode }) {
  return (
    <div className={dashboard.stack}>
      <PageTitle title="My site" hint={site.name} />
      {/* Keyed: this page stays mounted across site switches (for the map). */}
      <DeviceSettings key={site.id} siteId={site.id} userId={userId} />
      {children}
    </div>
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
      <PageTitle title="Alerts" hint={site.name} />
      <AlertsSection
        alerts={alerts}
        lightning={lightning}
        userId={userId}
        compact={!supervisor}
        canClear={supervisor}
      />
      {supervisor ? <DeviceSettings siteId={site.id} userId={userId} /> : null}
    </div>
  );
}

export function BriefingPage({ site, role }: Base) {
  const supervisor = role === "supervisor";
  return (
    <div className={dashboard.stack}>
      <PageTitle
        title={supervisor ? "Next-day briefing" : "Tomorrow's briefing"}
        hint={site.name}
      />
      {supervisor ? <BriefingPanel siteId={site.id} /> : null}
      {supervisor ? null : <CrewPlanCard siteId={site.id} />}
      <SafetyPanel site={site} role={role} />
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
      <PageTitle title="Crew" hint={site.name} />
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
      <PageTitle title="Reports" hint={site.name} />
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
        onCheckin={onCheckin}
        onHover={() => undefined}
        onSelect={onSelect}
      />
    </div>
  );
}
