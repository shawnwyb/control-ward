import { Panel, PanelHeader } from "../../components/ui";
import { cx } from "../../components/ui";
import { riskLevel, type SiteRiskView } from "../../lib/monitoring";
import styles from "./Dashboard.module.css";

const names: Record<string, string> = {
  heat: "Heat · WBGT",
  weather: "Severe weather",
  lightning: "Lightning",
  flood: "Flood",
  wildfire: "Wildfire",
  soil: "Soil",
  wildlife: "Wildlife",
};

function toneFor(score: number) {
  return score >= 7
    ? styles.tone_danger
    : score >= 4
      ? styles.tone_caution
      : styles.tone_ok;
}

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
  const now = riskLevel(risk.riskNow);
  const tomorrow = riskLevel(risk.riskTomorrow);
  const entries = Object.entries(risk.subscores).filter(
    ([key, value]) => key in names && typeof value === "number",
  ) as [string, number][];
  return (
    <Panel id="risk" emphasis aria-labelledby="risk-title">
      <PanelHeader
        titleId="risk-title"
        title="Site risk"
        description="Highest hazard score plus crew-reported hazards, out of 10."
      />
      <div className={styles.riskHead}>
        <div className={styles.score}>
          <span className={styles.scoreLabel}>Now</span>
          <span
            id="risk-now"
            className={cx(styles.scoreValue, styles[`tone_${now.tone}`])}
          >
            {loaded && risk.riskNow !== null ? risk.riskNow.toFixed(1) : "—"}
            <small>{loaded ? now.label : ""}</small>
          </span>
        </div>
        <div className={styles.score}>
          <span className={styles.scoreLabel}>Tomorrow</span>
          <span
            id="risk-tomorrow"
            className={cx(styles.scoreValue, styles[`tone_${tomorrow.tone}`])}
          >
            {loaded && risk.riskTomorrow !== null
              ? risk.riskTomorrow.toFixed(1)
              : "—"}
            <small>{loaded ? tomorrow.label : ""}</small>
          </span>
        </div>
        <div className={styles.score}>
          <span className={styles.scoreLabel}>Crew-reported hazards</span>
          <span className={styles.scoreValue}>
            {openHazards}
            <small>+{crewTerm.toFixed(1)} to score</small>
          </span>
        </div>
      </div>
      {risk.topDriver ? (
        <p className={styles.driver}>Main driver: {risk.topDriver}</p>
      ) : null}
      {entries.length ? (
        <ul className={styles.subscores}>
          {entries.map(([key, value]) => (
            <li key={key} className={styles.sub}>
              <span className={styles.subName}>{names[key]}</span>
              <strong className={toneFor(value)}>{value.toFixed(1)}</strong>
              <span
                className={cx(styles.bar, toneFor(value))}
                aria-hidden="true"
              >
                <span
                  className={styles.barFill}
                  style={{ width: `${Math.min(100, value * 10)}%` }}
                />
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </Panel>
  );
}
