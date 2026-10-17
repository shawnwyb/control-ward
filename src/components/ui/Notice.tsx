import { Icon } from "./Icon";
import { cx } from "./cx";
import styles from "./Notice.module.css";

type Props = {
  message?: string;
  tone?: "success" | "error";
  onDismiss?: () => void;
};

/**
 * The page's single live region, shown as a toast pinned to the viewport so
 * feedback is visible wherever the user is scrolled. The wrapper is always
 * rendered (and passes clicks through) so announcements are reliable.
 */
export function Notice({ message, tone = "success", onDismiss }: Props) {
  return (
    <div id="notice" role="status" aria-live="polite" className={styles.region}>
      {message ? (
        <div className={cx(styles.toast, styles[tone])}>
          <span className={styles.message}>{message}</span>
          {onDismiss ? (
            <button
              type="button"
              className={styles.dismiss}
              aria-label="Dismiss message"
              onClick={onDismiss}
            >
              <Icon name="close" size={18} />
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
