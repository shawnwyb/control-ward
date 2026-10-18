import { Badge, Panel, PanelHeader } from "../../components/ui";
import { formatSiteTime, type NextDayReport } from "../../lib/nextDayReport";
import { AboutData } from "./AboutData";
import styles from "./NextDayReport.module.css";

const FAMILY: Record<string, string> = {
  heat: "Heat",
  storm: "Storm",
  flood: "Flood",
  fire: "Fire",
};

export function HazardIndexPanel({ report }: { report: NextDayReport }) {
  const hi = report.hazard_index;
  if (hi.status !== "ok" || hi.score === undefined || !hi.probabilities)
    return (
      <Panel id="hazard-index" aria-labelledby="hi-title">
        <PanelHeader title="Hazard index" titleId="hi-title" />
        <p className={styles.muted}>
          {hi.reason ?? "No hazard index for this day."}
        </p>
      </Panel>
    );
  const max = Math.max(...Object.values(hi.probabilities), 0.0001);
  return (
    <Panel id="hazard-index" aria-labelledby="hi-title">
      <PanelHeader
        title="Hazard index"
        titleId="hi-title"
        description="A machine-learning score from 0 to 10. About 3 is a watch, 7.5 a warning, 10 stop work."
        aside={<Badge>{hi.model_version}</Badge>}
      />
      <div className={styles.score}>
        <div>
          <span className={styles.scoreValue}>{hi.score.toFixed(1)}</span>{" "}
          <span className={styles.muted}>of 10 · {hi.tier}</span>
        </div>
        <p style={{ margin: 0 }}>
          Largest driver: <strong>{hi.top_driver_text}</strong>.
        </p>
      </div>
      <div
        className={styles.bars}
        role="list"
        aria-label="Chance of a recorded event by hazard family"
      >
        {(Object.entries(hi.probabilities) as [string, number][]).map(
          ([k, p]) => (
            <div key={k} className={styles.bar} role="listitem">
              <span>{FAMILY[k] ?? k}</span>
              <meter
                min={0}
                max={max}
                value={p}
                aria-label={`${FAMILY[k]} ${(p * 100).toFixed(1)} percent`}
              />
              <span className={styles.mono}>{(p * 100).toFixed(1)}%</span>
            </div>
          ),
        )}
      </div>
      <p className={styles.small}>
        Each bar is the modelled chance that NOAA records an event of that kind
        near the plant on this day. Run{" "}
        {hi.run_at_utc
          ? formatSiteTime(hi.run_at_utc, report.meta.site.timezone)
          : "earlier"}
        ; forecast model {hi.forecast_model}.
        {hi.drift_flags?.length
          ? ` Inputs outside the training range: ${hi.drift_flags.join(", ")}.`
          : ""}
      </p>
      <ul className={styles.list}>
        {(hi.caveats ?? []).slice(2).map((c) => (
          <li key={c} className={styles.muted}>
            {c}
          </li>
        ))}
      </ul>
      <AboutData label="About this score">
        <ul className={styles.list}>
          {(hi.caveats ?? []).slice(0, 2).map((c) => (
            <li key={c} className={styles.muted}>
              {c}
            </li>
          ))}
        </ul>
      </AboutData>
    </Panel>
  );
}
