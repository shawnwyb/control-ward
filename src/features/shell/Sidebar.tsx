import { Button, Field, Icon, Select, StatusDot } from "../../components/ui";
import type { IconName } from "../../components/ui";
import {
  connectionLabels,
  type ConnectionState,
} from "../../hooks/useSiteFeed";
import type { Role } from "../../lib/monitoring";
import type { Page } from "../../lib/route";
import { localDemo } from "../../lib/supabase";
import type { Site } from "../../lib/types";
import styles from "./Sidebar.module.css";

type Item = { page: Page; label: string; icon: IconName };

const supervisorItems: Item[] = [
  { page: "sites", label: "Sites", icon: "tower" },
  { page: "alerts", label: "Alerts", icon: "bell" },
  { page: "briefing", label: "Next-day briefing", icon: "brief" },
  { page: "crew", label: "Crew", icon: "paw" },
  { page: "reports", label: "Reports", icon: "camera" },
];

const crewItems: Item[] = [
  { page: "site", label: "My site", icon: "tower" },
  { page: "alerts", label: "Alerts", icon: "bell" },
  { page: "briefing", label: "Tomorrow's briefing", icon: "brief" },
  { page: "reports", label: "Reports", icon: "camera" },
];

type Props = {
  /** Unknown until the first site loads; the page links wait for it. */
  role?: Role;
  sites: Site[];
  siteId?: string;
  onSiteChange: (siteId: string) => void;
  page: Page;
  onNavigate: (page: Page) => void;
  alertCount: number;
  email?: string;
  onSignOut?: () => void;
  busy?: boolean;
  connection: ConnectionState;
};

export function Sidebar({
  role,
  sites,
  siteId,
  onSiteChange,
  page,
  onNavigate,
  alertCount,
  email,
  onSignOut,
  busy,
  connection,
}: Props) {
  const items = role === "supervisor" ? supervisorItems : crewItems;
  return (
    <div className={styles.sidebar}>
      <div className={styles.workspace}>
        <span className={styles.mark} aria-hidden="true">
          <svg viewBox="0 0 32 32" width="16" height="16" fill="currentColor">
            <circle cx="8" cy="16" r="3.5" />
            <polygon points="16,11.8 19.9,19 12.1,19" />
            <polygon points="24,11.6 28.4,16 24,20.4 19.6,16" />
          </svg>
        </span>
        <span className={styles.name}>PlanIT Control</span>
      </div>
      {sites.length ? (
        <Field
          id="site"
          label={role === "supervisor" ? "Site" : "Your site"}
          className={styles.switcher}
        >
          <Select
            id="site"
            value={siteId ?? ""}
            disabled={busy}
            onChange={(event) => onSiteChange(event.target.value)}
          >
            {sites.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.name}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}
      {role ? (
        <nav aria-label="Pages" className={styles.nav}>
          {items.map((item) => (
            <a
              key={item.page}
              href={`#/${item.page}`}
              className={styles.item}
              aria-current={page === item.page ? "page" : undefined}
              onClick={(event) => {
                // Plain clicks go through the router; modified clicks keep the browser's behavior.
                if (
                  event.metaKey ||
                  event.ctrlKey ||
                  event.shiftKey ||
                  event.button !== 0
                )
                  return;
                event.preventDefault();
                onNavigate(item.page);
              }}
            >
              <Icon name={item.icon} size={16} className={styles.icon} />
              <span className={styles.label}>{item.label}</span>
              {item.page === "alerts" && alertCount > 0 ? (
                <span className={styles.count}>
                  {alertCount}
                  <span className={styles.sr}> active</span>
                </span>
              ) : null}
            </a>
          ))}
        </nav>
      ) : null}
      <div className={styles.footer}>
        {sites.length ? (
          <span
            id="connection"
            className={styles.connection}
            title="Shared with your site team"
          >
            <StatusDot
              state={
                connection === "live"
                  ? "live"
                  : connection === "unavailable"
                    ? "off"
                    : "pending"
              }
            />
            {connectionLabels[connection]}
          </span>
        ) : null}
        {localDemo ? <span className={styles.identity}>Local demo</span> : null}
        {email ? (
          <span id="identity" className={styles.identity}>
            {email}
          </span>
        ) : null}
        {onSignOut ? (
          <Button
            id="signout"
            variant="secondary"
            block
            onClick={onSignOut}
            disabled={busy}
          >
            Sign out
          </Button>
        ) : null}
      </div>
    </div>
  );
}
