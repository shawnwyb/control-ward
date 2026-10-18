import type { Site } from "../../lib/types";
import { Icon, IndexTag, type IconName } from "../../components/ui";
import { useConditions } from "../../hooks/useConditions";
import { useNow } from "../../hooks/useNow";
import {
  ago,
  formatRain,
  formatTemp,
  formatWind,
  metersToMiles,
} from "../../lib/conditions";
import type { LightningView, Subscores } from "../../lib/monitoring";
import { hazardInfo } from "../sites/hazards";
import styles from "./ConditionsCard.module.css";

const order: (keyof Subscores)[] = [
  "heat",
  "weather",
  "lightning",
  "flood",
  "wildfire",
  "soil",
  "wildlife",
];

function Tile({
  icon,
  label,
  value,
  unit,
  note,
  id,
}: {
  icon: IconName;
  label: string;
  value: string;
  unit?: string;
  note?: string;
  id: string;
}) {
  return (
    <div className={styles.tile} id={id}>
      <span className={styles.label}>
        <Icon name={icon} size={16} />
        {label}
      </span>
      <span className={styles.value}>
        {value}
        {unit ? <span className={styles.unit}> {unit}</span> : null}
      </span>
      {note ? <span className={styles.note}>{note}</span> : null}
    </div>
  );
}

/**
 * Live numbers for the site: weather at its coordinates (Open-Meteo), the last lightning
 * strike, and optionally the hazard scores. Failures read "Weather unavailable".
 */
export function ConditionsCard({
  site,
  lightning,
  subscores,
  subscoresLoaded = true,
}: {
  site: Pick<Site, "id" | "latitude" | "longitude">;
  lightning: LightningView;
  /** When given, the hazard scores show below the weather tiles. */
  subscores?: Subscores;
  subscoresLoaded?: boolean;
}) {
  const { conditions: c, loaded, error, updatedAt } = useConditions(site);
  const now = useNow(updatedAt > 0);
  const strike =
    lightning.status === "stop_work" && lightning.lastStrikeDistanceM !== null
      ? `${metersToMiles(lightning.lastStrikeDistanceM)} mi`
      : null;
  return (
    <div className={styles.root} aria-busy={!loaded}>
      {c ? (
        <div className={styles.grid}>
          <Tile
            id="cond-temp"
            icon="heat"
            label="Temperature"
            value={formatTemp(c.tempF)}
          />
          <Tile
            id="cond-feels"
            icon="heat"
            label="Feels like"
            value={formatTemp(c.feelsLikeF)}
          />
          <Tile
            id="cond-rain"
            icon="rain"
            label="Rain"
            value={formatRain(c.rainIn)}
          />
          <Tile
            id="cond-wind"
            icon="wind"
            label="Wind"
            value={`${formatWind(c.windMph)} ${c.windDir}`}
            note={`gusts ${Math.round(c.gustMph)}`}
          />
          <Tile
            id="cond-lightning"
            icon="bolt"
            label="Lightning"
            value={strike ?? "None nearby"}
            note={strike ? "last strike" : undefined}
          />
        </div>
      ) : loaded ? (
        <p className={styles.quiet}>Weather unavailable</p>
      ) : (
        <div className={styles.grid} aria-hidden="true">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className={styles.skeleton} />
          ))}
        </div>
      )}
      {subscores ? (
        <ul className={styles.scores} aria-label="Hazard scores">
          {order.map((key) => {
            const v = subscoresLoaded ? subscores[key] : undefined;
            return (
              <li key={key} className={styles.score}>
                <span>{hazardInfo[key].name}</span>
                <IndexTag value={typeof v === "number" ? v : null} />
              </li>
            );
          })}
        </ul>
      ) : null}
      <p className={styles.foot}>
        {c && updatedAt > 0 && !error
          ? `Updated ${ago(updatedAt, now)} · `
          : ""}
        Open-Meteo
      </p>
    </div>
  );
}
