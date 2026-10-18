import { useState } from "react";
import { Badge, Icon, Panel, PanelHeader } from "../../components/ui";
import type { Report } from "../../lib/types";
import { ReportRow } from "./ReportRow";
import styles from "./ReportFeed.module.css";

type Props = {
  reports: Report[];
  reminderCount: number;
  busy: boolean;
  className?: string;
  /** Showing only the signed-in user's reports (changes the empty-state words). */
  mine?: boolean;
  onCheckin: (reportId: string, stillThere: boolean) => void;
  onSelect: (reportId: string) => void;
};

export function ReportFeed({
  reports,
  reminderCount,
  busy,
  className,
  mine,
  onCheckin,
  onSelect,
}: Props) {
  const [showResolved, setShowResolved] = useState(false);
  const visible = reports.filter((report) => showResolved || report.is_active);
  return (
    <Panel id="site-reports" className={className} aria-labelledby="feed-title">
      <PanelHeader
        titleId="feed-title"
        title={
          <>
            Site reports{" "}
            <Badge>
              <span id="feed-count">{visible.length}</span>
            </Badge>
          </>
        }
        aside={
          <label className={styles.filter} htmlFor="show-resolved">
            <input
              id="show-resolved"
              type="checkbox"
              checked={showResolved}
              onChange={(event) => setShowResolved(event.target.checked)}
            />
            Show resolved
          </label>
        }
      />
      <div id="reminders">
        {reminderCount ? (
          <div className={styles.reminder}>
            <Icon name="refresh" />
            <p>
              Your crew has {reminderCount} hazard
              {reminderCount === 1 ? "" : "s"} to check. Use “Still there” or
              “Gone” below.
            </p>
          </div>
        ) : null}
      </div>
      <div id="reports" aria-live="polite">
        {visible.length ? (
          visible.map((report) => (
            <ReportRow
              key={report.id}
              report={report}
              busy={busy}
              onCheckin={onCheckin}
              onSelect={onSelect}
            />
          ))
        ) : (
          <div className={styles.empty}>
            <Icon name="check" size={28} />
            <h3>
              {mine ? "Nothing from you yet" : "No active hazards reported"}
            </h3>
            <p>
              {mine
                ? "You haven't reported anything at this site yet."
                : "Nothing reported at this site. See something? Use “Report hazard” on the map."}
            </p>
          </div>
        )}
      </div>
    </Panel>
  );
}
