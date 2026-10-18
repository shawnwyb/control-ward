import { Badge, Button } from "../../components/ui";
import type { TaskProfile, TasksSection } from "../../lib/nextDayReport";
import { AboutData } from "./AboutData";
import { limitFor, overrideKey, type Overrides } from "./taskPlan";
import styles from "./NextDayReport.module.css";

const storeKey = (eia: string) => `planit.tasklimits.v1.${eia}`;

// Saved limits are a per-device convenience. Storage can be blocked or empty, so every access is guarded.
export function loadOverrides(eia: string): Overrides {
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

export function saveOverrides(eia: string, value: Overrides) {
  try {
    window.localStorage.setItem(storeKey(eia), JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

/** The limits behind each selected task, editable. A limit marked Confirm is a default to replace with the site's own. */
export function TaskLimits({
  tasks,
  chosen,
  overrides,
  setLimit,
  resetLimits,
}: {
  tasks: TasksSection;
  chosen: TaskProfile[];
  overrides: Overrides;
  setLimit: (profileId: string, blockerId: string, value: string) => void;
  resetLimits: (profile: TaskProfile) => void;
}) {
  return (
    <AboutData label="Task limits and sources">
      <p className={styles.small}>
        An hour is blocked when a limit for that task is reached. Limits marked
        Confirm are defaults: replace them with your equipment manual or site
        safety plan.
      </p>
      {chosen.map((p) => (
        <section key={p.id} aria-label={`${p.label}: limits`}>
          <h3 className={styles.sub}>{p.label}</h3>
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
                        {b.kind === "hour" && b.factor !== "tide_near_high" ? (
                          <>
                            <input
                              type="number"
                              inputMode="decimal"
                              min={0}
                              step={b.factor === "mm" ? 0.5 : 1}
                              className={styles.limitInput}
                              aria-label={`${p.label}: limit for ${b.label}`}
                              value={limitFor(p, b, overrides) ?? ""}
                              onChange={(e) =>
                                setLimit(p.id, b.id, e.target.value)
                              }
                            />{" "}
                            {b.unit}{" "}
                            {overrides[overrideKey(p.id, b.id)] !==
                            undefined ? (
                              <Badge>Edited, default {b.limit}</Badge>
                            ) : null}
                          </>
                        ) : b.kind === "site" ? (
                          `when ${b.flag} is ${b.values?.join(" or ")}`
                        ) : (
                          "within one hour of high tide"
                        )}
                      </td>
                      <td style={{ whiteSpace: "normal" }}>
                        {b.source}{" "}
                        {b.needs_confirmation ? <Badge>Confirm</Badge> : null}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          {p.blockers.some(
            (b) => overrides[overrideKey(p.id, b.id)] !== undefined,
          ) ? (
            <Button onClick={() => resetLimits(p)}>
              Reset {p.label.toLowerCase()} limits to the defaults
            </Button>
          ) : null}
        </section>
      ))}
      {!chosen.length ? (
        <p className={styles.muted}>
          Pick at least one task to see its limits.
        </p>
      ) : null}
      <p className={styles.small}>{tasks.note}</p>
    </AboutData>
  );
}
