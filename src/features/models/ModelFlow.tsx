import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { Button, cx, Icon } from "../../components/ui";
import {
  allocateFlags,
  scaleX,
  sliceRoute,
  travelKeyframes,
  type Flag,
  type Pt,
} from "./flowGeometry";
import { WARNING_AT, WATCH_AT } from "./ModelArt";
import styles from "./ModelFlow.module.css";

/*
 * Animated architecture diagrams for the two forecast models. Each plays once when it
 * scrolls into view and again on "Replay". The stylesheet holds the motion; with reduced
 * motion it holds none, and the diagram is simply its finished state.
 */

const WIDTH = 280;
/** Column centres shared by the input chips and the four models. */
const COLS = [41, 107, 173, 239] as const;
const MID = WIDTH / 2;

const SCALE_LEFT = 22;
const SCALE_WIDTH = 236;

/** Style for the stylesheet's custom properties; `--d` is the start delay in seconds. */
const vars = (v: Record<string, string>) => v as CSSProperties;
const after = (seconds: number) => vars({ "--d": `${seconds}s` });

const prefersReducedMotion = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Holds the figure, starts the motion when the figure is first on screen, and offers "Replay". */
function FlowFrame({
  title,
  note,
  children,
}: {
  title: string;
  note: string;
  children: (playing: boolean) => ReactNode;
}) {
  const figure = useRef<HTMLElement>(null);
  const [playing, setPlaying] = useState(false);
  // A new key remounts the diagram, which restarts every animation in it.
  const [round, setRound] = useState(0);

  useEffect(() => {
    const el = figure.current;
    if (!el || playing) return;
    if (typeof IntersectionObserver === "undefined") {
      setPlaying(true);
      return;
    }
    const watcher = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) setPlaying(true);
      },
      { threshold: 0.4 },
    );
    watcher.observe(el);
    return () => watcher.disconnect();
  }, [playing]);

  return (
    <figure
      ref={figure}
      className={styles.flow}
      data-playing={playing || undefined}
    >
      <div key={round}>{children(playing)}</div>
      <figcaption className={styles.caption}>
        <span>{note}</span>
        <Button
          variant="quiet"
          className={styles.replay}
          icon={<Icon name="refresh" size={16} />}
          aria-label={`Replay the ${title} animation`}
          onClick={() => {
            setPlaying(true);
            setRound((r) => r + 1);
          }}
        >
          Replay
        </Button>
      </figcaption>
    </figure>
  );
}

/** A straight connector that draws itself, with a dot that runs along it. */
function Pipe({
  from,
  to,
  delay,
  hot,
  dot = true,
}: {
  from: Pt;
  to: Pt;
  delay: number;
  /** Delay for an amber overlay marking the winning path, if this is one. */
  hot?: number;
  dot?: boolean;
}) {
  const d = `M ${from[0]} ${from[1]} L ${to[0]} ${to[1]}`;
  return (
    <>
      <path
        d={d}
        pathLength={1}
        className={cx(styles.line, styles.draw)}
        style={after(delay)}
      />
      {hot === undefined ? null : (
        <path
          d={d}
          pathLength={1}
          className={cx(styles.lineHot, styles.draw)}
          style={after(hot)}
        />
      )}
      {dot ? (
        <circle
          cx={from[0]}
          cy={from[1]}
          r="3"
          className={styles.dot}
          style={vars({
            "--d": `${delay + 0.08}s`,
            "--dx": `${to[0] - from[0]}px`,
            "--dy": `${to[1] - from[1]}px`,
          })}
        />
      ) : null}
    </>
  );
}

/** The four input chips along the top, with their connectors down to the bus. */
function InputRow({ labels, heading }: { labels: string[]; heading: string }) {
  return (
    <>
      <text
        x="6"
        y="11"
        className={cx(styles.heading, styles.rise)}
        style={after(0)}
      >
        {heading}
      </text>
      {labels.map((label, i) => (
        <g key={label} className={styles.rise} style={after(0.05 + i * 0.07)}>
          <rect
            x={COLS[i] - 30}
            y="18"
            width="60"
            height="22"
            rx="11"
            className={styles.chip}
          />
          <text x={COLS[i]} y="29" className={styles.chipText}>
            {label}
          </text>
        </g>
      ))}
      {COLS.map((x) => (
        <Pipe key={x} from={[x, 40]} to={[x, 54]} delay={0.4} />
      ))}
      <path
        d={`M ${COLS[0]} 54 H ${COLS[3]}`}
        pathLength={1}
        className={cx(styles.line, styles.draw)}
        style={after(0.5)}
      />
    </>
  );
}

/** A 0-10 scale with its low, watch and warning bands and a marker that sweeps to `value`. */
function Scale({
  y,
  value,
  start,
}: {
  y: number;
  value: number | undefined;
  start: number;
}) {
  const clip = useId().replace(/:/g, "");
  const edges = [0, WATCH_AT, WARNING_AT, 10].map((v) =>
    scaleX(v, SCALE_LEFT, SCALE_WIDTH),
  );
  const tones = [styles.low, styles.mid, styles.high];
  return (
    <>
      <clipPath id={clip}>
        <rect x={SCALE_LEFT} y={y} width={SCALE_WIDTH} height="10" rx="5" />
      </clipPath>
      <g className={styles.rise} style={after(start)}>
        <g clipPath={`url(#${clip})`}>
          {tones.map((tone, i) => (
            <rect
              key={tone}
              x={edges[i]}
              y={y}
              width={edges[i + 1] - edges[i]}
              height="10"
              className={tone}
            />
          ))}
        </g>
        <text x={SCALE_LEFT - 9} y={y + 5} className={styles.tick}>
          0
        </text>
        <text
          x={SCALE_LEFT + SCALE_WIDTH + 9}
          y={y + 5}
          className={styles.tick}
        >
          10
        </text>
      </g>
      {value === undefined ? null : (
        <g className={styles.rise} style={after(start + 0.1)}>
          <g
            className={styles.sweep}
            style={vars({
              "--d": `${start + 0.2}s`,
              "--tx": `${scaleX(value, SCALE_LEFT, SCALE_WIDTH) - SCALE_LEFT}px`,
            })}
          >
            <path
              d={`M ${SCALE_LEFT} ${y + 13} l -6 10 h 12 z`}
              className={styles.marker}
            />
            <text x={SCALE_LEFT} y={y + 36} className={styles.value}>
              {value.toFixed(1)}
            </text>
          </g>
        </g>
      )}
    </>
  );
}

/** The rounded label where several paths meet, in two lines. */
function Pill({
  y,
  top,
  bottom,
  delay,
}: {
  y: number;
  top: string;
  bottom: string;
  delay: number;
}) {
  return (
    <g className={styles.pop} style={after(delay)}>
      <rect
        x="40"
        y={y}
        width="200"
        height="32"
        rx="16"
        className={styles.pill}
      />
      <text x={MID} y={y + 12} className={styles.pillTop}>
        {top}
      </text>
      <text x={MID} y={y + 25} className={styles.pillBottom}>
        {bottom}
      </text>
    </g>
  );
}

/* ---- Hazard Index -------------------------------------------------------- */

type Family = "heat" | "storm" | "flood" | "fire";

const FAMILIES: { key: Family; name: string }[] = [
  { key: "heat", name: "Heat" },
  { key: "storm", name: "Storm" },
  { key: "flood", name: "Flood" },
  { key: "fire", name: "Fire" },
];

/** Shown when there is no forecast for a site: relative chances and a score that agree with each other. */
const SAMPLE_CHANCE: Record<Family, number> = {
  heat: 0.55,
  storm: 0.9,
  flood: 0.3,
  fire: 0.15,
};
const SAMPLE_WINNER: Family = "storm";
const SAMPLE_INDEX = 6.5;

const TRACK_TOP = 116;
const TRACK_HEIGHT = 44;
const BAR_WIDTH = 18;

/**
 * Forecast inputs fan out to one model per hazard; each gives a chance of a recorded
 * event, those are weighted by injury severity, and the worst one sets the 0-10 index.
 * Without `probabilities` it draws an example and says so.
 */
export function HazardIndexFlow({
  score,
  probabilities,
  topDriver,
}: {
  score?: number;
  probabilities?: Record<Family, number>;
  topDriver?: string;
}) {
  const live = probabilities !== undefined && score !== undefined;
  const chances = live ? probabilities : SAMPLE_CHANCE;
  const peak = Math.max(...FAMILIES.map((f) => chances[f.key]), 0.0001);
  const winner =
    FAMILIES.find((f) => f.key === topDriver)?.key ??
    FAMILIES.reduce((a, b) => (chances[b.key] > chances[a.key] ? b : a)).key;
  const value = live ? score : SAMPLE_INDEX;

  return (
    <FlowFrame
      title="Hazard Index"
      note={live ? "This site, tomorrow." : "Example values, not a forecast."}
    >
      {() => (
        <svg
          className={styles.svg}
          viewBox={`0 0 ${WIDTH} 278`}
          role="img"
          aria-label={`How the Hazard Index is made. Forecast heat, wind, rain and season feed one model for each hazard: heat, storm, flood and fire. Each model gives the chance of a recorded event. The chances are weighted by injury severity and the worst one sets the index, from 0 to 10. It is ${value.toFixed(1)} here.`}
        >
          <InputRow
            heading="Tomorrow’s forecast"
            labels={["Heat", "Wind", "Rain", "Season"]}
          />

          {FAMILIES.map((f, i) => {
            const x = COLS[i];
            const height = Math.max(0.06, chances[f.key] / peak) * TRACK_HEIGHT;
            const won = f.key === winner;
            return (
              <g key={f.key}>
                <Pipe from={[x, 54]} to={[x, 72]} delay={0.6} />
                <g className={styles.pop} style={after(0.62 + i * 0.06)}>
                  <rect
                    x={x - 30}
                    y="72"
                    width="60"
                    height="34"
                    rx="8"
                    className={cx(styles.node, styles.flash)}
                    style={after(1.0 + i * 0.05)}
                  />
                  <text x={x} y="85" className={styles.nodeName}>
                    {f.name}
                  </text>
                  <text x={x} y="98" className={styles.nodeSub}>
                    model
                  </text>
                </g>
                <Pipe from={[x, 106]} to={[x, TRACK_TOP]} delay={0.95} />
                <g className={styles.rise} style={after(1.0)}>
                  <rect
                    x={x - BAR_WIDTH / 2}
                    y={TRACK_TOP}
                    width={BAR_WIDTH}
                    height={TRACK_HEIGHT}
                    rx="4"
                    className={styles.track}
                  />
                </g>
                {/* The losing bars dim once the worst one is picked. */}
                <g
                  className={won ? undefined : styles.lose}
                  style={after(2.45)}
                >
                  <rect
                    x={x - BAR_WIDTH / 2}
                    y={TRACK_TOP + TRACK_HEIGHT - height}
                    width={BAR_WIDTH}
                    height={height}
                    rx="4"
                    className={cx(styles.bar, won && styles.win, styles.grow)}
                    style={after(1.1 + i * 0.08)}
                  />
                </g>
                <Pipe
                  from={[x, TRACK_TOP + TRACK_HEIGHT + 4]}
                  to={[MID, 186]}
                  delay={1.9 + i * 0.04}
                  hot={won ? 2.45 : undefined}
                />
              </g>
            );
          })}

          <Pill
            y={186}
            top="chance × injury severity"
            bottom="keep the worst"
            delay={2.3}
          />
          <Pipe from={[MID, 218]} to={[MID, 234]} delay={2.7} />
          <Scale y={234} value={value} start={2.9} />
        </svg>
      )}
    </FlowFrame>
  );
}

/* ---- Mud trafficability -------------------------------------------------- */

/** The route in this diagram's units, from start to end. */
const ROUTE: Pt[] = [
  [18, 216],
  [56, 198],
  [92, 206],
  [128, 184],
  [164, 194],
  [204, 172],
  [262, 170],
];
const SEGMENTS = 12;
/** Gap between neighbouring segments, as a fraction of the route's length. */
const SEGMENT_GAP = 0.006;
const DRIVE_START = 2.7;
const DRIVE_SECONDS = 1.6;

const SAMPLE_COUNTS: Record<Flag, number> = { ok: 7, inspect: 3, hold: 2 };
const SAMPLE_MUD_SCORE = 4.5;

const PANEL_TOP = 66;
const PANEL_HEIGHT = 60;
const PANEL_WIDTH = 84;
const SURFACE = 86;
/** How far the deepest rut and the "hold" line reach below the surface, in diagram units. */
const DEEPEST = 30;
const WHEEL = 10;

const FLAG_WORD: Record<Flag, string> = {
  ok: "OK",
  inspect: "Inspect",
  hold: "Hold",
};

/** The truck, driven along the route by the Web Animations API (a path with turns is not a CSS keyframe). */
function Truck({ playing }: { playing: boolean }) {
  const ref = useRef<SVGGElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !playing || prefersReducedMotion()) return;
    const run = el.animate(travelKeyframes(ROUTE), {
      delay: DRIVE_START * 1000,
      duration: DRIVE_SECONDS * 1000,
      easing: "linear",
      fill: "both",
    });
    return () => run.cancel();
  }, [playing]);
  return (
    <g ref={ref} className={styles.truck}>
      <rect
        x="-9"
        y="-14"
        width="18"
        height="10"
        rx="2"
        className={styles.truckBody}
      />
      <circle cx="-5" cy="-3" r="3" className={styles.wheel} />
      <circle cx="5" cy="-3" r="3" className={styles.wheel} />
    </g>
  );
}

/**
 * Forecast and site data feed a rut-depth estimate for every route segment: dry ground
 * barely ruts, wet ground ruts past the "hold" line. The flagged segments colour the
 * route, and the worst tenth of it sets the 0-10 site score.
 * Without `counts` it draws an example and says so.
 */
export function MudFlow({
  counts,
  score,
  inspectIn = 4,
  holdIn = 8,
}: {
  counts?: Record<Flag, number>;
  score?: number;
  inspectIn?: number;
  holdIn?: number;
}) {
  const flags = allocateFlags(counts ?? SAMPLE_COUNTS, SEGMENTS);
  const live = counts !== undefined && flags.length > 0;
  const shown = live ? flags : allocateFlags(SAMPLE_COUNTS, SEGMENTS);
  const value = live ? score : SAMPLE_MUD_SCORE;
  const perInch = DEEPEST / holdIn;

  const panels: { title: string; flag: Flag; depth: number }[] = [
    { title: "Dry", flag: "ok", depth: 0.4 * inspectIn * perInch },
    { title: "Damp", flag: "inspect", depth: 1.3 * inspectIn * perInch },
    { title: "Wet", flag: "hold", depth: 1.15 * holdIn * perInch },
  ];

  return (
    <FlowFrame
      title="Mud trafficability"
      note={
        live
          ? "This site, tomorrow. Ground depths are schematic."
          : "Example values, not a forecast."
      }
    >
      {(playing) => (
        <svg
          className={styles.svg}
          viewBox={`0 0 ${WIDTH} 320`}
          role="img"
          aria-label={`How the mud forecast is made. Forecast rain and soil, slope and route data feed a rut-depth estimate for every route segment of about 330 feet. Ruts under ${inspectIn} inches are OK, over ${inspectIn} inches are inspect, and over ${holdIn} inches are hold. The worst tenth of the route sets the site score, from 0 to 10.${value === undefined ? "" : ` It is ${value.toFixed(1)} here.`}`}
        >
          <InputRow
            heading="Forecast and site data"
            labels={["Rain", "Soil", "Slope", "Routes"]}
          />

          {panels.map((p, i) => {
            const x = 6 + i * (PANEL_WIDTH + 8);
            const wheelX = x + 54;
            const sinkDelay = 0.9 + i * 0.2;
            return (
              <g key={p.title}>
                <Pipe
                  from={[x + PANEL_WIDTH / 2, 54]}
                  to={[x + PANEL_WIDTH / 2, PANEL_TOP]}
                  delay={0.6}
                />
                <g className={styles.rise} style={after(0.7)}>
                  <rect
                    x={x}
                    y={PANEL_TOP}
                    width={PANEL_WIDTH}
                    height={PANEL_HEIGHT}
                    rx="6"
                    className={styles.sky}
                  />
                  <path
                    d={`M ${x} ${SURFACE} H ${x + PANEL_WIDTH} V ${PANEL_TOP + PANEL_HEIGHT - 6} a 6 6 0 0 1 -6 6 H ${x + 6} a 6 6 0 0 1 -6 -6 Z`}
                    className={styles.ground}
                  />
                  {[inspectIn, holdIn].map((inches) => (
                    <line
                      key={inches}
                      x1={x}
                      x2={x + PANEL_WIDTH}
                      y1={SURFACE + inches * perInch}
                      y2={SURFACE + inches * perInch}
                      className={styles.limit}
                    />
                  ))}
                  <text
                    x={x + 7}
                    y={PANEL_TOP + 13}
                    className={styles.panelTitle}
                  >
                    {p.title}
                  </text>
                  {i === 0
                    ? [inspectIn, holdIn].map((inches) => (
                        <text
                          key={inches}
                          x={x + 7}
                          y={SURFACE + inches * perInch - 4}
                          className={styles.limitText}
                        >
                          {inches} in
                        </text>
                      ))
                    : null}
                </g>
                <g className={styles.rise} style={after(0.7)}>
                  <rect
                    x={wheelX - 13}
                    y={SURFACE}
                    width="26"
                    height={p.depth}
                    rx="3"
                    className={cx(styles.rut, styles.dig)}
                    style={after(sinkDelay)}
                  />
                  <g
                    className={styles.sink}
                    style={vars({
                      "--d": `${sinkDelay}s`,
                      "--sink": `${p.depth}px`,
                    })}
                  >
                    <circle
                      cx={wheelX}
                      cy={SURFACE - WHEEL}
                      r={WHEEL}
                      className={styles.tyre}
                    />
                    <circle
                      cx={wheelX}
                      cy={SURFACE - WHEEL}
                      r="2.5"
                      className={styles.hub}
                    />
                  </g>
                </g>
                <g className={styles.pop} style={after(1.5 + i * 0.2)}>
                  <rect
                    x={x + PANEL_WIDTH / 2 - 32}
                    y="130"
                    width="64"
                    height="18"
                    rx="9"
                    className={styles[`flag_${p.flag}`]}
                  />
                  <text
                    x={x + PANEL_WIDTH / 2}
                    y="139.5"
                    className={cx(
                      styles.flagText,
                      styles[`flagText_${p.flag}`],
                    )}
                  >
                    {FLAG_WORD[p.flag]}
                  </text>
                </g>
                <Pipe
                  from={[x + PANEL_WIDTH / 2, 148]}
                  to={[x + PANEL_WIDTH / 2, 158]}
                  delay={2.0}
                />
              </g>
            );
          })}

          <g className={styles.rise} style={after(2.2)}>
            <rect
              x="6"
              y="158"
              width="268"
              height="62"
              rx="8"
              className={styles.sky}
            />
            <text x="14" y="171" className={styles.panelTitle}>
              ~330 ft segments
            </text>
          </g>
          {shown.map((flag, i) => (
            <g key={i} className={styles.rise} style={after(2.3 + i * 0.015)}>
              <path
                d={`M ${sliceRoute(
                  ROUTE,
                  i / SEGMENTS + SEGMENT_GAP,
                  (i + 1) / SEGMENTS - SEGMENT_GAP,
                )
                  .map(([px, py]) => `${px.toFixed(1)} ${py.toFixed(1)}`)
                  .join(" L ")}`}
                className={cx(
                  styles.segment,
                  styles[`segment_${flag}`],
                  styles.recolor,
                )}
                style={after(
                  DRIVE_START + ((i + 0.5) / SEGMENTS) * DRIVE_SECONDS,
                )}
              />
            </g>
          ))}
          <Truck playing={playing} />

          <Pipe from={[MID, 220]} to={[MID, 230]} delay={4.3} />
          <Pill
            y={230}
            top="Worst 10% of route"
            bottom="sets the score"
            delay={4.45}
          />
          <Pipe from={[MID, 262]} to={[MID, 276]} delay={4.8} />
          <Scale y={276} value={value} start={4.95} />
        </svg>
      )}
    </FlowFrame>
  );
}
