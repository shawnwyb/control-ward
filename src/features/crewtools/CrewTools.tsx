import { useEffect, useState } from "react";
import { useNotice } from "../../hooks/notice";
import { useLive } from "../../hooks/useLive";
import { errorMessage } from "../../lib/format";
import { fetchBriefingDraft, type BriefingDraft } from "../../lib/monitoring";
import {
  disablePush,
  enablePush,
  isPushEnabled,
  pushSupport,
} from "../../lib/push";
import styles from "../dashboard/Dashboard.module.css";
import { Icon } from "../../components/ui";
import pill from "./LocationPill.module.css";
import type { useLocationSharing } from "./useLocationSharing";

const supportNote = {
  ready: "",
  unsupported: "This browser can’t receive push notifications.",
  "not-configured": "Push isn’t set up for this app yet.",
  "needs-install":
    "On iPhone, add this app to your Home Screen to turn on notifications.",
} as const;

/** The plan the supervisor approved and sent, as the crew sees it. Nothing until one is sent. */
export function CrewPlanCard({ siteId }: { siteId: string }) {
  const plan = useLive<BriefingDraft | null>(
    siteId,
    ["briefing_drafts"],
    fetchBriefingDraft,
    null,
    60000,
  );
  const sent = plan.data?.status === "sent" ? plan.data : null;
  if (!sent) return null;
  return (
    <div className={styles.sentPlan} id="crew-plan">
      <strong>
        Plan for {sent.for_date}
        {sent.content.work_window
          ? ` · work ${sent.content.work_window.start} to ${sent.content.work_window.end}`
          : ""}
      </strong>
      <span>{sent.content.summary}</span>
    </div>
  );
}

/** Floating pill on the My site map: share this device's location with the supervisor. */
export function LocationPill({
  location,
}: {
  /** From `useLocationSharing`, which the workspace runs so sharing outlives page changes. */
  location: Pick<
    ReturnType<typeof useLocationSharing>,
    "enabled" | "setEnabled" | "supported"
  >;
}) {
  if (!location.supported) return null;
  return (
    <label className={pill.pill}>
      <Icon name="locate" size={14} />
      <span>Share my location</span>
      <input
        type="checkbox"
        role="switch"
        className={pill.switch}
        aria-label="Share my location with my supervisor"
        checked={location.enabled}
        onChange={(event) => location.setEnabled(event.target.checked)}
      />
    </label>
  );
}

/** Opt-in for this device: push notifications. */
export function DeviceSettings({ userId }: { userId: string }) {
  const { announce } = useNotice();
  const support = pushSupport();
  const [pushOn, setPushOn] = useState(false);

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

  return (
    <div
      className={styles.group}
      id="crew-tools"
      role="group"
      aria-label="This device"
    >
      <label className={styles.setting}>
        <span className={styles.settingText}>
          <b>Notify me about alerts and plans</b>
          <small>
            {support !== "ready"
              ? supportNote[support]
              : "Push notifications on this device."}
          </small>
        </span>
        <input
          type="checkbox"
          role="switch"
          className={styles.switch}
          checked={pushOn}
          disabled={support !== "ready"}
          onChange={(event) => void togglePush(event.target.checked)}
        />
      </label>
    </div>
  );
}
