import type { ReactNode } from "react";
import styles from "./Stat.module.css";

type Props = {
  label: string;
  /** Applied to the value element so tests and scripts can read it. */
  valueId?: string;
  value: ReactNode;
  /** Short qualifier shown beside the value, e.g. "of 10". */
  note?: ReactNode;
  /** Full explanation on hover/long-press. */
  title?: string;
};

export function Stat({ label, valueId, value, note, title }: Props) {
  return (
    <div className={styles.stat} title={title}>
      <span className={styles.label}>{label}</span>
      <span className={styles.figure}>
        <strong id={valueId} className={styles.value}>
          {value}
        </strong>
        {note ? <small className={styles.note}>{note}</small> : null}
      </span>
    </div>
  );
}
