import { useState, type MouseEvent } from "react";
import {
  Button,
  Icon,
  IconTile,
  SeverityTag,
  StatusTag,
} from "../../components/ui";
import { timeAgo } from "../../lib/format";
import {
  hazardLabels,
  severityLabels,
  type Report,
  type Severity,
} from "../../lib/types";
import { HistoryView } from "./HistoryView";
import styles from "./ReportRow.module.css";

type Props = {
  report: Report;
  busy: boolean;
  onCheckin: (reportId: string, stillThere: boolean) => void;
  /** A mouse click on a row shows its marker on the map. */
  onSelect: (reportId: string) => void;
};

export function ReportRow({ report, busy, onCheckin, onSelect }: Props) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const severity = report.severity as Severity;
  const count = report.confirmations;
  const linked = report.is_active;

  function select(event: MouseEvent) {
    // Only a mouse click on the row itself: buttons and links keep their meaning,
    // and on touch the map may be far off-screen.
    const pointer = (event.nativeEvent as PointerEvent).pointerType;
    if (!linked || pointer !== "mouse") return;
    if ((event.target as HTMLElement).closest("button, a")) return;
    onSelect(report.id);
  }

  return (
    <article
      className={`report-card ${styles.row}`}
      data-report-id={report.id}
      data-active={report.is_active}
      data-severity={severity}
      onClick={select}
    >
      <IconTile name={report.type} />
      <div className={styles.content}>
        <div className={styles.title}>
          <h3>{hazardLabels[report.type]}</h3>
          {report.is_active ? (
            <SeverityTag severity={severity}>
              {severityLabels[severity]}
            </SeverityTag>
          ) : (
            <StatusTag>
              {report.status === "resolved" ? "Resolved" : "Expired"}
            </StatusTag>
          )}
        </div>
        <p className={styles.meta}>
          <span>
            {count} confirmation{count === 1 ? "" : "s"},{" "}
            {timeAgo(report.last_confirmed_at)}
          </span>
          <span className={styles.coordinates}>
            {report.latitude.toFixed(4)}, {report.longitude.toFixed(4)}
          </span>
        </p>
        <div className={styles.actions}>
          {report.is_active ? (
            <>
              <Button
                variant="quiet"
                icon={<Icon name="check" />}
                disabled={busy}
                onClick={() => onCheckin(report.id, true)}
              >
                Still there
              </Button>
              <Button
                variant="quiet"
                disabled={busy}
                onClick={() => onCheckin(report.id, false)}
              >
                Gone
              </Button>
            </>
          ) : null}
          <Button
            variant="ghost"
            aria-expanded={historyOpen}
            onClick={() => setHistoryOpen((open) => !open)}
          >
            History & photos
          </Button>
        </div>
        {historyOpen ? <HistoryView reportId={report.id} /> : null}
      </div>
    </article>
  );
}
