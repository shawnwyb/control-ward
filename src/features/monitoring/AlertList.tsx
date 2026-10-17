import { useMemo } from "react";
import { Button, Icon, StatusTag, cx } from "../../components/ui";
import type { Alert, AlertKind, AlertLevel } from "../../lib/types";
import { describeAlert, kindIcons, levelLabels, sortAlerts } from "./alertCopy";
import { Countdown } from "./Countdown";
import { useNow } from "./useNow";
import styles from "./AlertList.module.css";

type Props = {
  alerts: Alert[];
  acknowledged: Set<string>;
  pending: Set<string>;
  onAcknowledge: (alertId: string) => void;
};

/** Active alerts for the site, most urgent first. Renders nothing when there are none. */
export function AlertList({
  alerts,
  acknowledged,
  pending,
  onAcknowledge,
}: Props) {
  const sorted = useMemo(() => sortAlerts(alerts), [alerts]);
  const counting = sorted.some(
    (alert) => alert.kind === "lightning" && describeAlert(alert).clearAt,
  );
  // Tick every second only while a countdown is on screen.
  const now = useNow(counting ? 1000 : 60000);
  if (!sorted.length) return null;

  return (
    <section className={styles.list} aria-label="Site alerts">
      <ul>
        {sorted.map((alert) => {
          const level = alert.level as AlertLevel;
          const { title, detail, clearAt } = describeAlert(alert, now);
          const done = acknowledged.has(alert.id);
          return (
            <li
              key={alert.id}
              className={cx(styles.item, styles[level])}
              data-alert-id={alert.id}
              data-kind={alert.kind}
              data-level={level}
            >
              <span className={styles.icon}>
                <Icon
                  name={kindIcons[alert.kind as AlertKind] ?? "alert"}
                  size={26}
                />
              </span>
              <div className={styles.body}>
                <div className={styles.head}>
                  <h3 className={styles.title}>
                    {/* Only stop-work is announced the moment it appears; the level is spoken first. */}
                    <span role={level === "stop_work" ? "alert" : undefined}>
                      {level === "stop_work" ? (
                        <span className="sr-only">{levelLabels[level]}: </span>
                      ) : null}
                      {title}
                    </span>
                  </h3>
                  <span className={styles.level}>
                    {levelLabels[level] ?? level}
                  </span>
                </div>
                {detail ? <p className={styles.detail}>{detail}</p> : null}
                {clearAt ? <Countdown clearAt={clearAt} now={now} /> : null}
              </div>
              <div className={styles.actions}>
                {done ? (
                  <StatusTag>Acknowledged</StatusTag>
                ) : (
                  <Button
                    variant="secondary"
                    busy={pending.has(alert.id)}
                    onClick={() => onAcknowledge(alert.id)}
                  >
                    Acknowledge
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
