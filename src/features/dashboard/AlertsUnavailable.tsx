import { Button, Icon } from "../../components/ui";
import styles from "./AlertsUnavailable.module.css";

/**
 * Shown when alerts could not be loaded. A missing list looks the same as
 * "no alerts", so this says plainly that conditions are unknown.
 */
export function AlertsUnavailable({ onRetry }: { onRetry?: () => void }) {
  return (
    <section className={styles.box} aria-label="Site alerts">
      <Icon name="alert" size={24} />
      <p>
        <strong>Safety alerts could not be loaded.</strong> Do not assume
        conditions are clear. Check with your supervisor.
      </p>
      {onRetry ? (
        <Button variant="secondary" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </section>
  );
}
