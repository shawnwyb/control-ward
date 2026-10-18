import { Panel, PanelHeader } from "../../components/ui";
import { formatHour, type NextDayReport } from "../../lib/nextDayReport";
import { HourStrip } from "./HourStrip";
import { FIRST_HOUR, LAST_HOUR } from "./hours";
import styles from "./NextDayReport.module.css";

export function AirPanel({ report }: { report: NextDayReport }) {
  const air = report.air;
  const cells = (air.hours ?? [])
    .filter((h) => h.hour >= FIRST_HOUR && h.hour <= LAST_HOUR)
    .map((h) => ({
      hour: h.hour,
      value: h.us_aqi === null ? "-" : String(Math.round(h.us_aqi)),
      label: `${formatHour(h.hour)}, air quality index ${h.us_aqi === null ? "unknown" : Math.round(h.us_aqi)}`,
    }));
  return (
    <Panel id="air" aria-labelledby="air-title">
      <PanelHeader
        title="Air quality and smoke"
        titleId="air-title"
        description="US Air Quality Index (AQI). Lower is better; 101 and above affects sensitive groups."
      />
      {air.status !== "ok" && !air.peak ? (
        <p className={styles.muted}>
          {air.reason ?? "No air quality forecast is available."}
        </p>
      ) : null}
      {air.peak ? (
        <p>
          <strong>
            Peak AQI {Math.round(air.peak.us_aqi)} at{" "}
            {formatHour(air.peak.hour)}: {air.peak.band.name}.
          </strong>{" "}
          {air.peak.band.meaning}
        </p>
      ) : null}
      {cells.length ? (
        <HourStrip cells={cells} caption="Air quality index by hour" />
      ) : null}
      <ul className={styles.list} style={{ marginTop: "var(--space-4)" }}>
        {air.wildfire ? (
          <li>
            {air.wildfire.within_25_mi > 0
              ? `${air.wildfire.within_25_mi} active wildfire(s) within 25 miles.`
              : `No active wildfire within 25 miles. Nearest: ${air.wildfire.nearest_mi ?? "unknown"} miles${air.wildfire.nearest_name ? ` (${air.wildfire.nearest_name})` : ""}.`}
          </li>
        ) : (
          <li>The wildfire list could not be loaded.</li>
        )}
        {air.hazard_index_fire_probability !== null &&
        air.hazard_index_fire_probability !== undefined ? (
          <li>
            Hazard index chance of a recorded wildfire or smoke event near the
            plant: {(air.hazard_index_fire_probability * 100).toFixed(1)}%.
          </li>
        ) : null}
        {(air.alerts ?? []).map((a) => (
          <li key={a.event + a.starts}>
            <strong>{a.event}.</strong> {a.headline}
          </li>
        ))}
        {(air.notes ?? []).map((n) => (
          <li key={n} className={styles.muted}>
            {n}
          </li>
        ))}
      </ul>
    </Panel>
  );
}
