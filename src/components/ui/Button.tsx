import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";
import styles from "./Button.module.css";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "quiet" | "ghost";
  /** Stretch to the full width of the container. */
  block?: boolean;
  /** Work in progress: keeps full contrast, shows a spinner, ignores clicks. */
  busy?: boolean;
  icon?: ReactNode;
};

export function Button({
  variant = "secondary",
  block,
  busy,
  icon,
  className,
  children,
  type = "button",
  disabled,
  ...rest
}: Props) {
  return (
    <button
      type={type}
      className={cx(
        styles.button,
        styles[variant],
        block && styles.block,
        className,
      )}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      data-busy={busy || undefined}
      {...rest}
    >
      {busy ? <span className={styles.spinner} aria-hidden="true" /> : icon}
      {children}
    </button>
  );
}
