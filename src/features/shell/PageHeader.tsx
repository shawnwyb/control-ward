import type { ReactNode } from "react";
import styles from "./PageHeader.module.css";

export function PageHeader({
  actions,
  title = "Crew reporting",
}: {
  actions?: ReactNode;
  title?: string;
}) {
  return (
    <section className={styles.header}>
      <h1 className={styles.title}>{title}</h1>
      {actions ? <div className={styles.actions}>{actions}</div> : null}
    </section>
  );
}
