import { iconTileMarkup, severityMarkup } from "../../components/ui";
import badge from "../../components/ui/Badge.module.css";
import { timeAgo } from "../../lib/format";
import {
  hazardLabels,
  severityLabels,
  type Report,
  type Severity,
} from "../../lib/types";
import styles from "./MapCanvas.module.css";

const sizes: Record<Severity, number> = { 1: 24, 2: 30, 3: 36 };

/** DOM for a hazard marker. `hazard-marker` and `data-hazard-id` are stable hooks for tests. */
export function hazardMarkerElement(report: Report): HTMLElement {
  const severity = report.severity as Severity;
  const element = document.createElement("div");
  element.className = `${styles.hazard} hazard-marker`;
  element.dataset.hazardId = report.id;
  element.innerHTML = severityMarkup(severity, sizes[severity], true);
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
