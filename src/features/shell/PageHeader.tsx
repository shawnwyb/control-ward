import type { ReactNode } from "react";
import styles from "./PageHeader.module.css";

export function PageHeader({ actions }: { actions?: ReactNode }) {
  return (
    <section className={styles.header}>
      <h1 className={styles.title}>Crew reporting</h1>
      {actions ? <div className={styles.actions}>{actions}</div> : null}
    </section>
  );
}
