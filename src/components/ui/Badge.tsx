import type { HTMLAttributes } from "react";
import type { Severity } from "../../lib/types";
import { cx } from "./cx";
import { SeverityMark } from "./SeverityMark";
import styles from "./Badge.module.css";

/** Small mono label for counts and fixed facts (e.g. map extent). */
export function Badge({ className, ...rest }: HTMLAttributes<HTMLSpanElement>) {
  return <span className={cx(styles.badge, className)} {...rest} />;
}

type TagProps = { severity: Severity; children: string };

/** Severity or status label: shape + word, tinted by the signal scale. */
export function SeverityTag({ severity, children }: TagProps) {
  return (
    <span className={cx(styles.tag, styles[`sev${severity}`])}>
      <SeverityMark severity={severity} size={12} />
      {children}
    </span>
  );
}

export function StatusTag({ children }: { children: string }) {
  return <span className={cx(styles.tag, styles.neutral)}>{children}</span>;
}
