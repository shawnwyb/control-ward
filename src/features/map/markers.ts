import {
  iconMarkup,
  iconTileMarkup,
  severityMarkup,
} from "../../components/ui";
import badge from "../../components/ui/Badge.module.css";
import { timeAgo } from "../../lib/format";
import { riskTone } from "../../lib/risk";
import { sitePinLabel, type SiteSummary } from "../../lib/sites";
import {
  hazardLabels,
  severityLabels,
  type Report,
  type Severity,
} from "../../lib/types";
import styles from "./MapCanvas.module.css";

const sizes: Record<Severity, number> = { 1: 26, 2: 30, 3: 34 };

/** Reports just sent from this device: their marker drops in once, when first drawn. */
const dropIns = new Set<string>();
export function markForDropIn(reportId: string) {
  dropIns.add(reportId);
}

/**
 * DOM for a hazard marker: the report type's gray line icon on a white disc, sized by
 * severity, with the severity shape as a corner badge (shape + colour, never colour alone).
 * `hazard-marker` and `data-hazard-id` are stable hooks for tests.
 */
export function hazardMarkerElement(report: Report): HTMLElement {
  const severity = report.severity as Severity;
  const size = sizes[severity];
  const element = document.createElement("div");
  element.className = `${styles.hazard} hazard-marker`;
  element.dataset.hazardId = report.id;
  element.dataset.severity = String(severity);
  if (dropIns.delete(report.id)) element.classList.add(styles.dropIn);
  element.style.setProperty("--size", `${size}px`);
  element.innerHTML = `${iconMarkup(report.type, Math.round(size * 0.58))}<span class="${styles.hazardBadge}">${severityMarkup(severity, 13, true)}</span>`;
  return element;
}

/**
 * A site's score pin: the hazard index on a pill coloured by its band, with a pointer
 * tail at the site. A real button, so it is keyboard operable; `site-pin` and
 * `data-site-id` are stable hooks. Gray with a dash when the site has no score yet.
 */
export function sitePinElement(
  summary: SiteSummary,
  selected: boolean,
): HTMLElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `${styles.sitePin} site-pin`;
  button.dataset.siteId = summary.siteId;
  button.dataset.tone = riskTone(summary.riskNow);
  button.setAttribute("aria-label", sitePinLabel(summary));
  setSitePinSelected(button, selected);
  button.append(
    node(
      "span",
      styles.sitePill,
      summary.riskNow === null ? "\u2014" : summary.riskNow.toFixed(1),
    ),
  );
  return button;
}

export function setSitePinSelected(element: HTMLElement, selected: boolean) {
  if (selected) element.setAttribute("aria-current", "true");
  else element.removeAttribute("aria-current");
}

/** Bolt on the 10-mile stop-work ring. `stop-work-marker` is a stable hook for tests. */
export function stopWorkMarkerElement(): HTMLElement {
  const element = document.createElement("div");
  element.className = `${styles.stopWork} stop-work-marker`;
  element.setAttribute("role", "img");
  element.setAttribute(
    "aria-label",
    "Stop work: lightning within 10 miles of the site",
  );
  element.innerHTML = iconMarkup("bolt", 16);
  return element;
}

function node<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

/** Hover card for a hazard. Built with textContent only; the only HTML is our own static markup. */
export function hazardCardElement(report: Report): HTMLElement {
  const severity = report.severity as Severity;
  const card = node("div", styles.cardBody);

  const header = node("div", styles.cardHeader);
  header.insertAdjacentHTML("afterbegin", iconTileMarkup(report.type));
  header.append(node("strong", styles.cardTitle, hazardLabels[report.type]));
  const tag = node("span", `${badge.tag} ${badge[`sev${severity}`]}`);
  tag.insertAdjacentHTML("afterbegin", severityMarkup(severity, 12));
  tag.append(severityLabels[severity]);
  header.append(tag);
  card.append(header);

  const facts = node("dl", styles.cardFacts);
  const rows: [string, string][] = [
    ["Confirmations", String(report.confirmations)],
    ["Last confirmed", timeAgo(report.last_confirmed_at)],
  ];
  for (const [label, value] of rows) {
    facts.append(node("dt", styles.cardLabel, label));
    facts.append(node("dd", styles.cardValue, value));
  }
  card.append(facts);
  return card;
}

export function pinMarkerElement(): HTMLElement {
  const element = document.createElement("div");
  element.className = styles.pin;
  element.innerHTML = `<span></span>`;
  return element;
}

export function centerMarkerElement(): HTMLElement {
  const element = document.createElement("div");
  element.className = styles.center;
  return element;
}

/** Worker marker for supervisors: initials in a dot, faded when the last fix is stale. */
export function crewMarkerElement(name: string, stale: boolean): HTMLElement {
  const element = document.createElement("div");
  element.className = `${styles.crew} ${stale ? styles.crewStale : ""} crew-marker`;
  element.textContent = name
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  element.title = name;
  return element;
}
