import { useCallback, useState } from "react";
import { useBusy } from "../../hooks/busy";
import { useNotice } from "../../hooks/notice";
import { useSiteFeed } from "../../hooks/useSiteFeed";
import { errorMessage } from "../../lib/format";
import { checkinRequestId, completeCheckin } from "../../lib/submission";
import { sendCheckin } from "../../lib/api";
import type { Role } from "../../lib/monitoring";
import type { Site } from "../../lib/types";
import { useCrewRoster } from "../../hooks/useCrewRoster";
import { CrewTools } from "../crewtools/CrewTools";
import { SupervisorDashboard } from "../dashboard/SupervisorDashboard";
import { scrollToSection } from "../dashboard/SectionNav";
import { ErrorBoundary } from "../../components/ErrorBoundary";
import { Panel } from "../../components/ui";
import { ReportFeed } from "../feed/ReportFeed";
import { SiteMap } from "../map/SiteMap";
import { ReportForm } from "../report/ReportForm";
import type { ReportDraft } from "../report/types";
import { useReportSubmit } from "../report/useReportSubmit";
import { StatusStrip } from "./StatusStrip";
import styles from "./SiteWorkspace.module.css";
import { SafetyPanel } from "../safety/SafetyPanel";

/** Everything for one site. Remounted per site, so form and feed state reset on switch. */
export function SiteWorkspace({
  site,
  role,
  userId,
}: {
  site: Site;
  role: Role;
  userId: string;
}) {
  const { announce } = useNotice();
  const { busy, isBusy, setBusy } = useBusy();
  const feed = useSiteFeed(site.id, (message) => announce(message, true));
  const supervisor = role === "supervisor";
  const roster = useCrewRoster(site.id, supervisor, (message) =>
    announce(message, true),
  );
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

  return (
    <div id="site-workspace" className={styles.workspace}>
      {supervisor ? (
        <SupervisorDashboard
          siteId={site.id}
          siteName={site.name}
          userId={userId}
          onCrewChanged={() => void roster.refresh()}
          reports={feed.reports}
          crewTerm={feed.metrics.crewRisk}
          crew={roster.crew}
          crewLoaded={roster.loaded}
          onLocate={(member) => {
            setCrewFocus((last) => ({
              id: member.user_id,
              nonce: (last?.nonce ?? 0) + 1,
            }));
            scrollToSection("site-map");
          }}
        />
      ) : null}
      <CrewTools siteId={site.id} userId={userId} showAlerts={!supervisor} />
      <SafetyPanel site={site} role={role} />
      <StatusStrip
        metrics={feed.metrics}
        loaded={feed.loaded}
        connection={feed.connection}
        connectionOnly
      />
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
        <ReportFeed
          className={styles.feed}
          reports={feed.reports}
          reminderCount={feed.reminderCount}
          busy={busy}
          onCheckin={checkin}
          onHover={setHoveredId}
          onSelect={(id) =>
            setFocusRequest((last) => ({ id, nonce: (last?.nonce ?? 0) + 1 }))
          }
        />
      </div>
    </div>
  );
}
