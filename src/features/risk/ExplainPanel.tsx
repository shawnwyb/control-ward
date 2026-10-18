import type { Explanation } from "../../lib/explain";
import styles from "./ExplainPanel.module.css";

/** The expanded part of a hazard row: what was read, the rule it hit, and the next step up. */
export function ExplainPanel({
  id,
  open,
  explanation,
  stale,
}: {
  id: string;
  open: boolean;
  explanation: Explanation | null;
  stale: boolean;
}) {
  return (
    <div id={id} hidden={!open} className={styles.panel}>
      {explanation ? (
        <dl className={styles.list}>
          <dt>Reading</dt>
          <dd>{explanation.reading}</dd>
          {explanation.rule ? (
            <>
              <dt>Rule</dt>
              <dd>{explanation.rule}</dd>
            </>
          ) : null}
          {explanation.next ? (
            <>
              <dt>Next</dt>
              <dd>{explanation.next}</dd>
            </>
          ) : null}
        </dl>
      ) : (
        <p className={styles.note}>Loading readings…</p>
      )}
      {stale ? (
        <p className={styles.note}>Readings updated since last score.</p>
      ) : null}
    </div>
  );
}
