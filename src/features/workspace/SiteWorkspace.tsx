import { useCallback, useEffect, useState } from "react";
import { ErrorBoundary } from "../../components/ErrorBoundary";
import { Panel } from "../../components/ui";
import { useBusy } from "../../hooks/busy";
import { useCrewRoster } from "../../hooks/useCrewRoster";
import { useLive } from "../../hooks/useLive";
import { useNotice } from "../../hooks/notice";
import type { useSiteFeed } from "../../hooks/useSiteFeed";
import { sendCheckin } from "../../lib/api";
import { errorMessage } from "../../lib/format";
import {
  fetchAlerts,
  fetchLightning,
  type AlertRow,
  type LightningView,
  type Role,
} from "../../lib/monitoring";
import { homeFor, type Page } from "../../lib/route";
import { checkinRequestId, completeCheckin } from "../../lib/submission";
import type { Site } from "../../lib/types";
import { SiteMap } from "../map/SiteMap";
import { ReportForm } from "../report/ReportForm";
import type { ReportDraft } from "../report/types";
import { useReportSubmit } from "../report/useReportSubmit";
import {
  AlertsPage,
  BriefingPage,
  CrewPage,
  MySitePage,
  ReportsPage,
  SitesPage,
} from "./pages";
import styles from "./SiteWorkspace.module.css";

const noLightning: LightningView = {
  status: "clear",
  lastStrikeAt: null,
  lastStrikeDistanceM: null,
};

/**
 * Everything for one site, shown one page at a time. Remounted per site, so form
 * and feed state reset on switch. State that must outlive a page change (the draft
 * report, the crew roster, map focus) lives here, above the pages.
 */
export function SiteWorkspace({
  site,
  role,
  userId,
  page,
  onNavigate,
  feed,
  onAlertCount,
}: {
  site: Site;
  role: Role;
  userId: string;
  page: Page;
  onNavigate: (page: Page) => void;
  feed: ReturnType<typeof useSiteFeed>;
  /** Tells the sidebar how many alerts are active here. */
  onAlertCount: (count: number) => void;
}) {
  const { announce } = useNotice();
  const { busy, isBusy, setBusy } = useBusy();
  const supervisor = role === "supervisor";
  const onError = useCallback((m: string) => announce(m, true), [announce]);
  const alerts = useLive<AlertRow[]>(
    site.id,
    ["alerts"],
    fetchAlerts,
    [],
    10000,
    onError,
  );
  const lightning = useLive(
    site.id,
    ["lightning_state"],
    fetchLightning,
    noLightning,
    30000,
    onError,
  );
  const alertCount = alerts.data.length;
  useEffect(() => {
    onAlertCount(alertCount);
  }, [alertCount, onAlertCount]);
  useEffect(() => () => onAlertCount(0), [onAlertCount]);

  const roster = useCrewRoster(site.id, supervisor, onError);
  const [crewFocus, setCrewFocus] = useState<{ id: string; nonce: number }>();
  const [draft, setDraft] = useState<ReportDraft>({
    type: "debris",
    severity: 2,
    latitude: site.latitude.toFixed(6),
    longitude: site.longitude.toFixed(6),
  });
  const patch = useCallback(
    (changes: Partial<ReportDraft>) =>
      setDraft((current) => ({ ...current, ...changes })),
    [],
  );
  const setPin = useCallback(
    (latitude: number, longitude: number) =>
      patch({ latitude: latitude.toFixed(6), longitude: longitude.toFixed(6) }),
    [patch],
  );
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [focusRequest, setFocusRequest] = useState<{
    id: string;
    nonce: number;
  }>();
  const clearFile = useCallback(() => patch({ file: undefined }), [patch]);
  const submit = useReportSubmit(site, feed.refresh, clearFile);

  function locate() {
    if (!navigator.geolocation)
      return announce(
        "Location is unavailable. Select a pin on the map.",
        true,
      );
    navigator.geolocation.getCurrentPosition(
      (position) => setPin(position.coords.latitude, position.coords.longitude),
      () =>
        announce(
          "Could not access your location. Select a pin on the map or enter coordinates.",
          true,
        ),
      { timeout: 10000 },
    );
  }

  async function checkin(reportId: string, stillThere: boolean) {
    if (isBusy()) return;
    const signature = `${reportId}:${stillThere}`;
    const requestId = checkinRequestId(signature);
    setBusy(true);
    try {
      await sendCheckin(requestId, reportId, stillThere);
      completeCheckin(signature);
      announce(
        stillThere
          ? "Confirmed. Your team has the latest update."
          : "Marked resolved. Your team has been updated.",
      );
      await feed.refresh();
    } catch (error) {
      announce(errorMessage(error), true);
    } finally {
      setBusy(false);
    }
  }

  const mapAndForm = (
    <div className={styles.grid}>
      <ReportForm
        className={styles.form}
        draft={draft}
        busy={busy}
        onChange={patch}
        onSubmit={() => submit(draft)}
        onLocate={locate}
      />
      <ErrorBoundary
        fallback={
          <Panel className={styles.map}>
            <h2>The map couldn’t load</h2>
            <p>
              You can still report hazards: use “Use my location” or enter
              coordinates. Reload the page to try the map again.
            </p>
          </Panel>
        }
      >
        <SiteMap
          className={styles.map}
          site={site}
          reports={feed.reports}
          crew={supervisor ? roster.crew : undefined}
          crewFocus={crewFocus}
          pin={{
            latitude: Number(draft.latitude),
            longitude: Number(draft.longitude),
          }}
          disabled={busy}
          highlightId={hoveredId}
          focusRequest={focusRequest}
          onPin={setPin}
        />
      </ErrorBoundary>
    </div>
  );

  const base = { site, role, userId };
  return (
    <div id="site-workspace" className={styles.workspace}>
      {page === "sites" ? (
        <SitesPage
          {...base}
          reports={feed.reports}
          crewTerm={feed.metrics.crewRisk}
        >
          {mapAndForm}
        </SitesPage>
      ) : null}
      {page === "site" ? <MySitePage {...base}>{mapAndForm}</MySitePage> : null}
      {page === "alerts" ? (
        <AlertsPage {...base} alerts={alerts} lightning={lightning} />
      ) : null}
      {page === "briefing" ? <BriefingPage {...base} /> : null}
      {page === "crew" ? (
        <CrewPage
          {...base}
          reports={feed.reports}
          crew={roster.crew}
          crewLoaded={roster.loaded}
          onCrewChanged={() => void roster.refresh()}
          onLocate={(member) => {
            setCrewFocus((last) => ({
              id: member.user_id,
              nonce: (last?.nonce ?? 0) + 1,
            }));
            onNavigate(homeFor(role));
          }}
        />
      ) : null}
      {page === "reports" ? (
        <ReportsPage
          {...base}
          reports={feed.reports}
          reminderCount={feed.reminderCount}
          busy={busy}
          onCheckin={checkin}
          onSelect={(id) => {
            setFocusRequest((last) => ({ id, nonce: (last?.nonce ?? 0) + 1 }));
            onNavigate(homeFor(role));
          }}
        />
      ) : null}
    </div>
  );
}
