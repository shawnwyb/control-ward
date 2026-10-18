import { useLive } from "../../hooks/useLive";
import { Icon, IndexTag, cx } from "../../components/ui";
import {
  riskTone,
  fetchHazardEvidence,
  type HazardEvidenceView,
  type SiteRiskView,
  type Subscores,
} from "../../lib/monitoring";
import { hazardInfo } from "../sites/hazards";
import styles from "./RiskPanel.module.css";
import evidenceStyles from "./Dashboard.module.css";

/**
 * The selected site's numbers: hazard index now and tomorrow, crew-reported hazards,
 * and one bar per hazard that feeds the index. Shown inside the Sites page's detail card.
 */
export function RiskPanel({
  risk,
  loaded,
  openHazards,
  crewTerm,
  siteId,
}: {
  risk: SiteRiskView;
  loaded: boolean;
  openHazards: number;
  /** Points the crew-reported hazards add to the score, out of 2. */
  crewTerm: number;
  siteId: string;
}) {
  const { data: evidence } = useLive<HazardEvidenceView[]>(
    siteId,
    ["hazard_evidence"],
    fetchHazardEvidence,
    [],
  );
  const activeEvidence =
    evidence.find((e) => e.horizon === "now") ?? evidence[0] ?? null;
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
      {activeEvidence ? (
        <div className={evidenceStyles.evidenceCard} id="hazard-evidence">
          <div className={evidenceStyles.evidenceHeader}>
            <span className={evidenceStyles.evidenceTitle}>
              Backing Evidence: {activeEvidence.driver.toUpperCase()}
            </span>
            <span className={evidenceStyles.evidenceBadge}>Ground Truth</span>
          </div>
          <p className={evidenceStyles.evidenceSummary}>
            {activeEvidence.summary}
          </p>
          {activeEvidence.articles.length > 0 ? (
            <ul className={evidenceStyles.evidenceArticles}>
              {activeEvidence.articles.map((art, idx) => (
                <li key={idx} className={evidenceStyles.articleItem}>
                  <a
                    href={art.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={evidenceStyles.articleLink}
                  >
                    <span>{art.title}</span>
                    <span className={evidenceStyles.articleSource}>
                      ({art.source}) ↗
                    </span>
                  </a>
                  {art.snippet ? (
                    <p className={evidenceStyles.articleSnippet}>
                      {art.snippet}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
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
