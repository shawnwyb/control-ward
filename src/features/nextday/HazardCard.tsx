import { useEffect, useState } from "react";
import {
  Icon,
  Panel,
  PanelHeader,
  SeverityMark,
  type IconName,
} from "../../components/ui";
import { formatSiteTime, type NextDayReport } from "../../lib/nextDayReport";
import type { Severity } from "../../lib/types";
import { AboutData } from "./AboutData";
import { gaugeArc, hazardPills, needleAngle } from "./briefing";
import styles from "./NextDayReport.module.css";

const FAMILY_ICON: Record<string, IconName> = {
  heat: "heat",
  storm: "bolt",
  flood: "flood",
  fire: "fire",
};

/** The report's tier words: low, watch, warning, stop work. Low has no mark. */
const TIER_MARK: Record<string, Severity | null> = {
  low: null,
  watch: 2,
  warning: 3,
  "stop work": 3,
};

// Same geometry as the Hazard index art in docs/presentation-plan/presentation.html: centre (200, 210), radius 160.
const CX = 200;
const CY = 210;
const R = 160;

/** Half-circle gauge: green to 3, amber to 7.5, red to 10, as in the hazard index's own tiers. */
function Gauge({ score, tier }: { score: number; tier: string }) {
  // The needle sweeps in from zero. Reduced-motion users get no transition (see the stylesheet).
  const [angle, setAngle] = useState(-90);
  useEffect(() => {
    const id = requestAnimationFrame(() => setAngle(needleAngle(score)));
    return () => cancelAnimationFrame(id);
  }, [score]);
  return (
    <svg
      className={styles.gauge}
      viewBox="0 0 400 250"
      role="img"
      aria-label={`Hazard index ${score.toFixed(1)} of 10, ${tier}`}
    >
      <path d={gaugeArc(CX, CY, R, 0, 3)} className={styles.arcLow} />
      <path d={gaugeArc(CX, CY, R, 3, 7.5)} className={styles.arcMid} />
      <path d={gaugeArc(CX, CY, R, 7.5, 10)} className={styles.arcHigh} />
      <g
        className={styles.needle}
        style={{
          transform: `rotate(${angle}deg)`,
          transformOrigin: `${CX}px ${CY}px`,
        }}
      >
        <line
          x1={CX}
          y1={CY}
          x2={CX}
          y2={CY - 138}
          className={styles.needleLine}
        />
      </g>
      <circle cx={CX} cy={CY} r="14" className={styles.hub} />
      <text x={CX - R} y="244" textAnchor="middle" className={styles.gaugeEnd}>
        0
      </text>
      <text x={CX + R} y="244" textAnchor="middle" className={styles.gaugeEnd}>
        10
      </text>
    </svg>
  );
}

export function HazardCard({ report }: { report: NextDayReport }) {
  const hi = report.hazard_index;
  if (hi.status !== "ok" || hi.score === undefined || !hi.probabilities)
    return (
      <Panel
        id="hazard-index"
        className={styles.heroCard}
        aria-labelledby="hi-title"
      >
        <PanelHeader title="Hazard index" titleId="hi-title" />
        <p className={styles.muted}>
          {hi.reason ?? "No hazard index for this day."}
        </p>
      </Panel>
    );
  const tier = hi.tier ?? "";
  const mark = TIER_MARK[tier] ?? null;
  const pills = hazardPills(hi);
  const top = pills.find((p) => p.top);
  return (
    <Panel
      id="hazard-index"
      className={styles.heroCard}
      aria-labelledby="hi-title"
    >
      <PanelHeader title="Hazard index" titleId="hi-title" />
      <Gauge score={hi.score} tier={tier} />
      <p className={styles.gaugeReadout}>
        <span className={styles.scoreValue}>{hi.score.toFixed(1)}</span>{" "}
        <span className={styles.tier}>
          {mark ? <SeverityMark severity={mark} size={16} /> : null}
          {tier}
        </span>
        <span className="sr-only"> of 10</span>
      </p>
      {top ? (
        <p className={styles.driver}>
          Top driver: <strong>{top.label}</strong> ({top.percent})
        </p>
      ) : null}
      <ul
        className={styles.pills}
        aria-label="Chance of a recorded event by hazard family"
      >
        {pills.map((p) => (
          <li
            key={p.key}
            data-top={p.top ? "true" : undefined}
            aria-label={`${p.label} ${p.percent}${p.top ? ", top driver" : ""}`}
          >
            <Icon name={FAMILY_ICON[p.key]} size={14} />
            <span aria-hidden="true">
              {p.label} {p.percent}
            </span>
          </li>
        ))}
      </ul>
      <p className={styles.small}>
        Chance that NOAA records an event of that kind near the plant today.
      </p>
      {(hi.caveats ?? []).slice(2).map((c) => (
        <p key={c} className={styles.small}>
          {c}
        </p>
      ))}
      <AboutData label="Model details">
        <p className={styles.small}>
          A machine-learning score from 0 to 10. About 3 is a watch, 7.5 a
          warning, 10 stop work.
        </p>
        <ul className={styles.list}>
          {hi.top_driver_text ? (
            <li className={styles.small}>
              Largest driver: {hi.top_driver_text}.
            </li>
          ) : null}
          <li className={styles.small}>
            Model {hi.model_version}; run{" "}
            {hi.run_at_utc
              ? formatSiteTime(hi.run_at_utc, report.meta.site.timezone)
              : "earlier"}
            ; forecast model {hi.forecast_model}.
          </li>
          {hi.drift_flags?.length ? (
            <li className={styles.small}>
              Inputs outside the training range: {hi.drift_flags.join(", ")}.
            </li>
          ) : null}
          {(hi.caveats ?? []).slice(0, 2).map((c) => (
            <li key={c} className={styles.small}>
              {c}
            </li>
          ))}
        </ul>
      </AboutData>
    </Panel>
  );
}
