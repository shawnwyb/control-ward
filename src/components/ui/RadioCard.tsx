import type { InputHTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";
import styles from "./RadioCard.module.css";

type Props = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type" | "children"
> & {
  /** "tile" stacks icon over label; "segment" lays out a compact row. */
  variant?: "tile" | "segment";
  /** Severity level, used to tint the checked state. */
  tone?: 1 | 2 | 3;
  children: ReactNode;
};

/**
 * A radio styled as a large touch target. The real input covers the card, so it
 * stays focusable, keyboard-operable and reachable by assistive tech.
 */
export function RadioCard({
  variant = "tile",
  tone,
  children,
  className,
  ...rest
}: Props) {
  return (
    <label className={cx(styles.card, className)} data-tone={tone}>
      <input type="radio" className={styles.input} {...rest} />
      <span className={cx(styles.face, styles[variant])}>{children}</span>
    </label>
  );
}
