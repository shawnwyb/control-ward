import { Icon } from "../../components/ui";
import { useNow } from "../../hooks/useNow";
import { allClearRemaining, formatCountdown } from "../../lib/countdown";
import type { LightningView } from "../../lib/monitoring";
import styles from "./StopWorkBanner.module.css";

const METERS_PER_MILE = 1609.344;

/**
 * Drops in over the map while the site is in lightning stop-work, with the time left
 * until the all-clear. Renders nothing when there is no strike in the last 30 minutes.
 */
export function StopWorkBanner({
  siteName,
  lightning,
}: {
  siteName: string;
  lightning: LightningView;
}) {
  const stop = lightning.status === "stop_work";
  const now = useNow(stop);
  const remaining = stop
    ? allClearRemaining(lightning.lastStrikeAt, now)
    : null;
  if (remaining === null) return null;
  const distance = lightning.lastStrikeDistanceM;
  return (
    <div className={styles.banner} role="alert">
      <span className={styles.icon}>
        <Icon name="bolt" size={18} />
      </span>
      <span className={styles.text}>
        <strong>Stop work · {siteName}</strong>
        <small>
          {distance !== null
            ? `Lightning ${(distance / METERS_PER_MILE).toFixed(1)} mi away · all clear in`
            : "Lightning nearby · all clear in"}
        </small>
      </span>
      {/* Hidden from screen readers so the alert is not re-read every second. */}
      <span className={styles.count} aria-hidden="true">
        {formatCountdown(remaining)}
      </span>
    </div>
  );
}
