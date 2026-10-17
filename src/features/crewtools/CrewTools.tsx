import { useEffect, useState } from "react";
import { useNotice } from "../../hooks/notice";
import { useLive } from "../../hooks/useLive";
import { errorMessage } from "../../lib/format";
import {
  fetchAlerts,
  fetchBriefingDraft,
  fetchLightning,
  type AlertRow,
  type BriefingDraft,
  type LightningView,
} from "../../lib/monitoring";
import {
  disablePush,
  enablePush,
  isPushEnabled,
  pushSupport,
} from "../../lib/push";
import { Button } from "../../components/ui";
import { AlertsSection } from "../dashboard/AlertsSection";
import styles from "../dashboard/Dashboard.module.css";
import { useLocationSharing } from "./useLocationSharing";

const noLightning: LightningView = {
  status: "clear",
  lastStrikeAt: null,
  lastStrikeDistanceM: null,
};

const supportNote = {
  ready: "",
  unsupported: "This browser can’t receive push notifications.",
  "not-configured": "Push isn’t set up for this app yet.",
  "needs-install":
    "On iPhone, add this app to your Home Screen to turn on notifications.",
} as const;

/** What every worker sees: live alerts, the approved plan, and opt-ins for push and location. */
export function CrewTools({
  siteId,
  userId,
  showAlerts = true,
}: {
  siteId: string;
  userId: string;
  /** Supervisors already see alerts in their dashboard. */
  showAlerts?: boolean;
}) {
  const { announce } = useNotice();
  const alerts = useLive<AlertRow[]>(
    siteId,
    ["alerts"],
    fetchAlerts,
    [],
    10000,
  );
  const lightning = useLive(
    siteId,
    ["lightning_state"],
    fetchLightning,
    noLightning,
    30000,
  );
  const plan = useLive<BriefingDraft | null>(
    siteId,
    ["briefing_drafts"],
    fetchBriefingDraft,
    null,
    60000,
  );
  const location = useLocationSharing(siteId, (m) => announce(m, true));
  const support = pushSupport();
  const [pushOn, setPushOn] = useState(false);

  const [message, setMessage] = useState<{ title: string; body: string }>();

  useEffect(() => {
    void isPushEnabled()
      .then((on) => {
        setPushOn(on);
        // The browser can still hold a subscription the server has dropped (pruned, or replaced
        // from another device). Re-register it so "on" here always means "reachable".
        if (on) return enablePush(userId);
      })
      .catch(() => undefined);
  }, [userId]);

  // The service worker forwards every push to open windows, so it is visible even if the OS hides it.
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type !== "push") return;
      setMessage({ title: event.data.title, body: event.data.body });
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () =>
      navigator.serviceWorker.removeEventListener("message", onMessage);
  }, []);

  async function togglePush(on: boolean) {
    try {
      if (on) await enablePush(userId);
      else await disablePush(userId);
      setPushOn(on);
      announce(
        on ? "Notifications are on for this device." : "Notifications are off.",
      );
    } catch (error) {
      announce(errorMessage(error), true);
    }
  }

  const sent = plan.data?.status === "sent" ? plan.data : null;
  return (
    <div className={styles.stack} id="crew-tools">
      {showAlerts ? (
        <AlertsSection
          alerts={alerts}
          lightning={lightning}
          userId={userId}
          compact
        />
      ) : null}
      {message ? (
        <div className={styles.sentPlan} id="push-message" role="status">
          <strong>{message.title}</strong>
          <span>{message.body}</span>
          <Button variant="ghost" onClick={() => setMessage(undefined)}>
            Dismiss
          </Button>
        </div>
      ) : null}
      {sent ? (
        <div className={styles.sentPlan} id="crew-plan">
          <strong>
            Plan for {sent.for_date}
            {sent.content.work_window
              ? ` · work ${sent.content.work_window.start} to ${sent.content.work_window.end}`
              : ""}
          </strong>
          <span>{sent.content.summary}</span>
        </div>
      ) : null}
      <div className={styles.tools} role="group" aria-label="This device">
        <label className={styles.toggle}>
          <input
            type="checkbox"
            checked={pushOn}
            disabled={support !== "ready"}
            onChange={(event) => void togglePush(event.target.checked)}
          />
          Notify me about alerts and plans
        </label>
        {location.supported ? (
          <label className={styles.toggle}>
            <input
              type="checkbox"
              checked={location.enabled}
              onChange={(event) => location.setEnabled(event.target.checked)}
            />
            Share my location with my supervisor
          </label>
        ) : null}
        {support !== "ready" ? (
          <span className={styles.muted}>{supportNote[support]}</span>
        ) : null}
      </div>
    </div>
  );
}
