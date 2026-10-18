import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
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
 * Rows are in rank order in the DOM (reading and Tab order match the screen); a re-rank
 * slides them to their new places (FLIP), unless the user prefers reduced motion.
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
  // Rows are in rank order in the DOM, so reading and Tab order match what is on screen.
  const ranked = useMemo(() => rankSites(sites), [sites]);
  const order = ranked.map((site) => site.siteId).join("|");
  const rank = new Map(ranked.map((site, index) => [site.siteId, index]));

  // FLIP: when the ranking changes, each row starts at its old place and slides to the new one.
  const list = useRef<HTMLUListElement>(null);
  const tops = useRef(new Map<string, number>());
  const lastFocus = useRef<{ id: string; at: number } | null>(null);
  useLayoutEffect(() => {
    const el = list.current;
    if (!el) return;
    const items = [...el.children] as HTMLLIElement[];
    const animate = !reduced();
    for (const item of items) {
      const id = item.dataset.id!;
      const before = tops.current.get(id);
      if (animate && before !== undefined && before !== item.offsetTop)
        item.animate(
          [
            { transform: `translateY(${before - item.offsetTop}px)` },
            { transform: "none" },
          ],
          { duration: 700, easing: "cubic-bezier(0.3, 1.4, 0.5, 1)" },
        );
      tops.current.set(id, item.offsetTop);
    }
    // Moving a DOM node drops its focus; give it back to the row that just had it.
    const lost = lastFocus.current;
    if (
      lost &&
      Date.now() - lost.at < 100 &&
      document.activeElement === document.body
    )
      items
        .find((item) => item.dataset.id === lost.id)
        ?.querySelector("button")
        ?.focus({ preventScroll: true });
  }, [order]);
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
              <ul ref={list} className={styles.rows} role="list">
                {ranked.map((site) => {
                  const hazards = topHazards(site.subscores, 2);
                  const top = hazards[0];
                  return (
                    <li key={site.siteId} data-id={site.siteId}>
                      <button
                        type="button"
                        className={cx(
                          styles.row,
                          site.siteId === selectedId && styles.selected,
                        )}
                        aria-current={
                          site.siteId === selectedId ? "true" : undefined
                        }
                        onClick={() => onSelect(site.siteId)}
                        onBlur={() =>
                          (lastFocus.current = {
                            id: site.siteId,
                            at: Date.now(),
                          })
                        }
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
                        >
                          <span aria-hidden="true">{site.activeAlerts}</span>
                          <span className={styles.sr}>
                            {site.activeAlerts === 1
                              ? "1 active alert"
                              : `${site.activeAlerts} active alerts`}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </>
      ) : null}
    </section>
  );
}
