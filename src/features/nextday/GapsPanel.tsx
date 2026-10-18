import { Panel, PanelHeader } from "../../components/ui";
import type { NextDayReport } from "../../lib/nextDayReport";
import styles from "./NextDayReport.module.css";

const WORD: Record<string, string> = {
  missing: "Missing",
  stale: "Out of date",
  not_applicable: "Not applicable",
  ok: "Note",
};

/** Every input that is missing, old or not applicable, with the reason. Nothing is dropped silently. */
export function GapsPanel({ report }: { report: NextDayReport }) {
  return (
    <Panel id="gaps" aria-labelledby="gaps-title">
      <PanelHeader
        title="Data gaps and limits"
        titleId="gaps-title"
        description="What this report could not use, and what its numbers cannot tell you."
      />
      {report.gaps.length ? (
        <ul className={styles.plain}>
          {report.gaps.map((g) => (
            <li key={`${g.section}-${g.reason}`}>
              <strong>
                {WORD[g.status] ?? g.status}:{" "}
                {g.section.replace(".", " / ").replace("_", " ")}.
              </strong>{" "}
              {g.reason}
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.muted}>Every input was available.</p>
      )}
      <h3 className={styles.sub}>Limits that always apply</h3>
      <ul className={styles.list}>
        {report.limits.map((l) => (
          <li key={l} className={styles.muted}>
            {l}
          </li>
        ))}
      </ul>
    </Panel>
  );
}
