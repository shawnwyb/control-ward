import { Icon, IndexTag, cx } from "../../components/ui";
import { useState } from "react";
import { explainIndex } from "../../lib/explain";
import { ExplainPanel } from "../risk/ExplainPanel";
import { useExplain } from "../risk/useExplain";
import type { Site } from "../../lib/types";
import {
  riskTone,
  type LightningView,
  type SiteRiskView,
  type Subscores,
} from "../../lib/monitoring";
import { hazardInfo } from "../sites/hazards";
import styles from "./RiskPanel.module.css";

/**
 * The selected site's numbers: hazard index now and tomorrow, crew-reported hazards,
 * and one bar per hazard that feeds the index. Shown inside the Sites page's detail card.
 */
export function RiskPanel({
  site,
  lightning,
  risk,
  loaded,
  openHazards,
  crewTerm,
}: {
  site: Site;
  lightning: LightningView;
  risk: SiteRiskView;
  loaded: boolean;
  openHazards: number;
  /** Points the crew-reported hazards add to the score, out of 2. */
  crewTerm: number;
}) {
  const entries = (
    Object.entries(risk.subscores) as [keyof Subscores, number][]
  )
    .filter(([key, value]) => key in hazardInfo && typeof value === "number")
    .sort((a, b) => b[1] - a[1]);
  const explain = useExplain(site, lightning, risk.subscores);
  const [open, setOpen] = useState<string | null>(null);
  const worst = entries.length
    ? { name: hazardInfo[entries[0][0]].name, score: entries[0][1] }
    : null;
  return (
    <div className={styles.root}>
      <dl className={styles.props}>
        <dt>Now</dt>
        <dd>
          <span id="risk-now">
            <IndexTag value={loaded ? risk.riskNow : null} showLabel />
          </span>
          {loaded && risk.riskNow !== null ? (
            <span id="risk-now-explain" className={styles.why}>
              {explainIndex(risk.riskNow, worst, crewTerm)}
            </span>
          ) : null}
        </dd>
        <dt>Tomorrow</dt>
        <dd>
          <span id="risk-tomorrow">
            <IndexTag value={loaded ? risk.riskTomorrow : null} showLabel />
          </span>
        </dd>
        <dt>Open hazards</dt>
        <dd>
          {openHazards}
          <span className={styles.muted}>
            {" "}
            · +{crewTerm.toFixed(1)} to score
          </span>
        </dd>
        {risk.topDriver ? (
          <>
            <dt>Main driver</dt>
            <dd>{risk.topDriver}</dd>
          </>
        ) : null}
      </dl>
      {entries.length ? (
        <ul className={styles.bars} aria-label="Hazard scores">
          {entries.map(([key, value]) => {
            const view = explain(key);
            const isOpen = open === key;
            return (
              <li
                key={key}
                className={cx(styles.item, styles[`tone_${riskTone(value)}`])}
              >
                <button
                  type="button"
                  className={styles.bar}
                  aria-expanded={isOpen}
                  aria-controls={`explain-${key}`}
                  onClick={() => setOpen(isOpen ? null : key)}
                >
                  <Icon name={hazardInfo[key].icon} size={16} />
                  <span className={styles.name}>
                    {hazardInfo[key].name}
                    {view?.explanation ? (
                      <span className={styles.headline}>
                        {view.explanation.headline}
                      </span>
                    ) : null}
                  </span>
                  <span className={styles.track} aria-hidden="true">
                    <span
                      className={styles.fill}
                      style={{ width: `${Math.min(100, value * 10)}%` }}
                    />
                  </span>
                  <strong>{value.toFixed(1)}</strong>
                  <Icon
                    name="chevron"
                    size={14}
                    className={isOpen ? styles.chevOpen : styles.chev}
                  />
                </button>
                <ExplainPanel
                  id={`explain-${key}`}
                  open={isOpen}
                  explanation={view?.explanation ?? null}
                  stale={view?.stale ?? false}
                />
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
