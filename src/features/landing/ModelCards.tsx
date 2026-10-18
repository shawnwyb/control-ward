import { HazardIndexFlow, MudFlow } from "../models/ModelFlow";
import styles from "./ModelCards.module.css";

/** The two forecast models behind the daily briefing, each with its animated architecture diagram. */
export function ModelCards() {
  return (
    <ul className={styles.grid}>
      <li className={styles.card}>
        <h3 className={styles.title}>Hazard Index</h3>
        <p className={styles.desc}>
          One calibrated model per hazard family: heat, storm, flood, fire.
        </p>
        <HazardIndexFlow />
        <code className={styles.chip}>
          NOAA Storm Events × OSHA severity → 0–10
        </code>
      </li>
      <li className={styles.card}>
        <h3 className={styles.title}>Mud trafficability</h3>
        <p className={styles.desc}>
          STRAM-inspired rutting forecast for unpaved routes.
        </p>
        <MudFlow />
        <code className={styles.chip}>
          SSURGO soil · 3DEP terrain · OSM routes · Open-Meteo
        </code>
        <p className={styles.note}>
          Uncalibrated: flags segments to inspect, not a crossing clearance.
        </p>
      </li>
    </ul>
  );
}
