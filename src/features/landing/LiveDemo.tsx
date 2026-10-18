import { useEffect, useRef, useState } from "react";
import { Icon, type IconName } from "../../components/ui/Icon";
import { IndexTag } from "../../components/ui/Badge";
import { riskLevel } from "../../lib/risk";
import { rankSites } from "../../lib/sites";
import { MiniMap } from "./MiniMap";
import styles from "./LiveDemo.module.css";

const START_VIEW = [40, 60, 440, 280];
const END_VIEW = [50, 120, 250, 160];
const LOOP_MS = 11000;
const ROW_H = 42;
const COUNTDOWN_START = 30 * 60;

type DemoRow = {
  id: string;
  name: string;
  icon: IconName;
  from: number;
  to: number;
};
const ROWS: DemoRow[] = [
  { id: "tam", name: "Tamiami Yard", icon: "heat", from: 6.9, to: 6.9 },
  { id: "hol", name: "Hollis River Line", icon: "flood", from: 6.4, to: 6.4 },
  { id: "bcs", name: "Big Cypress Sub", icon: "bolt", from: 6.1, to: 8.6 },
  { id: "cti", name: "Coastal Tie-in", icon: "wind", from: 4.1, to: 4.1 },
  { id: "nls", name: "North Lake Sub", icon: "wildlife", from: 2.3, to: 2.3 },
];

type Cursor = { x: number; y: number; show: boolean; click: boolean };
const HIDDEN_CURSOR: Cursor = { x: 0, y: 0, show: false, click: false };

const ease = (k: number) =>
  k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
const clock = (secs: number) =>
  `${String(Math.floor(secs / 60)).padStart(2, "0")}:${String(secs % 60).padStart(2, "0")}`;
const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const LABEL =
  "Animated demo: a lightning strike near Big Cypress Sub raises its hazard index from 6.1 to 8.6, " +
  "moves it to the top of the supervisor's site list, and posts a stop-work banner with a 30 minute countdown.";

/** A looping, decorative replay of the supervisor view reacting to a lightning strike. */
export function LiveDemo() {
  const [reduce] = useState(prefersReducedMotion);
  const [started, setStarted] = useState(false);
  const [score, setScore] = useState(reduce ? 8.6 : 6.1);
  const [sorted, setSorted] = useState(reduce);
  const [strike, setStrike] = useState(reduce);
  const [hot, setHot] = useState(reduce);
  const [selected, setSelected] = useState(false);
  const [toast, setToast] = useState(reduce);
  const [secs, setSecs] = useState(COUNTDOWN_START);
  const [cursor, setCursor] = useState<Cursor>(HIDDEN_CURSOR);

  const rootRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<HTMLDivElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  // Start when scrolled into view.
  useEffect(() => {
    const root = rootRef.current;
    if (!root || reduce) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setStarted(true);
          observer.disconnect();
        }
      },
      { threshold: 0.4 },
    );
    observer.observe(root);
    return () => observer.disconnect();
  }, [reduce]);

  // The timeline. Everything it starts is tracked so unmounting clears it all.
  useEffect(() => {
    if (!started || reduce) return;
    const timers = new Set<number>();
    const frames = new Set<number>();
    let tick: number | undefined;

    const at = (ms: number, fn: () => void) => {
      const id = window.setTimeout(() => {
        timers.delete(id);
        fn();
      }, ms);
      timers.add(id);
    };
    const animate = (ms: number, step: (k: number) => void) => {
      const t0 = performance.now();
      const frame = (now: number) => {
        const k = Math.min(1, (now - t0) / ms);
        step(k);
        if (k < 1) frames.add(requestAnimationFrame(frame));
      };
      frames.add(requestAnimationFrame(frame));
    };
    const stopAll = () => {
      timers.forEach(clearTimeout);
      frames.forEach(cancelAnimationFrame);
      timers.clear();
      frames.clear();
      if (tick !== undefined) clearInterval(tick);
      tick = undefined;
    };
    const setView = (view: number[]) =>
      svgRef.current?.setAttribute("viewBox", view.join(" "));

    const bcs = ROWS.find((r) => r.id === "bcs")!;
    const run = () => {
      stopAll();
      setScore(bcs.from);
      setSorted(false);
      setStrike(false);
      setHot(false);
      setSelected(false);
      setToast(false);
      setSecs(COUNTDOWN_START);
      setCursor(HIDDEN_CURSOR);
      setView(START_VIEW);

      at(900, () => setStrike(true));
      at(1500, () => {
        setHot(true);
        animate(900, (k) => setScore(bcs.from + (bcs.to - bcs.from) * k));
      });
      at(2500, () => setSorted(true));
      at(3100, () => {
        setToast(true);
        let left = COUNTDOWN_START;
        tick = window.setInterval(() => setSecs(--left), 1000);
      });
      at(4300, () => {
        const root = rootRef.current?.getBoundingClientRect();
        const map = mapRef.current?.getBoundingClientRect();
        if (root && map)
          setCursor({
            x: map.left - root.left + map.width * 0.7,
            y: map.top - root.top + map.height * 0.85,
            show: true,
            click: false,
          });
      });
      at(4500, () => {
        const root = rootRef.current?.getBoundingClientRect();
        const row = rowRef.current?.getBoundingClientRect();
        if (root && row)
          setCursor({
            x: row.left - root.left + row.width * 0.45,
            y: row.top - root.top + row.height * 0.55,
            show: true,
            click: false,
          });
      });
      at(5600, () => {
        setSelected(true);
        setCursor((c) => ({ ...c, click: true }));
        at(5850, () => setCursor((c) => ({ ...c, click: false })));
      });
      at(5900, () => {
        setCursor((c) => ({ ...c, show: false }));
        animate(1300, (k) =>
          setView(
            START_VIEW.map((from, i) => from + (END_VIEW[i] - from) * ease(k)),
          ),
        );
      });
      at(LOOP_MS, run);
    };
    run();
    return stopAll;
  }, [started, reduce]);

  const shown = (row: DemoRow) => (row.id === "bcs" ? score : row.from);
  const orderOf = (row: DemoRow) => (sorted ? row.to : row.from);
  const ranked = rankSites(
    ROWS.map((row) => ({ ...row, name: row.name, riskNow: orderOf(row) })),
  );
  const rank = (id: string) => ranked.findIndex((row) => row.id === id);

  const pinColor =
    riskLevel(score).tone === "danger"
      ? "var(--risk-high)"
      : "var(--risk-elevated)";
  const high = riskLevel(score).tone === "danger";

  return (
    <div ref={rootRef} className={styles.demo} role="img" aria-label={LABEL}>
      <div className={styles.side} aria-hidden="true">
        <div className={styles.workspace}>
          <i />
          PlanIT Control
        </div>
        <div className={styles.item}>
          <Icon name="globe" size={16} />
          Overview
        </div>
        <div className={`${styles.item} ${styles.on}`}>
          <Icon name="tower" size={16} />
          Sites
        </div>
        <div className={styles.item}>
          <Icon name="bell" size={16} />
          Alerts
          <span
            className={`${styles.badge} ${toast ? styles.badgeOn : ""}`}
            data-demo-badge
          >
            1
          </span>
        </div>
        <div className={styles.item}>
          <Icon name="brief" size={16} />
          Next-day briefing
        </div>
        <div className={styles.item}>
          <Icon name="camera" size={16} />
          Crew reports
        </div>
      </div>

      <div className={styles.list} aria-hidden="true">
        <div className={styles.title}>
          <Icon name="tower" size={18} />
          Sites
        </div>
        <div className={styles.head}>
          <span>Name</span>
          <span>Index</span>
        </div>
        <div className={styles.rows}>
          {ROWS.map((row) => {
            const isBcs = row.id === "bcs";
            const r = rank(row.id);
            return (
              <div
                key={row.id}
                ref={isBcs ? rowRef : undefined}
                data-demo-row
                data-rank={r}
                className={`${styles.row} ${isBcs && hot ? styles.hot : ""} ${isBcs && selected ? styles.sel : ""}`}
                style={{ top: r * ROW_H }}
              >
                <span className={styles.name}>
                  <Icon name={row.icon} size={14} />
                  {row.name}
                </span>
                <IndexTag value={Number(shown(row).toFixed(1))} />
              </div>
            );
          })}
        </div>
      </div>

      <div ref={mapRef} className={styles.map} aria-hidden="true">
        <MiniMap
          calm
          svgRef={svgRef}
          viewBox={(reduce ? END_VIEW : START_VIEW).join(" ")}
        >
          <g className={styles.pulseWrap} style={{ opacity: high ? 1 : 0 }}>
            {high && (
              <circle className={styles.pulse} cx="150" cy="222" r="10" />
            )}
          </g>
          {strike && (
            <g className={styles.strike}>
              <circle
                className={`${styles.ring} ${reduce ? styles.ringDone : ""}`}
                cx="112"
                cy="196"
                r="4"
              />
              <path
                className={styles.bolt}
                d="M114 178 l-9 17 h7 l-5 15 15 -20 h-7 l6 -12z"
              />
            </g>
          )}
          <g
            transform="translate(150 230)"
            fontFamily="ui-sans-serif,-apple-system,Segoe UI,sans-serif"
            fontSize="11"
            fontWeight="600"
          >
            <path
              d="M0 0 l-6 -9 h12z"
              className={styles.pin}
              style={{ fill: pinColor }}
            />
            <rect
              x="-18"
              y="-27"
              width="36"
              height="18"
              rx="9"
              className={styles.pin}
              style={{ fill: pinColor }}
            />
            <text y="-14" fill="#fff" textAnchor="middle">
              {score.toFixed(1)}
            </text>
          </g>
        </MiniMap>
        <div
          className={`${styles.toast} ${toast ? styles.toastIn : ""}`}
          data-demo-banner
        >
          <span className={styles.toastIcon}>
            <Icon name="bolt" size={18} />
          </span>
          <span className={styles.toastText}>
            <b>Stop work · Big Cypress Sub</b>
            <small>Lightning 6 mi west · all clear in</small>
          </span>
          <span className={styles.count}>{clock(secs)}</span>
        </div>
      </div>

      <svg
        className={`${styles.cursor} ${cursor.click ? styles.click : ""}`}
        style={{
          left: cursor.x,
          top: cursor.y,
          opacity: cursor.show ? 1 : 0,
        }}
        width="18"
        height="22"
        viewBox="0 0 18 22"
        aria-hidden="true"
        focusable="false"
      >
        <path
          d="M1 1l15 11-7 1 4 8-3 1-4-8-5 5z"
          fill="#37352f"
          stroke="#fff"
          strokeWidth="1.2"
        />
      </svg>
    </div>
  );
}
