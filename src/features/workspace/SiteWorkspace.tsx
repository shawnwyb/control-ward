import { useCallback, useEffect, useRef, useState } from "react";
import { ErrorBoundary } from "../../components/ErrorBoundary";
import { Panel } from "../../components/ui";
import { useBusy } from "../../hooks/busy";
import { useCrewRoster } from "../../hooks/useCrewRoster";
import { useLive } from "../../hooks/useLive";
import { useNow } from "../../hooks/useNow";
import { allClearRemaining } from "../../lib/countdown";
import { distanceMeters } from "../../lib/geo";
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
import type { SiteSummary } from "../../lib/sites";
import type { MutationResult, Site } from "../../lib/types";
import { LocationPill } from "../crewtools/CrewTools";
import { useLocationSharing } from "../crewtools/useLocationSharing";
import { SiteMap } from "../map/SiteMap";
import { SitesPage } from "../sites/SitesPage";
import { markForDropIn } from "../map/markers";
import {
  ReportButton,
  ReportDrawer,
  type Locating,
} from "../report/ReportDrawer";
import type { ReportDraft } from "../report/types";
import { useReportSubmit } from "../report/useReportSubmit";
import { StopWorkBanner } from "../alerts/StopWorkBanner";
import { MySitePage } from "../site/MySitePage";
import {
  AlertsPage,
  DailySafetyPage,
  NextDayReportPage,
  CrewPage,
  ReportsPage,
} from "./pages";
import styles from "./SiteWorkspace.module.css";

const noLightning: LightningView = {
  status: "clear",
  lastStrikeAt: null,
  lastStrikeDistanceM: null,
};

/** A location fix farther than this from the site is not used for the report pin. */
const FAR_FROM_SITE_M = 2000;

const freshDraft = (site: Site): ReportDraft => ({
  type: "debris",
  severity: 2,
  latitude: site.latitude.toFixed(6),
  longitude: site.longitude.toFixed(6),
});

/** Pages that show the map. They are not remounted on a site switch, so the map can fly. */
const mapPages: Page[] = ["sites", "site"];

/**
 * Everything for the selected site, shown one page at a time. It stays mounted when
 * the site changes (so the map can fly to the new site) and resets its per-site state
 * itself: the draft report, ticked crew, map focus and hover. Pages without the map
 * are keyed by site, so their own state starts clean too. State that must outlive a
 * page change (the draft report, the crew roster, map focus) lives here, above the pages.
 */
export function SiteWorkspace({
  site,
  role,
  userId,
  page,
  onNavigate,
  onSiteChange,
  feed,
  onAlertCount,
}: {
  site: Site;
  role: Role;
  userId: string;
  page: Page;
  onNavigate: (page: Page) => void;
  /** Select another site (a pin on the map). */
  onSiteChange: (siteId: string) => void;
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
  // One stop-work value for the ring, camera fit and banner: lightning says so AND the window is open.
  const stopNow = useNow(lightning.data.status === "stop_work");
  const stopWorkActive =
    lightning.data.status === "stop_work" &&
    allClearRemaining(lightning.data.lastStrikeAt, stopNow) !== null;
  // Runs here, not in the pill, so sharing carries on across every page while the workspace is open.
  const location = useLocationSharing(site.id, onError);
  const alertCount = alerts.data.length;
  // Report only a loaded count: the sidebar keeps the last one while a new site's loads.
  const alertsLoaded = alerts.loaded;
  useEffect(() => {
    if (alertsLoaded) onAlertCount(alertCount);
  }, [alertCount, alertsLoaded, onAlertCount]);

  const roster = useCrewRoster(site.id, supervisor, onError);
  const [selectedCrew, setSelectedCrew] = useState<Set<string>>(new Set());
  const [crewFocus, setCrewFocus] = useState<{ id: string; nonce: number }>();
  const [draft, setDraft] = useState<ReportDraft>(() => freshDraft(site));
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
  // The report drawer (and the map pin it places) is open only on request; location is asked then.
  const [reportOpen, setReportOpen] = useState(false);
  const [locating, setLocating] = useState<Locating>("idle");
  const [accuracyFt, setAccuracyFt] = useState<number>();
  const [farMiles, setFarMiles] = useState<number>();
  const reportButton = useRef<HTMLButtonElement>(null);
  // Bumped whenever a pending location answer should be ignored (closed, pin moved, site changed).
  const locateToken = useRef(0);
  const [focusRequest, setFocusRequest] = useState<{
    id: string;
    nonce: number;
  }>();
  // A different site starts clean (adjusting state during render, so no stale frame).
  const [stateSite, setStateSite] = useState(site.id);
  if (stateSite !== site.id) {
    setStateSite(site.id);
    setDraft(freshDraft(site));
    setReportOpen(false);
    setLocating("idle");
    setAccuracyFt(undefined);
    setFarMiles(undefined);
    setSelectedCrew(new Set());
    setCrewFocus(undefined);
    setFocusRequest(undefined);
  }
  useEffect(() => {
    locateToken.current++;
  }, [site.id]);
  // Focus goes back to the button once it is usable again (it is inert while the drawer is open).
  const returnFocus = useRef(false);
  useEffect(() => {
    if (reportOpen || !returnFocus.current) return;
    returnFocus.current = false;
    reportButton.current?.focus();
  }, [reportOpen]);
  const onSaved = useCallback(
    (response: MutationResult) => {
      patch({ file: undefined });
      locateToken.current++;
      setReportOpen(false);
      returnFocus.current = true;
      if (response.outcome === "created") markForDropIn(response.report.id);
    },
    [patch],
  );
  const submit = useReportSubmit(site, feed.refresh, onSaved);

  /** Opens the drawer and pins the report at the user's location, or at the site center. */
  function openReport() {
    const token = ++locateToken.current;
    const toCenter = () => {
      setPin(site.latitude, site.longitude);
      setAccuracyFt(undefined);
      setLocating("denied");
    };
    setReportOpen(true);
    // On a phone the sheet covers the bottom of the screen: bring the map to the top of it.
    if (window.innerWidth < 768)
      document.getElementById("site-map")?.scrollIntoView({ block: "start" });
    if (!navigator.geolocation) return toCenter();
    setLocating("pending");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (token !== locateToken.current) return;
        const meters = distanceMeters(
          site.latitude,
          site.longitude,
          position.coords.latitude,
          position.coords.longitude,
        );
        if (meters > FAR_FROM_SITE_M) {
          // Not at the site: a pin there would be a bad report. Keep it at the centre.
          setPin(site.latitude, site.longitude);
          setAccuracyFt(undefined);
          setFarMiles(Math.round(meters / 1609.34));
          setLocating("far");
          return;
        }
        setPin(position.coords.latitude, position.coords.longitude);
        setAccuracyFt(Math.round(position.coords.accuracy * 3.28084));
        setLocating("idle");
      },
      () => {
        if (token === locateToken.current) toCenter();
      },
      { timeout: 10000 },
    );
  }
  const closeReport = useCallback(() => {
    locateToken.current++;
    setReportOpen(false);
    returnFocus.current = true;
  }, []);
  /** A map click or arrow key places the pin by hand, which also drops a pending location answer. */
  function placePin(latitude: number, longitude: number) {
    locateToken.current++;
    setAccuracyFt(undefined);
    setLocating("idle");
    setPin(latitude, longitude);
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

  /** The floating button and drawer, placed inside the map pane (which is position: relative). */
  const reportLayer = (
    <>
      <ReportButton
        ref={reportButton}
        hidden={reportOpen}
        onClick={openReport}
      />
      <ReportDrawer
        open={reportOpen}
        site={site}
        draft={draft}
        busy={busy}
        locating={locating}
        accuracyFt={accuracyFt}
        farMiles={farMiles}
        onChange={patch}
        onSubmit={() => submit(draft)}
        onClose={closeReport}
      />
    </>
  );

  /** The full-height map; supervisors also get a pin per site. */
  const siteMap = (sites?: SiteSummary[]) => (
    <ErrorBoundary
      fallback={
        <Panel>
          <h2>The map couldn’t load</h2>
          <p>
            You can still report hazards with “Report hazard”. Reload the page
            to try the map again.
          </p>
        </Panel>
      }
    >
      <SiteMap
        site={site}
        reports={feed.reports}
        crew={supervisor ? roster.crew : undefined}
        crewFocus={crewFocus}
        pin={{
          latitude: Number(draft.latitude),
          longitude: Number(draft.longitude),
        }}
        pinActive={reportOpen}
        disabled={busy}
        focusRequest={focusRequest}
        sites={sites}
        onSelectSite={sites ? onSiteChange : undefined}
        stopWork={stopWorkActive}
        fitStopWork
        onPin={placePin}
      />
    </ErrorBoundary>
  );

  const base = { site, role, userId };
  return (
    <div id="site-workspace" className={styles.workspace}>
      {!mapPages.includes(page) && page !== "alerts" ? (
        <StopWorkBanner siteName={site.name} lightning={lightning.data} />
      ) : null}
      {/* Only this wrapper is keyed (by page, and by site off the map pages), so state above it survives. */}
      <div
        key={mapPages.includes(page) ? page : `${page}:${site.id}`}
        className={styles.pageIn}
      >
        {page === "sites" ? (
          <SitesPage
            site={site}
            reports={feed.reports}
            crewTerm={feed.metrics.crewRisk}
            lightning={lightning.data}
            onSelectSite={onSiteChange}
            renderMap={siteMap}
            mapOverlay={reportLayer}
            mapSlotOverlay={
              <div className={styles.pillSlot}>
                {/* Supervisors are on the roster too; keyed so a site switch restarts it. */}
                <LocationPill location={location} />
              </div>
            }
          />
        ) : null}
        {page === "site" ? (
          <MySitePage
            site={site}
            lightning={lightning.data}
            map={siteMap()}
            overlay={reportLayer}
            location={location}
            alertCount={alertCount}
            crewTerm={feed.metrics.crewRisk}
          />
        ) : null}
        {page === "alerts" ? (
          <AlertsPage {...base} alerts={alerts} lightning={lightning} />
        ) : null}
        {page === "daily-safety" ? (
          <DailySafetyPage {...base} onNavigate={onNavigate} />
        ) : null}
        {page === "next-day-report" ? <NextDayReportPage {...base} /> : null}
        {page === "crew" ? (
          <CrewPage
            {...base}
            reports={feed.reports}
            crew={roster.crew}
            crewLoaded={roster.loaded}
            selected={selectedCrew}
            onSelectedChange={setSelectedCrew}
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
              setFocusRequest((last) => ({
                id,
                nonce: (last?.nonce ?? 0) + 1,
              }));
              onNavigate(homeFor(role));
            }}
          />
        ) : null}
      </div>
    </div>
  );
}
