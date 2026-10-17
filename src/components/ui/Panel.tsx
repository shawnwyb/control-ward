import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";
import styles from "./Panel.module.css";

type PanelProps = HTMLAttributes<HTMLElement> & {
  /** The one primary panel on a screen gets the heavy top rule. */
  emphasis?: boolean;
};

export function Panel({ className, emphasis, ...rest }: PanelProps) {
  return (
    <section
      className={cx(styles.panel, emphasis && styles.emphasis, className)}
      {...rest}
    />
  );
}

type HeaderProps = {
  title: ReactNode;
  titleId?: string;
  description?: ReactNode;
  aside?: ReactNode;
};

export function PanelHeader({
  title,
  titleId,
  description,
  aside,
}: HeaderProps) {
  return (
    <header className={styles.header}>
      <div className={styles.headerText}>
        <h2 id={titleId} className={styles.title}>
          {title}
        </h2>
        {description ? (
          <p className={styles.description}>{description}</p>
        ) : null}
      </div>
      {aside ? <div className={styles.aside}>{aside}</div> : null}
    </header>
  );
}
