/** Pure geometry for the model flow diagrams. No React or CSS imports, so Node can test it. */

export type Pt = readonly [number, number];
export type Flag = "ok" | "inspect" | "hold";

export const FLAGS: readonly Flag[] = ["ok", "inspect", "hold"];

const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

/** Distance from the first point to each point along the polyline. */
function runs(points: readonly Pt[]) {
  const run = [0];
  for (let i = 1; i < points.length; i++) {
    run.push(
      run[i - 1] +
        Math.hypot(
          points[i][0] - points[i - 1][0],
          points[i][1] - points[i - 1][1],
        ),
    );
  }
  return run;
}

/** Point and heading (degrees) a fraction `t` (0 to 1) of the way along a polyline. */
export function pointAt(points: readonly Pt[], t: number) {
  const run = runs(points);
  const d = clamp01(t) * run[run.length - 1];
  let i = 1;
  while (i < run.length - 1 && d > run[i]) i++;
  const [x0, y0] = points[i - 1];
  const [x1, y1] = points[i];
  const span = run[i] - run[i - 1];
  const f = span === 0 ? 0 : (d - run[i - 1]) / span;
  return {
    x: x0 + (x1 - x0) * f,
    y: y0 + (y1 - y0) * f,
    angle: (Math.atan2(y1 - y0, x1 - x0) * 180) / Math.PI,
  };
}

/** The part of a polyline between two fractions of its length, with interpolated end points. */
export function sliceRoute(points: readonly Pt[], t0: number, t1: number) {
  const run = runs(points);
  const total = run[run.length - 1];
  const from = clamp01(t0);
  const to = Math.max(from, clamp01(t1));
  const a = pointAt(points, from);
  const b = pointAt(points, to);
  const inside = points.filter(
    (_, i) => run[i] > from * total && run[i] < to * total,
  );
  return [[a.x, a.y], ...inside, [b.x, b.y]] as Pt[];
}

/**
 * Keyframes that carry an element along a polyline at a steady pace. It fades in
 * over the first 4 % of the trip and out over the last 6 %.
 */
export function travelKeyframes(points: readonly Pt[], steps = 40) {
  return Array.from({ length: steps + 1 }, (_, k) => {
    const t = k / steps;
    const at = pointAt(points, t);
    return {
      offset: t,
      transform: `translate(${at.x.toFixed(2)}px, ${at.y.toFixed(2)}px) rotate(${at.angle.toFixed(1)}deg)`,
      opacity: Math.min(1, t / 0.04, (1 - t) / 0.06),
    };
  });
}

/**
 * `n` flags in route order (ok, then inspect, then hold) in proportion to `counts`.
 * A flag that occurs at all keeps at least one place, so a single hold segment
 * among hundreds still shows. Returns [] when there is nothing to show.
 */
export function allocateFlags(counts: Record<Flag, number>, n: number): Flag[] {
  const total = FLAGS.reduce((sum, f) => sum + counts[f], 0);
  if (total <= 0 || n <= 0) return [];
  const exact = FLAGS.map((f) => (counts[f] / total) * n);
  const take = FLAGS.map((f, i) =>
    counts[f] > 0 ? Math.max(1, Math.floor(exact[i])) : 0,
  );
  let spare = n - take.reduce((a, b) => a + b, 0);
  while (spare !== 0) {
    // Give a place to the flag furthest below its share; take one from the one furthest above.
    let pick = -1;
    for (let i = 0; i < FLAGS.length; i++) {
      const eligible = spare > 0 ? counts[FLAGS[i]] > 0 : take[i] > 1;
      const gap = exact[i] - take[i];
      if (
        eligible &&
        (pick < 0 ||
          (spare > 0
            ? gap > exact[pick] - take[pick]
            : gap < exact[pick] - take[pick]))
      ) {
        pick = i;
      }
    }
    if (pick < 0) break;
    take[pick] += spare > 0 ? 1 : -1;
    spare += spare > 0 ? -1 : 1;
  }
  return FLAGS.flatMap((f, i) => Array<Flag>(take[i]).fill(f));
}

/** x position of a 0-to-10 value on a scale `width` wide that starts at `left`. */
export function scaleX(value: number, left: number, width: number, max = 10) {
  return left + (Math.min(max, Math.max(0, value)) / max) * width;
}
