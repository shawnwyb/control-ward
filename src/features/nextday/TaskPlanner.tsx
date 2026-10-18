import { useMemo, useState } from "react";
import { Badge, Panel, PanelHeader } from "../../components/ui";
import {
  clockFromHHMM,
  formatHour,
  type NextDayReport,
} from "../../lib/nextDayReport";
import { HourStrip, type StripCell } from "./HourStrip";
import {
  blockedHours,
  combine,
  limitFor,
  longestWindow,
  overrideKey,
  type HourResult,
  type Overrides,
} from "./taskPlan";
import { FIRST_HOUR, LAST_HOUR } from "./hours";
import styles from "./NextDayReport.module.css";

const storeKey = (eia: string) => `planit.tasklimits.v1.${eia}`;

// Saved limits are a per-device convenience. Storage can be blocked or empty, so every access is guarded.
function loadOverrides(eia: string): Overrides {
  try {
    const raw = window.localStorage.getItem(storeKey(eia));
    const parsed = raw ? (JSON.parse(raw) as unknown) : {};
    if (parsed && typeof parsed === "object")
      return Object.fromEntries(
        Object.entries(parsed).filter(
          ([, v]) => typeof v === "number" && Number.isFinite(v),
        ),
      ) as Overrides;
  } catch {
    /* ignore */
  }
  return {};
}

function saveOverrides(eia: string, value: Overrides) {
  try {
    window.localStorage.setItem(storeKey(eia), JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

const hhmm = (h: number) => `${String(h).padStart(2, "0")}:00`;

function cellsFor(results: HourResult[]): StripCell[] {
  return results
    .filter((r) => r.hour >= FIRST_HOUR && r.hour <= LAST_HOUR)
    .map((r) => ({
      hour: r.hour,
      value: r.blocked ? "stop" : "ok",
      blocked: r.blocked,
      label: `${formatHour(r.hour)}, ${r.blocked ? `blocked: ${r.reasons.join("; ")}` : "clear"}`,
    }));
}

function Window({ results }: { results: HourResult[] }) {
  const w = longestWindow(results);
  return w ? (
    <strong>
      Best window: {clockFromHHMM(hhmm(w.start))} to{" "}
      {clockFromHHMM(hhmm(w.end))}.
    </strong>
  ) : (
    <strong>No clear two-hour stretch between 6 AM and 7 PM.</strong>
  );
}

export function TaskPlanner({ report }: { report: NextDayReport }) {
  const tasks = report.tasks;
  const eia = report.meta.site.eia;
  const [selected, setSelected] = useState<string[]>(
    tasks?.profiles[0] ? [tasks.profiles[0].id] : [],
  );
  const [overrides, setOverrides] = useState<Overrides>(() =>
    loadOverrides(eia),
  );

  const results = useMemo(() => {
    if (!tasks) return new Map<string, HourResult[]>();
    return new Map(
      tasks.profiles.map((p) => [
        p.id,
        blockedHours(p, report.hourly, tasks.site_flags, overrides),
      ]),
    );
  }, [tasks, report.hourly, overrides]);

  if (!tasks || tasks.status !== "ok" || !report.hourly.length)
    return (
      <Panel id="tasks" aria-labelledby="tasks-title">
        <PanelHeader title="Task planner" titleId="tasks-title" />
        <p className={styles.muted}>
          {!report.hourly.length
            ? "No hourly forecast, so task hours cannot be worked out."
            : "This report has no task profiles. Rebuild it."}
        </p>
      </Panel>
    );

  const chosen = tasks.profiles.filter((p) => selected.includes(p.id));
  const setLimit = (profileId: string, blockerId: string, value: string) => {
    const next = { ...overrides };
    const n = Number(value);
    if (value === "" || !Number.isFinite(n))
      delete next[overrideKey(profileId, blockerId)];
    else next[overrideKey(profileId, blockerId)] = n;
    setOverrides(next);
    saveOverrides(eia, next);
  };

  return (
    <Panel id="tasks" aria-labelledby="tasks-title">
      <PanelHeader
        title="Task planner"
        titleId="tasks-title"
        description="Pick the tasks planned for the day. An hour is blocked when a limit for that task is reached. Limits marked Confirm are defaults: replace them with your equipment manual or site safety plan."
      />
      <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className={styles.small}>Tasks planned</legend>
        <div className={styles.controls}>
          {tasks.profiles.map((p) => (
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

      {chosen.length > 1 ? (
        <>
          <h3 className={styles.sub}>All selected tasks together</h3>
          <p style={{ margin: "0 0 var(--space-2)" }}>
            <Window results={combine(chosen.map((p) => results.get(p.id)!))} />
          </p>
          <HourStrip
            cells={cellsFor(combine(chosen.map((p) => results.get(p.id)!)))}
            caption="Hours clear for every selected task"
          />
        </>
      ) : null}

      {chosen.map((p) => {
        const r = results.get(p.id)!;
        const why = [
          ...new Set(
            r
              .filter((x) => x.hour >= 6 && x.hour < 19)
              .flatMap((x) => x.reasons),
          ),
        ];
        return (
          <section key={p.id} aria-label={p.label}>
            <h3 className={styles.sub}>{p.label}</h3>
            <p style={{ margin: "0 0 var(--space-2)" }}>
              <Window results={r} />{" "}
              <span className={styles.muted}>{p.description}</span>
            </p>
            <HourStrip
              cells={cellsFor(r)}
              caption={`Hours clear for ${p.label}`}
            />
            {why.length ? (
              <p className={styles.muted}>Blocked by: {why.join("; ")}.</p>
            ) : (
              <p className={styles.muted}>
                No limit is reached in the workday.
              </p>
            )}
            <details>
              <summary>Limits for this task</summary>
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th scope="col">Condition</th>
                      <th scope="col">Limit</th>
                      <th scope="col">Source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {p.blockers
                      .filter(
                        (b) =>
                          b.only_if !== "tide_shading" ||
                          tasks.site_flags.tide_shading,
                      )
                      .map((b) => (
                        <tr key={b.id}>
                          <td>{b.label}</td>
                          <td>
                            {b.kind === "hour" &&
                            b.factor !== "tide_near_high" ? (
                              <>
                                <input
                                  type="number"
                                  aria-label={`${p.label}: limit for ${b.label}`}
                                  value={limitFor(p, b, overrides) ?? ""}
                                  onChange={(e) =>
                                    setLimit(p.id, b.id, e.target.value)
                                  }
                                  style={{ width: "5rem" }}
                                />{" "}
                                {b.unit}
                              </>
                            ) : b.kind === "site" ? (
                              `when ${b.flag} is ${b.values?.join(" or ")}`
                            ) : (
                              "within one hour of high tide"
                            )}
                          </td>
                          <td style={{ whiteSpace: "normal" }}>
                            {b.source}{" "}
                            {b.needs_confirmation ? (
                              <Badge>Confirm</Badge>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </details>
          </section>
        );
      })}
      {!chosen.length ? (
        <p className={styles.muted}>Pick at least one task.</p>
      ) : null}
      <p className={styles.small}>{tasks.note}</p>
    </Panel>
  );
}
