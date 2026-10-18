import type { Severity } from "../../lib/types";
import styles from "./SeverityMark.module.css";

/** Severity shapes: low = circle, moderate = triangle, high = diamond. */
export function severityShape(severity: Severity, radius: number) {
  if (severity === 1) return { kind: "circle" as const, radius };
  const r = radius * 1.15;
  return {
    kind: "polygon" as const,
    points:
      severity === 2
        ? `0,${-r} ${r},${r * 0.8} ${-r},${r * 0.8}`
        : `0,${-r * 1.2} ${r * 1.2},0 0,${r * 1.2} ${-r * 1.2},0`,
  };
}

/**
 * The shape as an SVG string, in the severity colour. `outlined` adds the
 * surface-coloured halo used on the map. One source for React and for DOM
 * built outside React (map markers and popups).
 */
export function severityMarkup(
  severity: Severity,
  size: number,
  outlined = false,
): string {
  const half = outlined ? 12 : 9;
  const shape = severityShape(severity, outlined ? 8 : 6.5);
  const paint = outlined
    ? `fill:var(--severity-${severity});stroke:var(--bg);stroke-width:2.5;paint-order:stroke`
    : `fill:var(--severity-${severity})`;
  return `<svg viewBox="${-half} ${-half} ${half * 2} ${half * 2}" width="${size}" height="${size}" aria-hidden="true" focusable="false">${
    shape.kind === "circle"
      ? `<circle r="${shape.radius}" style="${paint}"/>`
      : `<polygon points="${shape.points}" style="${paint}"/>`
  }</svg>`;
}

type Props = { severity: Severity; size?: number };

/** Redundant severity cue: colour plus shape, so it survives greyscale. */
export function SeverityMark({ severity, size = 16 }: Props) {
  return (
    <span
      className={styles.mark}
      dangerouslySetInnerHTML={{ __html: severityMarkup(severity, size) }}
    />
  );
}
