import { Button } from "../../components/ui";
import { localDemo } from "../../lib/supabase";
import page from "./Page.module.css";
import styles from "./Topbar.module.css";

type Props = {
  email?: string;
  onSignOut?: () => void;
  busy?: boolean;
};

export function Topbar({ email, onSignOut, busy }: Props) {
  return (
    <header className={styles.topbar}>
      <div className={`${page.page} ${styles.inner}`}>
        <a className={styles.brand} href="/" aria-label="PlanIT home">
          <span className={styles.mark} aria-hidden="true">
            <svg viewBox="0 0 32 32" width="32" height="32" fill="currentColor">
              <circle cx="8" cy="16" r="3.5" />
              <polygon points="16,11.8 19.9,19 12.1,19" />
              <polygon points="24,11.6 28.4,16 24,20.4 19.6,16" />
            </svg>
          </span>
          <span className={styles.name}>PlanIT</span>
          <span className={styles.product}>Control</span>
        </a>
        <div className={styles.right}>
          <span className={styles.environment}>
            {localDemo ? "LOCAL DEMO" : "CREW WORKSPACE"}
          </span>
          {email ? (
            <span id="identity" className={styles.identity}>
              {email}
            </span>
          ) : null}
          {onSignOut ? (
            <Button
              id="signout"
              variant="secondary"
              onClick={onSignOut}
              disabled={busy}
            >
              Sign out
            </Button>
          ) : null}
        </div>
      </div>
    </header>
  );
}
