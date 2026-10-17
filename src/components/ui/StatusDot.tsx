import { cx } from "./cx";
import styles from "./StatusDot.module.css";

type Props = { state: "live" | "pending" | "off"; className?: string };

export function StatusDot({ state, className }: Props) {
  return (
    <span
      aria-hidden="true"
      className={cx(styles.dot, styles[state], className)}
    />
  );
}
