import { useState } from "react";
import { Panel, PanelHeader, SeverityMark } from "../../components/ui";
import {
  clockFromHHMM,
  formatHour,
  type HeatSection,
  type NextDayReport,
} from "../../lib/nextDayReport";
import { BAND_SEVERITY, bandRange } from "./bands";
import { HourStrip, type StripCell } from "./HourStrip";
import styles from "./NextDayReport.module.css";

const FIRST_HOUR = 5;
const LAST_HOUR = 20;

export function HeatPanel({ report }: { report: NextDayReport }) {
  const heat: HeatSection = report.heat;
  const [newWorkers, setNewWorkers] = useState(false);
  const bands = heat.bands ?? [];
  const nameOf = (id: string | null) =>
    bands.find((b) => b.id === id)?.name ?? "No data";

  if (heat.status !== "ok" || !heat.hours || !heat.peak) {
    return (
      <Panel id="heat" aria-labelledby="heat-title">
        <PanelHeader title="Heat and water breaks" titleId="heat-title" />
        <p className={styles.muted}>
          {heat.reason ?? "No heat forecast is available for this day."}
        </p>
      </Panel>
    );
  }

  const cells: StripCell[] = heat.hours
    .filter((h) => h.hour >= FIRST_HOUR && h.hour <= LAST_HOUR)
    .map((h) => ({
      hour: h.hour,
      value: h.hi === null ? "-" : String(Math.round(h.hi)),
      band: h.band,
      mark: h.band ? BAND_SEVERITY[h.band] : null,
      peak: h.hour === heat.peak!.hour,
      label: `${formatHour(h.hour)}, heat index ${h.hi === null ? "unknown" : `${Math.round(h.hi)} F`}, ${nameOf(h.band)}${
        h.hour === heat.peak!.hour ? ", peak of the day" : ""
      }`,
    }));
  const peak = heat.peak;
  const sunBand = bands.find(
    (b) =>
      b.id === heat.hours!.find((h) => h.hour === peak.hour)?.band_full_sun_max,
  );
  const peakBand = bands.find((b) => b.id === peak.band);
  const plan = heat.water_plan ?? [];

  return (
    <Panel id="heat" aria-labelledby="heat-title">
      <PanelHeader
        title="Heat and water breaks"
        titleId="heat-title"
        description="Hourly heat index (feels-like temperature in shade) for the report day, in site-local time."
      />
      <p>
        <strong>
          Peak heat index {Math.round(peak.hi)} F at {formatHour(peak.hour)}
        </strong>{" "}
        ({peakBand?.name ?? peak.band}). Hottest hours:{" "}
        {clockFromHHMM(heat.hottest_window!.start)} to{" "}
        {clockFromHHMM(heat.hottest_window!.end)}.{" "}
        {peak.hi_full_sun_max !== null ? (
          <>
            In full sun it can reach {peak.hi_full_sun_max} F
            {sunBand ? ` (${sunBand.name})` : ""}.
          </>
        ) : null}
        {peak.wbgt !== null ? (
          <> WBGT at the peak: {Math.round(peak.wbgt)} F.</>
        ) : null}
      </p>

      <HourStrip cells={cells} caption="Heat index by hour, degrees F" />

      <h3 className={styles.sub}>Water and rest timeline</h3>
      <ol className={styles.timeline} aria-label="Water and rest timeline">
        {plan.map((step) => (
          <li key={`${step.start}-${step.band}`} className={styles.step}>
            <span className={styles.time}>
              {clockFromHHMM(step.start)} to {clockFromHHMM(step.end)}
            </span>
            <div>
              <h4>
                {BAND_SEVERITY[step.band] ? (
                  <SeverityMark
                    severity={BAND_SEVERITY[step.band]!}
                    size={14}
                  />
                ) : null}
                {step.name}
                {step.water_every_min
                  ? ` · water about every ${step.water_every_min} min`
                  : ""}
              </h4>
              <p>{step.action}</p>
            </div>
          </li>
        ))}
      </ol>

      {heat.acclimatization ? (
        <>
          <h3 className={styles.sub}>Workers new to the heat</h3>
          <label className={styles.check}>
            <input
              type="checkbox"
              checked={newWorkers}
              onChange={(e) => setNewWorkers(e.target.checked)}
            />{" "}
            Some workers are new to the job or back after a break
          </label>
          {newWorkers ? (
            <div>
              <p>{heat.acclimatization.who}</p>
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <caption className={styles.small}>
                    Most time in the heat, as a share of the usual time, by day
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Day</th>
                      {heat.acclimatization.new.schedule.map((d) => (
                        <th scope="col" key={d.day}>
                          {d.day}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      heat.acclimatization.new,
                      heat.acclimatization.experienced,
                    ].map((row) => (
                      <tr key={row.label}>
                        <th scope="row">{row.label}</th>
                        {heat.acclimatization!.new.schedule.map((d) => {
                          const v = row.schedule.find((x) => x.day === d.day);
                          return (
                            <td key={d.day}>
                              {v ? `${v.max_percent}%` : "100%"}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <ul className={styles.list}>
                {heat.acclimatization.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
              <p className={styles.small}>
                {heat.acclimatization.source.verified} Sources:{" "}
                {heat.acclimatization.source.urls.map((u, i) => (
                  <span key={u}>
                    {i ? ", " : ""}
                    <a href={u}>{new URL(u).pathname}</a>
                  </span>
                ))}
                .
              </p>
            </div>
          ) : null}
        </>
      ) : null}

      <h3 className={styles.sub}>What the bands mean</h3>
      <ul className={styles.plain}>
        {bands.map((b) => (
          <li key={b.id}>
            <strong>
              {b.name} ({bandRange(bands, b.id)}).
            </strong>{" "}
            {b.effects ?? "No heat-specific effects are listed for this range."}
          </li>
        ))}
      </ul>

      <ul className={styles.list} style={{ marginTop: "var(--space-4)" }}>
        {(heat.notes ?? []).map((n) => (
          <li key={n} className={styles.muted}>
            {n}
          </li>
        ))}
      </ul>
      {heat.source ? (
        <p className={styles.small} style={{ marginTop: "var(--space-3)" }}>
          Bands: {heat.source.table},{" "}
          <a href={heat.source.url}>{heat.source.url}</a>, retrieved{" "}
          {heat.source.retrieved}. {heat.source.verified} Water and rest advice
          follows OSHA:{" "}
          {heat.source.osha.map((u, i) => (
            <span key={u}>
              {i ? ", " : ""}
              <a href={u}>{new URL(u).pathname}</a>
            </span>
          ))}
          .
        </p>
      ) : null}
    </Panel>
  );
}
