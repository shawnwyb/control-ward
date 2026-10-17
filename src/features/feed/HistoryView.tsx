import { useEffect, useState } from "react";
import { fetchHistory, type HazardHistory } from "../../lib/api";
import { errorMessage } from "../../lib/format";
import styles from "./HistoryView.module.css";

type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; history: HazardHistory };

export function HistoryView({ reportId }: { reportId: string }) {
  const [state, setState] = useState<State>({ status: "loading" });
  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    fetchHistory(reportId)
      .then((history) => !cancelled && setState({ status: "ready", history }))
      .catch(
        (error) =>
          !cancelled &&
          setState({ status: "error", message: errorMessage(error) }),
      );
    return () => {
      cancelled = true;
    };
  }, [reportId]);

  return (
    <div
      id={`history-${reportId}`}
      className={`history-content ${styles.history}`}
    >
      {state.status === "loading" ? "Loading history…" : null}
      {state.status === "error" ? state.message : null}
      {state.status === "ready" ? (
        <>
          <ul className={styles.list}>
            {state.history.observations.map((observation) => (
              <li key={observation.id}>
                {observation.action} · severity {observation.severity} ·{" "}
                {new Date(observation.created_at).toLocaleString()}
              </li>
            ))}
          </ul>
          <div className={styles.gallery}>
            {state.history.photoUrls.map((url) => (
              <a key={url} href={url} target="_blank" rel="noopener">
                <img src={url} alt="Crew hazard photo" loading="lazy" />
              </a>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
