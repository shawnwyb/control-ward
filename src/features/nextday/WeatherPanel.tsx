import type { ReactNode } from "react";
import { Badge, Panel, PanelHeader } from "../../components/ui";
import {
  clockFromHHMM,
  formatHour,
  formatLocalClock,
  type NextDayReport,
  type NwsAlert,
} from "../../lib/nextDayReport";
import { HourStrip } from "./HourStrip";
import { Abbr } from "./Abbr";
import { FIRST_HOUR, LAST_HOUR } from "./hours";
import styles from "./NextDayReport.module.css";

function Alerts({ alerts, empty }: { alerts: NwsAlert[]; empty: string }) {
  if (!alerts.length) return <p className={styles.muted}>{empty}</p>;
  return (
    <ul className={styles.plain}>
      {alerts.map((a) => (
        <li key={`${a.event}-${a.starts}`}>
          <strong>{a.event}</strong>{" "}
          {a.severity ? <Badge>{a.severity}</Badge> : null}
          <div className={styles.muted}>{a.headline}</div>
        </li>
      ))}
    </ul>
  );
}

export function WeatherPanel({ report }: { report: NextDayReport }) {
  const w = report.weather;
  const limits = w.limits;
  if (w.status !== "ok" || !w.hours || !limits) {
    return (
      <Panel id="weather" aria-labelledby="weather-title">
        <PanelHeader title="Weather and work window" titleId="weather-title" />
        <p className={styles.muted}>
          {w.reason ?? "No weather forecast is available for this day."}
        </p>
        <Alerts alerts={w.alerts} empty="" />
      </Panel>
    );
  }
  const hours = w.hours.filter(
    (h) => h.hour >= FIRST_HOUR && h.hour <= LAST_HOUR,
  );
  const rows: {
    id: string;
    label: ReactNode;
    get: (h: (typeof hours)[number]) => number | null;
    over: (v: number) => boolean;
  }[] = [
    {
      id: "pop",
      label: "Storm chance (%)",
      get: (h) => h.pop,
      over: (v) => v >= limits.pop,
    },
    {
      id: "gust",
      label: "Gusts (mph)",
      get: (h) => h.gust,
      over: (v) => v >= limits.gust,
    },
    {
      id: "mm",
      label: "Rain (mm per hour)",
      get: (h) => h.mm,
      over: (v) => v >= limits.mm,
    },
    {
      id: "cape",
      label: (
        <>
          <Abbr long="convective available potential energy: the fuel a thunderstorm can use. Higher means stronger storms are possible">
            CAPE
          </Abbr>{" "}
          (J/kg)
        </>
      ),
      get: (h) => h.cape,
      over: () => false,
    },
  ];
  const hourly = new Map(report.hourly.map((h) => [h.hour, h]));
  const strip = hours.map((h) => {
    const row = hourly.get(h.hour);
    const blocked = row ? !row.safe && row.have_data : false;
    return {
      hour: h.hour,
      value: blocked ? "stop" : "ok",
      blocked,
      label: `${formatHour(h.hour)}, ${blocked ? `blocked by ${row!.blocked_by.join(" and ")}` : "no wind, storm, rain or heat limit reached"}`,
    };
  });

  return (
    <Panel id="weather" aria-labelledby="weather-title">
      <PanelHeader
        title="Weather and work window"
        titleId="weather-title"
        description="Hourly limits come from the same rules as the existing next-day plan. Each value is the highest of seven forecast points within 20 km."
      />
      <p>
        {w.work_window ? (
          <strong>
            Best work window: {clockFromHHMM(w.work_window.start)} to{" "}
            {clockFromHHMM(w.work_window.end)}.
          </strong>
        ) : (
          <strong>
            No two-hour stretch between 6 AM and 7 PM is free of limits.
          </strong>
        )}{" "}
        {w.sun ? (
          <span className={styles.muted}>
            Sunrise {clockFromHHMM(w.sun.sunrise)}, sunset{" "}
            {clockFromHHMM(w.sun.sunset)}.
          </span>
        ) : null}
      </p>
      <HourStrip
        cells={strip}
        caption="Hours free of heat, wind, storm and rain limits"
      />
      {w.blocked_runs?.length ? (
        <p className={styles.muted}>
          Blocked:{" "}
          {w.blocked_runs
            .map(
              (r) =>
                `${clockFromHHMM(r.start)} to ${clockFromHHMM(r.end)} (${r.reasons.join(", ")})`,
            )
            .join("; ")}
          .
        </p>
      ) : null}

      <h3 className={styles.sub}>Hourly detail</h3>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <caption className={styles.small}>
            Bold cells reach a limit: storm chance {limits.pop}%, gusts{" "}
            {limits.gust} mph, rain {limits.mm} mm in an hour.
          </caption>
          <thead>
            <tr>
              <th scope="col">Hour</th>
              {hours.map((h) => (
                <th scope="col" key={h.hour}>
                  {formatHour(h.hour)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <th scope="row">{r.label}</th>
                {hours.map((h) => {
                  const v = r.get(h);
                  return (
                    <td
                      key={h.hour}
                      data-over={v !== null && r.over(v) ? "true" : undefined}
                    >
                      {v === null ? "-" : v}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3 className={styles.sub}>
        National Weather Service alerts for the day
      </h3>
      {w.alerts_status === "missing" ? (
        <p className={styles.muted}>
          Alerts could not be loaded: {w.alerts_reason}
        </p>
      ) : (
        <Alerts
          alerts={w.alerts}
          empty="No active alerts overlap this day. Alerts can be issued later."
        />
      )}

      {w.text?.length ? (
        <>
          <h3 className={styles.sub}>Forecast text</h3>
          <ul className={styles.plain}>
            {w.text.map((t) => (
              <li key={t.starts}>
                <strong>{t.name}</strong> ({formatLocalClock(t.starts)}):{" "}
                {t.detail ?? t.short}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </Panel>
  );
}
