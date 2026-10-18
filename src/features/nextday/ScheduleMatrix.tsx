import { useMemo, useState, type ReactNode } from "react";
import {
  Badge,
  Icon,
  Panel,
  PanelHeader,
  SeverityMark,
} from "../../components/ui";
import {
  clockFromHHMM,
  formatHour,
  formatLocalClock,
  type BandId,
  type NextDayReport,
  type NwsAlert,
} from "../../lib/nextDayReport";
import type { Severity } from "../../lib/types";
import { Abbr } from "./Abbr";
import { AboutData } from "./AboutData";
import { BAND_SEVERITY, bandRange } from "./bands";
import { airSummary } from "./briefing";
import { FIRST_HOUR, LAST_HOUR } from "./hours";
import {
  blockedHours,
  combine,
  longestWindow,
  overrideKey,
  type HourResult,
  type Overrides,
} from "./taskPlan";
import { loadOverrides, saveOverrides, TaskLimits } from "./TaskLimits";
import styles from "./NextDayReport.module.css";

const HOURS = Array.from(
  { length: LAST_HOUR - FIRST_HOUR + 1 },
  (_, i) => FIRST_HOUR + i,
);
const hhmm = (h: number) => `${String(h).padStart(2, "0")}:00`;

type CellProps = {
  text: string;
  /** Read aloud in place of the visible text, for example "3 PM, blocked: rain". */
  label: string;
  state?: "ok" | "stop" | "none";
  band?: BandId | null;
  mark?: Severity | null;
  peak?: boolean;
  selected: boolean;
};

/** One hour in one row. Colour is never the only cue: each cell has a word or number, and a shape above caution. */
function Cell({ text, label, state, band, mark, peak, selected }: CellProps) {
  return (
    <td
      data-state={state}
      data-band={band ?? undefined}
      data-peak={peak ? "true" : undefined}
      data-selected={selected ? "true" : undefined}
    >
      <span className={styles.cellBox}>
        <span aria-hidden="true" className={styles.cellText}>
          {text}
        </span>
        {mark ? <SeverityMark severity={mark} size={12} /> : null}
      </span>
      <span className="sr-only">{label}</span>
    </td>
  );
}

function Alerts({ alerts }: { alerts: NwsAlert[] }) {
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

function windowText(results: HourResult[]): string {
  const w = longestWindow(results);
  return w
    ? `Best window ${clockFromHHMM(hhmm(w.start))} to ${clockFromHHMM(hhmm(w.end))}`
    : "No clear two-hour stretch";
}

/**
 * One shared time axis for the weather limits, the planned tasks, the heat index and (only on a bad air day) the
 * air quality index. Picking an hour shows its raw values underneath, so no separate hourly table is needed on screen.
 */
export function ScheduleMatrix({ report }: { report: NextDayReport }) {
  const { weather: w, heat, tasks, air } = report;
  const eia = report.meta.site.eia;
  const [selected, setSelected] = useState<string[]>(
    tasks?.profiles[0] ? [tasks.profiles[0].id] : [],
  );
  const [overrides, setOverrides] = useState<Overrides>(() =>
    loadOverrides(eia),
  );
  const [newWorkers, setNewWorkers] = useState(false);
  const [hour, setHour] = useState<number | null>(null);

  const hourly = useMemo(
    () => new Map(report.hourly.map((h) => [h.hour, h])),
    [report.hourly],
  );
  const results = useMemo(() => {
    if (!tasks || tasks.status !== "ok") return new Map<string, HourResult[]>();
    return new Map(
      tasks.profiles.map((p) => [
        p.id,
        blockedHours(p, report.hourly, tasks.site_flags, overrides),
      ]),
    );
  }, [tasks, report.hourly, overrides]);

  if (!report.hourly.length)
    return (
      <Panel id="weather" aria-labelledby="schedule-title">
        <PanelHeader title="Work schedule" titleId="schedule-title" />
        <p className={styles.muted}>
          No hourly forecast, so the hours of the day cannot be worked out.{" "}
          {w.reason ?? heat.reason ?? ""}
        </p>
      </Panel>
    );

  const chosen = (tasks?.profiles ?? []).filter((p) => selected.includes(p.id));
  const chosenResults = chosen.map((p) => results.get(p.id)!);
  const together = chosen.length > 1 ? combine(chosenResults) : null;
  const setLimit = (profileId: string, blockerId: string, value: string) => {
    const next = { ...overrides };
    const n = Number(value);
    if (value === "" || !Number.isFinite(n))
      delete next[overrideKey(profileId, blockerId)];
    else next[overrideKey(profileId, blockerId)] = n;
    setOverrides(next);
    saveOverrides(eia, next);
  };
  const resetLimits = (profile: (typeof chosen)[number]) => {
    const next = { ...overrides };
    for (const b of profile.blockers)
      delete next[overrideKey(profile.id, b.id)];
    setOverrides(next);
    saveOverrides(eia, next);
  };

  const bands = heat.bands ?? [];
  const bandName = (id: BandId | null) =>
    bands.find((b) => b.id === id)?.name ?? "no data";
  const heatByHour = new Map((heat.hours ?? []).map((h) => [h.hour, h]));
  const airHours = new Map((air.hours ?? []).map((h) => [h.hour, h]));
  const aq = airSummary(air);
  const peakHour = heat.peak?.hour;
  const taskRows: { key: string; label: string; results: HourResult[] }[] = [
    ...chosen.map((p) => ({
      key: p.id,
      label: p.label,
      results: results.get(p.id)!,
    })),
    ...(together
      ? [
          {
            key: "together",
            label: "All selected tasks together",
            results: together,
          },
        ]
      : []),
  ];

  const detail = hour === null ? null : hourly.get(hour);
  const num = (v: number | null | undefined, unit = "") =>
    v === null || v === undefined ? "-" : `${Math.round(v * 10) / 10}${unit}`;

  const sun = w.sun
    ? ` Sunrise ${clockFromHHMM(w.sun.sunrise)}, sunset ${clockFromHHMM(w.sun.sunset)}.`
    : "";
  const peak = heat.peak;
  const sunBand = peak
    ? bands.find((b) => b.id === heatByHour.get(peak.hour)?.band_full_sun_max)
    : undefined;

  return (
    <Panel id="weather" aria-labelledby="schedule-title">
      <PanelHeader
        title="Work schedule"
        titleId="schedule-title"
        description={`Hour by hour, 6 AM to 7 PM, in site time.${sun}`}
      />

      {w.alerts.length ? (
        <div className={styles.banner}>
          <strong>
            <Icon name="alert" size={16} /> National Weather Service alerts for
            the day
          </strong>
          <Alerts alerts={w.alerts} />
        </div>
      ) : null}

      <div className={styles.controls}>
        <fieldset id="tasks" className={styles.fieldset}>
          <legend className={styles.small}>Tasks planned</legend>
          <div className={styles.taskControls}>
            {(tasks?.profiles ?? []).map((p) => (
              <label key={p.id} className={styles.check} title={p.description}>
                <input
                  type="checkbox"
                  checked={selected.includes(p.id)}
                  onChange={(e) =>
                    setSelected(
                      e.target.checked
                        ? [...selected, p.id]
                        : selected.filter((id) => id !== p.id),
                    )
                  }
                />{" "}
                {p.label}
              </label>
            ))}
          </div>
        </fieldset>
        {heat.acclimatization ? (
          <label className={styles.check}>
            <input
              type="checkbox"
              checked={newWorkers}
              onChange={(e) => setNewWorkers(e.target.checked)}
            />{" "}
            Some workers are new to the job or back after a break
          </label>
        ) : null}
      </div>

      <div className={styles.matrixWrap}>
        <table className={styles.matrix}>
          <caption className="sr-only">
            Hourly work schedule. Select an hour heading for its details.
          </caption>
          <thead>
            <tr>
              <th scope="col" className={styles.rowHead}>
                <span className="sr-only">Row</span>
              </th>
              {HOURS.map((h) => (
                <th
                  scope="col"
                  key={h}
                  data-selected={hour === h ? "true" : undefined}
                >
                  <button
                    type="button"
                    className={styles.hourBtn}
                    aria-pressed={hour === h}
                    aria-label={`Details for ${formatHour(h)}`}
                    onClick={() => setHour(h)}
                    onFocus={() => setHour(h)}
                    onMouseEnter={() => setHour(h)}
                  >
                    {formatHour(h)}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row" className={styles.rowHead}>
                Weather
              </th>
              {HOURS.map((h) => {
                const row = hourly.get(h);
                const have = Boolean(row?.have_data);
                const stop = have && !row!.safe;
                return (
                  <Cell
                    key={h}
                    selected={hour === h}
                    state={!have ? "none" : stop ? "stop" : "ok"}
                    text={!have ? "-" : stop ? "STOP" : "OK"}
                    label={`${formatHour(h)}, ${
                      !have
                        ? "no forecast"
                        : stop
                          ? `blocked by ${row!.blocked_by.join(" and ")}`
                          : "no wind, storm, rain or heat limit reached"
                    }`}
                  />
                );
              })}
            </tr>
            {taskRows.map((t) => (
              <tr key={t.key}>
                <th scope="row" className={styles.rowHead}>
                  {t.label}
                </th>
                {HOURS.map((h) => {
                  const r = t.results.find((x) => x.hour === h);
                  const stop = Boolean(r?.blocked);
                  return (
                    <Cell
                      key={h}
                      selected={hour === h}
                      state={stop ? "stop" : "ok"}
                      text={stop ? "STOP" : "OK"}
                      label={`${formatHour(h)}, ${stop ? `blocked: ${r!.reasons.join("; ")}` : "clear"}`}
                    />
                  );
                })}
              </tr>
            ))}
            <tr>
              <th scope="row" className={styles.rowHead}>
                Heat index (F)
              </th>
              {HOURS.map((h) => {
                const x = heatByHour.get(h);
                const hi = x?.hi ?? null;
                return (
                  <Cell
                    key={h}
                    selected={hour === h}
                    band={x?.band}
                    mark={x?.band ? BAND_SEVERITY[x.band] : null}
                    peak={h === peakHour}
                    text={hi === null ? "-" : String(Math.round(hi))}
                    label={`${formatHour(h)}, heat index ${hi === null ? "unknown" : `${Math.round(hi)} F`}, ${bandName(x?.band ?? null)}${
                      h === peakHour ? ", peak of the day" : ""
                    }`}
                  />
                );
              })}
            </tr>
            {aq?.hourlyRow ? (
              <tr>
                <th scope="row" className={styles.rowHead}>
                  Air quality (AQI)
                </th>
                {HOURS.map((h) => {
                  const v = airHours.get(h)?.us_aqi ?? null;
                  return (
                    <Cell
                      key={h}
                      selected={hour === h}
                      text={v === null ? "-" : String(Math.round(v))}
                      label={`${formatHour(h)}, air quality index ${v === null ? "unknown" : Math.round(v)}`}
                    />
                  );
                })}
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <p className={styles.hourDetail} role="status" aria-live="polite">
        {detail ? (
          <>
            <strong>{formatHour(detail.hour)}</strong> · Gusts{" "}
            {num(detail.gust, " mph")} · Rain chance {num(detail.pop, "%")} ·
            Rain {num(detail.mm, " mm per hour")} ·{" "}
            <Abbr long="convective available potential energy: the fuel a thunderstorm can use. Higher means stronger storms are possible">
              CAPE
            </Abbr>{" "}
            {num(detail.cape, " J/kg")} · Heat index {num(detail.hi, " F")}
            {detail.blocked_by.length
              ? ` · Weather limit: ${detail.blocked_by.join(", ")}`
              : ""}
          </>
        ) : (
          <span className={styles.muted}>
            Select an hour for gusts, rain chance, rain and CAPE.
          </span>
        )}
      </p>

      {chosen.length ? (
        <ul className={styles.plain} aria-label="Selected tasks">
          {taskRows.map((t) => {
            const why = [
              ...new Set(
                t.results
                  .filter((x) => x.hour >= FIRST_HOUR && x.hour <= LAST_HOUR)
                  .flatMap((x) => x.reasons),
              ),
            ];
            return (
              <li key={t.key}>
                <strong>{t.label}:</strong> {windowText(t.results)}.{" "}
                <span className={styles.muted}>
                  {why.length
                    ? `Blocked by: ${why.join("; ")}.`
                    : "No limit is reached in the workday."}
                </span>
              </li>
            );
          })}
        </ul>
      ) : tasks?.profiles.length ? (
        <p className={styles.muted}>Pick at least one task.</p>
      ) : null}

      {heat.status === "ok" && heat.hours && peak ? (
        <section
          id="heat"
          className={styles.heat}
          aria-label="Heat and water breaks"
        >
          <p>
            <strong>
              Peak heat index {Math.round(peak.hi)} F at {formatHour(peak.hour)}
            </strong>{" "}
            ({bandName(peak.band)})
            {peak.hi_full_sun_max !== null
              ? ` · up to ${peak.hi_full_sun_max} F in full sun${sunBand ? ` (${sunBand.name})` : ""}`
              : ""}
            {peak.wbgt !== null ? (
              <>
                {" "}
                · <Abbr long="wet bulb globe temperature">WBGT</Abbr>{" "}
                {Math.round(peak.wbgt)} F
              </>
            ) : null}
          </p>
          <ol className={styles.plain} aria-label="Water and rest timeline">
            {(heat.water_plan ?? []).map((step) => (
              <li
                key={`${step.start}-${step.band}`}
                className={styles.waterStep}
              >
                {BAND_SEVERITY[step.band] ? (
                  <SeverityMark
                    severity={BAND_SEVERITY[step.band]!}
                    size={14}
                  />
                ) : null}
                <span>
                  <span className={styles.time}>
                    {clockFromHHMM(step.start)} to {clockFromHHMM(step.end)}
                  </span>{" "}
                  <strong>{step.name}</strong>
                  {step.water_every_min
                    ? ` · water about every ${step.water_every_min} min`
                    : ""}
                  {step.rest ? ` · ${step.rest}` : ""}
                </span>
              </li>
            ))}
          </ol>
          {heat.source ? (
            <p className={styles.small}>{heat.source.verified}</p>
          ) : null}
          <AboutData label="What the bands mean">
            <ul className={styles.plain}>
              {bands.map((b) => (
                <li key={b.id}>
                  <strong>
                    {b.name} ({bandRange(bands, b.id)}).
                  </strong>{" "}
                  {b.effects ??
                    "No heat-specific effects are listed for this range."}
                </li>
              ))}
            </ul>
          </AboutData>
        </section>
      ) : (
        <p id="heat" className={styles.muted}>
          {heat.reason ?? "No heat forecast is available for this day."}
        </p>
      )}

      {newWorkers && heat.acclimatization ? (
        <Acclimatization heat={heat.acclimatization} />
      ) : null}

      {tasks && tasks.status === "ok" ? (
        <TaskLimits
          tasks={tasks}
          chosen={chosen}
          overrides={overrides}
          setLimit={setLimit}
          resetLimits={resetLimits}
        />
      ) : null}

      <HourlyDetail report={report} />
    </Panel>
  );
}

function Acclimatization({
  heat,
}: {
  heat: NonNullable<NextDayReport["heat"]["acclimatization"]>;
}) {
  return (
    <section aria-label="Workers new to the heat" className={styles.heat}>
      <p>{heat.who}</p>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <caption className={styles.small}>
            Most time in the heat, as a share of the usual time, by day
          </caption>
          <thead>
            <tr>
              <th scope="col">Day</th>
              {heat.new.schedule.map((d) => (
                <th scope="col" key={d.day}>
                  {d.day}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[heat.new, heat.experienced].map((row) => (
              <tr key={row.label}>
                <th scope="row">{row.label}</th>
                {heat.new.schedule.map((d) => {
                  const v = row.schedule.find((x) => x.day === d.day);
                  return (
                    <td key={d.day}>{v ? `${v.max_percent}%` : "100%"}</td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className={styles.list}>
        {heat.notes.map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>
      <p className={styles.small}>
        {heat.source.verified} Sources:{" "}
        {heat.source.urls.map((u, i) => (
          <span key={u}>
            {i ? ", " : ""}
            <a href={u}>{new URL(u).pathname}</a>
          </span>
        ))}
        .
      </p>
    </section>
  );
}

/** The old hourly table and the National Weather Service text, folded. They open when the page prints. */
function HourlyDetail({ report }: { report: NextDayReport }) {
  const w = report.weather;
  const limits = w.limits;
  const hours = (w.hours ?? []).filter(
    (h) => h.hour >= FIRST_HOUR && h.hour <= LAST_HOUR,
  );
  const rows: {
    id: string;
    label: ReactNode;
    get: (h: (typeof hours)[number]) => number | null;
    over: (v: number) => boolean;
  }[] = limits
    ? [
        {
          id: "pop",
          label: "Rain chance (%)",
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
      ]
    : [];
  return (
    <AboutData label="Hourly detail and forecast text">
      {limits && hours.length ? (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <caption className={styles.small}>
              Bold cells reach a limit: rain chance {limits.pop}%, gusts{" "}
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
      ) : (
        <p className={styles.muted}>
          {w.reason ?? "No weather forecast is available for this day."}
        </p>
      )}
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
      {w.alerts_status === "missing" ? (
        <p className={styles.muted}>
          Alerts could not be loaded: {w.alerts_reason}
        </p>
      ) : w.alerts.length ? null : (
        <p className={styles.muted}>
          No active alerts overlap this day. Alerts can be issued later.
        </p>
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
    </AboutData>
  );
}
