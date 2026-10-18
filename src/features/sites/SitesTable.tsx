import { useEffect, useMemo, useRef } from "react";
import { Icon, IndexTag, cx } from "../../components/ui";
import { rankSites, topHazards, type SiteSummary } from "../../lib/sites";
import { hazardInfo } from "./hazards";
import styles from "./SitesTable.module.css";

export type SitesView = "table" | "map";

const ROW_H = 42;

type Props = {
  sites: SiteSummary[];
  selectedId: string;
  onSelect: (siteId: string) => void;
  view: SitesView;
  onViewChange: (view: SitesView) => void;
  /** The first answer has arrived (or failed). */
  loaded: boolean;
  /** The last fetch failed. */
  error: string | null;
  className?: string;
};

const reduced = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Notion-style database view of every site, ranked by hazard index. Rows are buttons.
 * They sit in a stable DOM order (by name) and are positioned by rank, so a re-rank moves
 * the same elements and the `top` transition animates them.
 */
export function SitesTable({
  sites,
  selectedId,
  onSelect,
  view,
  onViewChange,
  loaded,
  error,
  className,
}: Props) {
  const rank = useMemo(() => {
    const map = new Map<string, number>();
    rankSites(sites).forEach((site, index) => map.set(site.siteId, index));
    return map;
  }, [sites]);
  const stable = useMemo(
    () =>
      [...sites].sort(
        (a, b) =>
          a.name.localeCompare(b.name) || a.siteId.localeCompare(b.siteId),
      ),
    [sites],
  );
  const failed = error !== null && sites.length === 0;

  // A pin picked on the map may be off screen in a long list.
  const body = useRef<HTMLDivElement>(null);
  const selectedRank = rank.get(selectedId);
  useEffect(() => {
    const el = body.current;
    if (!el || selectedRank === undefined || view !== "table") return;
    const top = selectedRank * ROW_H;
    if (top < el.scrollTop)
      el.scrollTo({ top, behavior: reduced() ? "auto" : "smooth" });
    else if (top + ROW_H > el.scrollTop + el.clientHeight)
      el.scrollTo({
        top: top + ROW_H - el.clientHeight,
        behavior: reduced() ? "auto" : "smooth",
      });
  }, [selectedRank, view]);

  return (
    <section
      className={cx(styles.table, className)}
      aria-labelledby="sites-title"
    >
      <header className={styles.head}>
        <h1 id="sites-title" className={styles.title}>
          <Icon name="table" size={20} />
          Sites
        </h1>
        <div role="group" aria-label="View" className={styles.views}>
          {(
            [
              ["table", "Table"],
              ["map", "Map"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={styles.view}
              aria-pressed={view === value}
              onClick={() => onViewChange(value)}
            >
              <Icon name={value} size={14} />
              {label}
            </button>
          ))}
        </div>
      </header>
      {view === "table" ? (
        <>
          <div className={styles.cols} aria-hidden="true">
            <span>Name</span>
            <span>Index</span>
            <span>Hazards</span>
            <span>Alerts</span>
          </div>
          {failed ? (
            <p className={styles.state} role="status">
              Couldn’t load sites. Check your connection; this page retries
              every 30 seconds.
            </p>
          ) : !loaded ? (
            <div
              className={styles.skeleton}
              aria-busy="true"
              aria-label="Loading sites"
            >
              {[0, 1, 2, 3].map((n) => (
                <span key={n} />
              ))}
            </div>
          ) : sites.length === 0 ? (
            <p className={styles.state}>No sites to show yet.</p>
          ) : (
            <div ref={body} className={styles.body}>
              <div
                className={styles.rows}
                style={{ height: sites.length * ROW_H }}
              >
                {stable.map((site) => {
                  const hazards = topHazards(site.subscores, 2);
                  const top = hazards[0];
                  return (
                    <button
                      key={site.siteId}
                      type="button"
                      className={cx(
                        styles.row,
                        site.siteId === selectedId && styles.selected,
                      )}
                      style={{ top: (rank.get(site.siteId) ?? 0) * ROW_H }}
                      aria-current={
                        site.siteId === selectedId ? "true" : undefined
                      }
                      onClick={() => onSelect(site.siteId)}
                    >
                      <span className={styles.name}>
                        <Icon
                          name={top ? hazardInfo[top].icon : "tower"}
                          size={16}
                        />
                        <span className={styles.nameText}>{site.name}</span>
                      </span>
                      <span className={styles.index}>
                        <IndexTag value={site.riskNow} />
                      </span>
                      <span className={styles.hazards}>
                        {hazards.map((key) => (
                          <span
                            key={key}
                            className={cx(
                              styles.tag,
                              styles[`tag_${hazardInfo[key].tag}`],
                            )}
                          >
                            {hazardInfo[key].name === "Severe weather"
                              ? "Weather"
                              : hazardInfo[key].name}
                          </span>
                        ))}
                      </span>
                      <span
                        className={cx(
                          styles.alerts,
                          site.activeAlerts > 0 && styles.alertsOn,
                        )}
                        aria-label={`${site.activeAlerts} active alerts`}
                      >
                        {site.activeAlerts}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </>
      ) : null}
    </section>
  );
}
