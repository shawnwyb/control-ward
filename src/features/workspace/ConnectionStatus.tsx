import { StatusDot } from "../../components/ui";
import {
  connectionLabels,
  type ConnectionState,
} from "../../hooks/useSiteFeed";
import styles from "./ConnectionStatus.module.css";

/** Whether the shared feed is live. Carries the `#connection` id the UI tests read. */
export function ConnectionStatus({
  connection,
}: {
  connection: ConnectionState;
}) {
  return (
    <span id="connection" className={styles.status}>
      <StatusDot
        state={
          connection === "live"
            ? "live"
            : connection === "unavailable"
              ? "off"
              : "pending"
        }
      />
      {connectionLabels[connection]}
    </span>
  );
}
