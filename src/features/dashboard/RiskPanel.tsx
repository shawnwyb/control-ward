import { Icon, IndexTag, cx } from "../../components/ui";
import {
  riskTone,
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
  risk,
  loaded,
  openHazards,
  crewTerm,
}: {
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
  return (
    <div className={styles.root}>
      <dl className={styles.props}>
        <dt>Now</dt>
        <dd>
          <span id="risk-now">
            <IndexTag value={loaded ? risk.riskNow : null} showLabel />
          </span>
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
          {entries.map(([key, value]) => (
            <li
              key={key}
              className={cx(styles.bar, styles[`tone_${riskTone(value)}`])}
            >
              <Icon name={hazardInfo[key].icon} size={16} />
              <span>{hazardInfo[key].name}</span>
              <span className={styles.track} aria-hidden="true">
                <span
                  className={styles.fill}
                  style={{ width: `${Math.min(100, value * 10)}%` }}
                />
              </span>
              <strong>{value.toFixed(1)}</strong>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
