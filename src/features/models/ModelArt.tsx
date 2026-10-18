import styles from "./ModelArt.module.css";

/** Hazard index tier edges: about 3 is a watch, 7.5 a warning, 10 stop work. */
export const WATCH_AT = 3;
export const WARNING_AT = 7.5;

/** Point on the gauge arc for a 0-10 value (0 at left, 10 at right). */
function arcPoint(value: number, radius: number) {
  const angle = Math.PI * (1 - Math.min(10, Math.max(0, value)) / 10);
  return {
    x: 100 + radius * Math.cos(angle),
    y: 100 - radius * Math.sin(angle),
  };
}

function arc(from: number, to: number) {
  const a = arcPoint(from, 80);
  const b = arcPoint(to, 80);
  return `M ${a.x} ${a.y} A 80 80 0 0 1 ${b.x} ${b.y}`;
}

/** Half-circle 0-10 gauge with the low, watch and warning bands; no needle without a value. */
export function Gauge({ value }: { value?: number }) {
  const tip = value === undefined ? null : arcPoint(value, 66);
  return (
    <svg className={styles.art} viewBox="0 0 200 128" aria-hidden="true">
      <g fill="none" strokeWidth="16">
        <path d={arc(0, WATCH_AT)} stroke="var(--risk-low)" />
        <path d={arc(WATCH_AT, WARNING_AT)} stroke="var(--art-amber)" />
        <path d={arc(WARNING_AT, 10)} stroke="var(--risk-high)" />
      </g>
      {tip ? (
        <>
          <line
            x1="100"
            y1="100"
            x2={tip.x}
            y2={tip.y}
            stroke="var(--ink)"
            strokeWidth="4"
            strokeLinecap="round"
          />
          <circle cx="100" cy="100" r="8" fill="var(--ink)" />
        </>
      ) : null}
      <text x="20" y="124" className={styles.tick} textAnchor="middle">
        0
      </text>
      <text x="180" y="124" className={styles.tick} textAnchor="middle">
        10
      </text>
    </svg>
  );
}

export type MudFlag = "ok" | "inspect" | "hold";

const FLAG_COLOR: Record<MudFlag, string> = {
  ok: "var(--risk-low)",
  inspect: "var(--art-amber)",
  hold: "var(--risk-high)",
};

/** The drawn route, start to end, in viewBox units. */
const ROUTE: [number, number][] = [
  [10, 94],
  [50, 74],
  [80, 82],
  [110, 51],
  [140, 62],
  [170, 26],
  [202, 8],
];
const ROUTE_D = `M ${ROUTE.map(([x, y]) => `${x} ${y}`).join(" L ")}`;
const LEGS = ROUTE.slice(1).map(([x, y], i) =>
  Math.hypot(x - ROUTE[i][0], y - ROUTE[i][1]),
);
const ROUTE_LEN = LEGS.reduce((a, b) => a + b, 0);

/** Point and heading (degrees) at a fraction 0-1 along the route. */
function routeAt(fraction: number) {
  let left = Math.min(1, Math.max(0, fraction)) * ROUTE_LEN;
  for (let i = 0; i < LEGS.length; i++) {
    if (left <= LEGS[i] || i === LEGS.length - 1) {
      const [x0, y0] = ROUTE[i];
      const [x1, y1] = ROUTE[i + 1];
      const t = Math.min(1, left / LEGS[i]);
      return {
        x: x0 + (x1 - x0) * t,
        y: y0 + (y1 - y0) * t,
        angle: (Math.atan2(y1 - y0, x1 - x0) * 180) / Math.PI,
      };
    }
    left -= LEGS[i];
  }
  return { x: ROUTE[0][0], y: ROUTE[0][1], angle: 0 };
}

function Cart({ fraction, fill }: { fraction: number; fill: string }) {
  const at = routeAt(fraction);
  return (
    <g transform={`translate(${at.x} ${at.y}) rotate(${at.angle})`}>
      {/* The outline keeps the cart visible on a stretch of its own colour. */}
      <rect
        x="-9"
        y="-14"
        width="18"
        height="10"
        rx="2"
        fill={fill}
        stroke="var(--bg)"
        strokeWidth="1.5"
      />
      <circle cx="-5" cy="-3" r="3" fill="var(--ink)" />
      <circle cx="5" cy="-3" r="3" fill="var(--ink)" />
    </g>
  );
}

/** The flag a 0-10 model score falls in, on the gauge's watch and warning edges. */
export function scoreFlag(score: number): MudFlag {
  if (score >= WARNING_AT) return "hold";
  if (score >= WATCH_AT) return "inspect";
  return "ok";
}

/**
 * The route split by share of segments that are ok, inspect and hold, with the cart
 * parked mid-way along the worst stretch and coloured by `cart` (one equipment's worst
 * flag). With only a 0-10 `score`, the route is banded like the gauge and the cart
 * sits at the score. With neither it draws a fixed illustration.
 */
export function RouteArt({
  counts,
  cart,
  score,
}: {
  counts?: Record<MudFlag, number>;
  cart?: MudFlag;
  score?: number;
}) {
  const total = counts ? counts.ok + counts.inspect + counts.hold : 0;
  if (!(counts && total > 0) && score !== undefined) {
    const at = Math.min(10, Math.max(0, score));
    const bands = [
      { flag: "ok" as const, start: 0, share: WATCH_AT * 10 },
      {
        flag: "inspect" as const,
        start: WATCH_AT * 10,
        share: (WARNING_AT - WATCH_AT) * 10,
      },
      {
        flag: "hold" as const,
        start: WARNING_AT * 10,
        share: (10 - WARNING_AT) * 10,
      },
    ];
    return (
      <svg className={styles.art} viewBox="0 0 220 110" aria-hidden="true">
        <g
          fill="none"
          strokeWidth="7"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {/* Past the cart the route is muted: only the stretch up to the score is coloured. */}
          <path d={ROUTE_D} stroke="var(--tag-gray-bg)" />
          {bands.map((b) => {
            const share = Math.min(b.share, at * 10 - b.start);
            return share > 0 ? (
              <path
                key={b.flag}
                d={ROUTE_D}
                pathLength={100}
                stroke={FLAG_COLOR[b.flag]}
                strokeDasharray={`${share} 100`}
                strokeDashoffset={-b.start}
              />
            ) : null;
          })}
        </g>
        <Cart fraction={at / 10} fill={FLAG_COLOR[scoreFlag(at)]} />
      </svg>
    );
  }
  if (counts && total > 0) {
    let start = 0;
    const stretches = (["ok", "inspect", "hold"] as const).map((flag) => {
      const share = (counts[flag] / total) * 100;
      const stretch = { flag, start, share };
      start += share;
      return stretch;
    });
    const worst =
      [...stretches].reverse().find((s) => s.share > 0) ?? stretches[0];
    return (
      <svg className={styles.art} viewBox="0 0 220 110" aria-hidden="true">
        <g
          fill="none"
          strokeWidth="7"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {stretches.map((s) =>
            s.share > 0 ? (
              <path
                key={s.flag}
                d={ROUTE_D}
                pathLength={100}
                stroke={FLAG_COLOR[s.flag]}
                strokeDasharray={`${s.share} 100`}
                strokeDashoffset={-s.start}
              />
            ) : null,
          )}
        </g>
        <Cart
          fraction={(worst.start + worst.share / 2) / 100}
          fill={cart ? FLAG_COLOR[cart] : "var(--art-truck)"}
        />
      </svg>
    );
  }
  return (
    <svg className={styles.art} viewBox="0 0 220 110" aria-hidden="true">
      <g
        fill="none"
        strokeWidth="7"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <polyline points="140,62 170,26 202,8" stroke="var(--tag-gray-bg)" />
        <polyline points="10,94 50,74 80,82" stroke="var(--risk-low)" />
        <polyline points="80,82 110,51" stroke="var(--art-amber)" />
        <polyline points="110,51 140,62" stroke="var(--risk-high)" />
      </g>
      <rect
        x="108"
        y="38"
        width="18"
        height="10"
        rx="2"
        fill="var(--art-truck)"
      />
      <circle cx="112" cy="49" r="3" fill="var(--ink)" />
      <circle cx="122" cy="49" r="3" fill="var(--ink)" />
    </svg>
  );
}
