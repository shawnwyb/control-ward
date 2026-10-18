import { Button, Panel, PanelHeader, StatusTag, cx } from "../../components/ui";
import type { AlertRow, LightningView } from "../../lib/monitoring";
import { useNow } from "../../hooks/useNow";
import { allClearRemaining, formatCountdown } from "../../lib/countdown";
import { timeAgo } from "../../lib/format";
import styles from "./Dashboard.module.css";

const kindLabels: Record<string, string> = {
  lightning: "Lightning",
  heat: "Heat",
  flood: "Flood",
  wildfire: "Wildfire",
  other: "Severe weather",
  supervisor: "Message from your supervisor",
};

/** Shared by the supervisor dashboard and the crew banner. */
export type Acknowledgement = {
  acknowledged: Set<string>;
  pending: Set<string>;
  onAcknowledge: (alertId: string) => void;
};

export function AlertsPanel({
  alerts,
  lightning,
  compact,
  acknowledgement,
  onClear,
}: {
  alerts: AlertRow[];
  lightning: LightningView;
  compact?: boolean;
  /** When given, each alert gets an Acknowledge button. */
  acknowledgement?: Acknowledgement;
  /** Supervisors only: takes a supervisor message off the crew's screens. */
  onClear?: (alertId: string) => void;
}) {
  const ack = (alertId?: string) =>
    !acknowledgement || !alertId ? null : acknowledgement.acknowledged.has(
        alertId,
      ) ? (
      <StatusTag>Acknowledged</StatusTag>
    ) : (
      <Button
        variant="secondary"
        busy={acknowledgement.pending.has(alertId)}
        onClick={() => acknowledgement.onAcknowledge(alertId)}
      >
        Acknowledge
      </Button>
    );
  const lightningAlert = alerts.find((a) => a.kind === "lightning");
  const stop = lightning.status === "stop_work";
  const now = useNow(stop);
  const remaining = stop
    ? allClearRemaining(lightning.lastStrikeAt, now)
    : null;
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
          {remaining !== null ? (
            <span className={styles.countdown}>
              {formatCountdown(remaining)}
            </span>
          ) : null}
          {ack(lightningAlert?.id)}
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
          {alert.kind === "supervisor" ? (
            <span>
              <strong>
                {String(alert.payload.title ?? "Supervisor message")}
              </strong>
              <span>{String(alert.payload.body ?? "")}</span>
              <span className={styles.muted}>
                From your supervisor · {timeAgo(alert.created_at)}
              </span>
            </span>
          ) : (
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
          )}
          <span className={styles.alertActions}>
            {ack(alert.id)}
            {onClear && alert.kind === "supervisor" ? (
              <Button variant="quiet" onClick={() => onClear(alert.id)}>
                Clear
              </Button>
            ) : null}
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
