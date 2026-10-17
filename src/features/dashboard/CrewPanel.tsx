import { Badge, Panel, PanelHeader } from "../../components/ui";
import { timeAgo } from "../../lib/format";
import type { CrewMember } from "../../lib/monitoring";
import { CrewAccess } from "./CrewAccess";
import styles from "./Dashboard.module.css";
import { RemoveCrew } from "./RemoveCrew";

type Props = {
  crew: CrewMember[];
  loaded: boolean;
  siteId: string;
  siteName: string;
  /** Reload the roster after someone is added or removed. */
  onCrewChanged: () => void;
  selected: Set<string>;
  onToggle: (userId: string) => void;
  onSelectAll: (all: boolean) => void;
  onLocate: (member: CrewMember) => void;
};

export function CrewPanel({
  crew,
  loaded,
  siteId,
  siteName,
  onCrewChanged,
  selected,
  onToggle,
  onSelectAll,
  onLocate,
}: Props) {
  const workers = crew.filter((m) => m.role === "crew");
  const allSelected =
    workers.length > 0 && workers.every((m) => selected.has(m.user_id));
  return (
    <Panel id="crew" aria-labelledby="crew-title">
      <PanelHeader
        titleId="crew-title"
        title="Crew"
        description="Last known location from workers who share it. Tick people to message them."
        aside={<Badge>{workers.length}</Badge>}
      />
      <CrewAccess
        siteId={siteId}
        siteName={siteName}
        onChanged={onCrewChanged}
      />
      {loaded && workers.length === 0 ? (
        <p className={styles.muted}>No crew are assigned to this site yet.</p>
      ) : null}
      {workers.length ? (
        <label className={styles.toggle}>
          <input
            type="checkbox"
            checked={allSelected}
            onChange={(event) => onSelectAll(event.target.checked)}
          />
          Select everyone
        </label>
      ) : null}
      <ul className={styles.roster} id="crew-roster">
        {workers.map((m) => (
          <li key={m.user_id} className={styles.person}>
            <input
              type="checkbox"
              aria-label={`Select ${m.name}`}
              checked={selected.has(m.user_id)}
              onChange={() => onToggle(m.user_id)}
            />
            <span className={styles.personName}>
              {m.name}
              <span className={styles.personMeta}>
                {m.latitude === null || !m.located_at
                  ? "Location not shared"
                  : `Last seen ${timeAgo(m.located_at)}${m.is_stale ? " · may have moved" : ""}`}
              </span>
            </span>
            <span className={styles.flags}>
              {m.latitude !== null ? (
                <button
                  type="button"
                  className={styles.toggle}
                  onClick={() => onLocate(m)}
                >
                  Show on map
                </button>
              ) : null}
              <Badge>{m.has_push ? "Push on" : "No push"}</Badge>
              <RemoveCrew
                siteId={siteId}
                siteName={siteName}
                member={m}
                onChanged={onCrewChanged}
              />
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
