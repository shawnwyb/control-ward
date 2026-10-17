import type { SVGProps } from "react";

/*
 * Icon geometry as static SVG strings (trusted, never user input), so the same
 * artwork serves React components and hand-built DOM such as map popups.
 */
const bodies = {
  debris:
    '<path d="M3 20l3-6 5 1 1 5z"/><path d="M13 20l1-8 6 1-1 7z"/><path d="M8 13l2-6 5 1-1 5"/>',
  wildlife:
    '<circle cx="5.5" cy="11" r="1.9" fill="currentColor" stroke="none"/><circle cx="9.5" cy="6.5" r="1.9" fill="currentColor" stroke="none"/><circle cx="14.5" cy="6.5" r="1.9" fill="currentColor" stroke="none"/><circle cx="18.5" cy="11" r="1.9" fill="currentColor" stroke="none"/><path d="M12 12c3 0 5.5 3 5.5 5.5 0 2-1.5 2.5-3 2-1-.4-1.6-.6-2.5-.6s-1.5.2-2.5.6c-1.5.5-3 0-3-2C6.5 15 9 12 12 12z"/>',
  downed_line: '<path d="M13 3L6 13h5l-1 8 8-11h-5z"/>',
  washout:
    '<path d="M2 7q2.5-3 5 0t5 0 5 0 5 0"/><path d="M2 12q2.5-3 5 0t5 0 5 0 5 0"/><path d="M2 17q2.5-3 5 0t5 0 5 0 5 0"/>',
  other: '<path d="M12 3l9 9-9 9-9-9z"/><path d="M12 8v5M12 16v.5"/>',
  locate:
    '<circle cx="12" cy="12" r="5"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5M4 20h16"/>',
  check: '<path d="M4 12.5l5 5L20 6"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/>',
  "arrow-right": '<path d="M4 12h16M14 6l6 6-6 6"/>',
  chevron: '<path d="M6 9l6 6 6-6"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  alert: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18v.5"/>',
  play: '<path d="M8 5l11 7-11 7z"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
} as const;

export type IconName = keyof typeof bodies;

const attributes = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  "stroke-width": "1.75",
  "stroke-linecap": "square",
  "stroke-linejoin": "miter",
  "aria-hidden": "true",
  focusable: "false",
};

/** The icon as an SVG string, for DOM built outside React (e.g. map popups). */
export function iconMarkup(name: IconName, size = 20): string {
  const attrs = Object.entries(attributes)
    .map(([key, value]) => `${key}="${value}"`)
    .join(" ");
  return `<svg width="${size}" height="${size}" ${attrs}>${bodies[name]}</svg>`;
}

type Props = Omit<SVGProps<SVGSVGElement>, "name"> & {
  name: IconName;
  size?: number;
};

/** Decorative icon. Always pair with visible text or an aria-label on the control. */
export function Icon({ name, size = 20, ...rest }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="square"
      strokeLinejoin="miter"
      aria-hidden="true"
      focusable="false"
      {...rest}
      dangerouslySetInnerHTML={{ __html: bodies[name] }}
    />
  );
}
