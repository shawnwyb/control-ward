import { useEffect, useState } from "react";
import { Panel, PanelHeader, cx } from "../../components/ui";
import type { AlertRow, LightningView } from "../../lib/monitoring";
import { timeAgo } from "../../lib/format";
import styles from "./Dashboard.module.css";

const COUNTDOWN_MS = 30 * 60 * 1000;

const kindLabels: Record<string, string> = {
  lightning: "Lightning",
  heat: "Heat",
  flood: "Flood",
  wildfire: "Wildfire",
  other: "Severe weather",
};

function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

/** Shared by the supervisor dashboard and the crew banner. */
export function AlertsPanel({
  alerts,
  lightning,
  compact,
}: {
  alerts: AlertRow[];
  lightning: LightningView;
  compact?: boolean;
}) {
  const stop = lightning.status === "stop_work";
  const now = useNow(stop);
  const remaining =
    stop && lightning.lastStrikeAt
      ? Math.max(
          0,
          new Date(lightning.lastStrikeAt).getTime() + COUNTDOWN_MS - now,
        )
      : 0;
  const mm = String(Math.floor(remaining / 60000)).padStart(2, "0");
  const ss = String(Math.floor((remaining % 60000) / 1000)).padStart(2, "0");
  const others = alerts.filter((a) => !(a.kind === "lightning" && stop));
  const body = (
    <>
      {stop ? (
        <div
          className={cx(styles.alert, styles.stop)}
          role="alert"
          id="lightning-stop"
        >
          <span>
            <strong>Stop work · lightning</strong>
            <span className={styles.muted}>
              Clears 30 minutes after the last strike
              {lightning.lastStrikeDistanceM !== null
                ? ` · last strike ${(lightning.lastStrikeDistanceM / 1609.34).toFixed(1)} mi away`
                : ""}
            </span>
          </span>
          <span className={styles.countdown}>
            {mm}:{ss}
          </span>
        </div>
      ) : null}
      {others.map((alert) => (
        <div
          key={alert.id}
          className={cx(
            styles.alert,
            alert.level === "stop_work" && styles.stop,
          )}
          role={alert.level === "stop_work" ? "alert" : undefined}
        >
          <span>
            <strong>
              {alert.level === "stop_work" ? "Stop work · " : ""}
              {kindLabels[alert.kind] ?? alert.kind}
            </strong>
            <span className={styles.muted}>
              {alert.level === "info" ? "Advisory" : "Warning"} · raised{" "}
              {timeAgo(alert.created_at)}
            </span>
          </span>
        </div>
      ))}
    </>
  );
  if (compact) return stop || others.length ? <div>{body}</div> : null;
  // Nothing to act on: one quiet line instead of a card.
  if (!stop && !others.length)
    return (
      <p className={styles.muted} id="no-alerts">
        No active alerts.
      </p>
    );
  return (
    <Panel aria-labelledby="alerts-title">
      <PanelHeader titleId="alerts-title" title="Alerts" />
      {body}
    </Panel>
  );
}
