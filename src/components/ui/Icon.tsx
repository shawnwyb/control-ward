import type { SVGProps } from "react";

/*
 * Icon geometry as static SVG strings (trusted, never user input), so the same
 * artwork serves React components and hand-built DOM such as map popups.
 */
const bolt = '<path d="M13 2L4 14h8l-1 8 9-12h-8z"/>';
const flood =
  '<path d="M2 7c2-2 4-2 6 0s4 2 6 0 4-2 6 0"/><path d="M2 12c2-2 4-2 6 0s4 2 6 0 4-2 6 0"/><path d="M2 17c2-2 4-2 6 0s4 2 6 0 4-2 6 0"/>';
const paw =
  '<circle cx="5.5" cy="11" r="1.6"/><circle cx="9.5" cy="6.5" r="1.6"/><circle cx="14.5" cy="6.5" r="1.6"/><circle cx="18.5" cy="11" r="1.6"/><path d="M12 12c3 0 5.5 3 5.5 5.5 0 2-1.5 2.5-3 2-1-.4-1.6-.6-2.5-.6s-1.5.2-2.5.6c-1.5.5-3 0-3-2C6.5 15 9 12 12 12z"/>';

const bodies = {
  debris:
    '<path d="M3 20l3-6 5 1 1 5z"/><path d="M13 20l1-8 6 1-1 7z"/><path d="M8 13l2-6 5 1-1 5"/>',
  // Hazard kinds reuse the hazard-type art under their report names.
  wildlife: paw,
  downed_line: bolt,
  washout: flood,
  other: '<path d="M12 3l9 9-9 9-9-9z"/><path d="M12 8v5M12 16v.5"/>',
  mud: '<path d="M7 3c-1.5 5 3 8 1 18"/><path d="M17 3c-1.5 5 3 8 1 18"/><path d="M4 21h16"/>',
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
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  // Hazard and navigation set
  bolt,
  flood,
  heat: '<path d="M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4.5 4.5 0 1 0 5 0z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  fire: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.4-.5-2-1-3-1.1-2.1-.2-4 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.2.4-2.3 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
  soil: '<path d="M12 3L2 8l10 5 10-5z"/><path d="M2 16l10 5 10-5"/><path d="M2 12l10 5 10-5"/>',
  paw,
  rain: '<path d="M20 16.6A5 5 0 0 0 18 7h-1.3A8 8 0 1 0 4 15.3"/><path d="M8 19v2M8 13v2M16 19v2M16 13v2M12 21v1M12 15v2"/>',
  wind: '<path d="M17.7 7.7A2.5 2.5 0 1 1 19.5 12H2"/><path d="M9.6 4.6A2 2 0 1 1 11 8H2"/><path d="M12.6 19.4A2 2 0 1 0 14 16H2"/>',
  tower: '<path d="M12 2L7 22M12 2l5 20M5 8h14M6.5 14h11M9 8l6 6M15 8l-6 6"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a2 2 0 0 0 3.4 0"/>',
  brief:
    '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M8 12h8M8 16h5"/>',
  globe:
    '<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 0 1 0 20 15 15 0 0 1 0-20"/>',
  camera:
    '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z"/><circle cx="12" cy="13" r="3"/>',
  table:
    '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18"/>',
  map: '<path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2z"/><path d="M9 4v14M15 6v14"/>',
  truck:
    '<path d="M2 5h12v11H2z"/><path d="M14 9h4l4 4v3h-8"/><circle cx="6.5" cy="18" r="2"/><circle cx="17.5" cy="18" r="2"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8v.5"/>',
  leaf: '<path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.5 19 2c1 2 2 4.2 2 8 0 5.5-4.8 10-10 10z"/><path d="M2 21c0-3 1.9-5.4 5.1-6"/>',
} as const;

export type IconName = keyof typeof bodies;

const attributes = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  "stroke-width": "1.7",
  "stroke-linecap": "round",
  "stroke-linejoin": "round",
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
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
      dangerouslySetInnerHTML={{ __html: bodies[name] }}
    />
  );
}
