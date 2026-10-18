import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Field, Input, Panel, PanelHeader } from "../../components/ui";
import { errorMessage } from "../../lib/format";
import type { Role } from "../../lib/monitoring";
import type { Site } from "../../lib/types";
import * as api from "./api";
import type { ChecklistContent, Reading, Workspace } from "./api";
import styles from "./SafetyPanel.module.css";

export function localWorkDate(
  timezone = "America/New_York",
  now = new Date(),
  offset = 0,
) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: string) => parts.find((p) => p.type === type)?.value;
  const date = new Date(
    `${part("year")}-${part("month")}-${part("day")}T12:00:00Z`,
  );
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}
const units: Record<string, string> = {
  wbgt_f: "Estimated WBGT (F)",
  heat_index_f: "Heat index (F)",
  F: "Heat reading (F)",
};
function conditionRows(readings: Reading[]) {
  const grouped = new Map<string, Reading>();
  for (const reading of readings) {
    const forecast = reading.forecast_for !== "-infinity";
    const key = `${reading.hazard}:${reading.unit}:${forecast}`;
    const previous = grouped.get(key);
    if (
      !previous ||
      Date.parse(reading.observed_at) > Date.parse(previous.observed_at) ||
      (forecast && reading.value > previous.value)
    )
      grouped.set(key, reading);
  }
  return [...grouped.values()]
    .sort((a, b) => Number(b.hazard === "heat") - Number(a.hazard === "heat"))
    .slice(0, 12);
}
export function SafetyPanel({ site, role }: { site: Site; role: Role }) {
  const [date, setDate] = useState(() => localWorkDate(site.timezone));
  const automaticDate = useRef(true);
  useEffect(() => {
    const timer = setInterval(() => {
      if (automaticDate.current) setDate(localWorkDate(site.timezone));
    }, 30000);
    return () => clearInterval(timer);
  }, [site.timezone]);
  return (
    <Panel
      id="safety-checklist"
      className={styles.panel}
      aria-labelledby="safety-title"
    >
      <PanelHeader
        title="Task safety checklist"
        titleId="safety-title"
        description="Priority actions from local conditions and official sources. Follow live alerts and stop-work directions immediately."
        aside={
          <Field id="safety-date" label="Checklist work date">
            <Input
              id="safety-date"
              type="date"
              value={date}
              onChange={(e) => {
                if (e.target.value) {
                  automaticDate.current = false;
                  setDate(e.target.value);
                }
              }}
            />
          </Field>
        }
      />
      <AutomaticChecklist
        key={`${site.id}:${date}`}
        siteId={site.id}
        date={date}
        role={role}
      />
    </Panel>
  );
}
function AutomaticChecklist({
  siteId,
  date,
  role,
}: {
  siteId: string;
  date: string;
  role: Role;
}) {
  const [data, setData] = useState<Workspace>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const alive = useRef(true),
    sequence = useRef(0);
  const refresh = useCallback(async () => {
    const request = ++sequence.current;
    try {
      const next = await api.fetchWorkspace(siteId, date);
      if (alive.current && request === sequence.current) {
        setData(next);
        setError("");
      }
    } catch (e) {
      if (alive.current && request === sequence.current)
        setError(errorMessage(e));
    }
  }, [siteId, date]);
  useEffect(() => {
    alive.current = true;
    void refresh();
    const timer = setInterval(() => void refresh(), 3000);
    return () => {
      alive.current = false;
      sequence.current++;
      clearInterval(timer);
    };
  }, [refresh]);
  async function acknowledge() {
    if (!data?.checklist || busy) return;
    setBusy(true);
    try {
      await api.acknowledge(data.checklist.id);
      await refresh();
    } catch (e) {
      if (alive.current) setError(errorMessage(e));
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  const checklist = data?.checklist;
  const content = checklist?.content;
  const readings = conditionRows(content?.conditions ?? []);
  return (
    <div className={styles.body}>
      {error ? (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      ) : null}
      {!data ? <p>Loading automatic safety checklist...</p> : null}
      {data && !data.enabled ? (
        <p className={styles.warning}>
          Automatic safety generation is not configured. Follow live alerts and
          existing site procedures.
        </p>
      ) : null}
      {data?.run && data.run.state !== "succeeded" ? (
        <p role="status">
          {data.run.state === "failed"
            ? "Checklist update unavailable. Follow live alerts and site procedures."
            : "Checklist updating automatically. No supervisor action required."}
        </p>
      ) : null}
      {data && !checklist ? (
        <p>
          No generated checklist for this site and date yet. Follow live alerts
          and existing site procedures while it is unavailable.
        </p>
      ) : null}
      {checklist && content ? (
        <section className={styles.box} aria-label="Automatic worker checklist">
          <h3>Automatic worker checklist</h3>
          <p>
            <strong>
              {checklist.current ? "Current" : "Updating / out of date"}
            </strong>{" "}
            · Work date {checklist.work_date}
          </p>
          {!checklist.current ? (
            <p className={styles.warning}>
              Conditions changed or this checklist expired. Follow live alerts
              while a replacement is prepared. Acknowledgement is unavailable.
            </p>
          ) : null}
          {readings.length ? (
            <ul
              className={styles.conditions}
              aria-label="Priority local conditions"
            >
              {readings.slice(0, 3).map((r) => (
                <li key={`${r.hazard}:${r.unit}:${r.forecast_for}`}>
                  <strong>
                    {units[r.unit] ?? `${r.hazard} (${r.unit})`}:{" "}
                    {Number(r.value.toFixed(1))}
                  </strong>
                  <span className={styles.muted}>
                    {" "}
                    · {r.forecast_for === "-infinity" ? "Observed" : "Forecast"}
                    {Date.now() - Date.parse(r.observed_at) > 7200000
                      ? " · STALE"
                      : ""}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.warning}>
              No current local readings are available. Check conditions before
              work.
            </p>
          )}
          <p className={styles.muted}>
            Read scope before applying an action. Coverage is incomplete; site
            procedures and live alerts still apply.
          </p>
          {content.items.length ? (
            <>
              <ol className={styles.list} aria-label="Priority worker actions">
                {content.items.slice(0, 5).map((item) => (
                  <Instruction
                    key={item.id}
                    item={item}
                    sources={content.sources}
                  />
                ))}
              </ol>
              {content.items.length > 5 ? (
                <details className={styles.evidence}>
                  <summary>
                    {content.items.length - 5} additional instructions from this
                    version
                  </summary>
                  <ol className={styles.list} start={6}>
                    {content.items.slice(5).map((item) => (
                      <Instruction
                        key={item.id}
                        item={item}
                        sources={content.sources}
                      />
                    ))}
                  </ol>
                </details>
              ) : null}
            </>
          ) : (
            <p>
              No verified instruction could be extracted. Follow site procedures
              and check coverage details.
            </p>
          )}
          {content.coverage_gaps.length ? (
            <details className={`${styles.evidence} ${styles.warning}`}>
              <summary>
                Coverage is limited · {content.coverage_gaps.length} notes
              </summary>
              <ul>
                {content.coverage_gaps.map((gap, i) => (
                  <li key={i}>{gap}</li>
                ))}
              </ul>
            </details>
          ) : null}
          <details className={styles.evidence}>
            <summary>
              {role === "supervisor"
                ? "Research details"
                : "Sources and conditions"}{" "}
              · {content.sources.length} sources
            </summary>
            <p>
              Jurisdiction:{" "}
              {[
                content.jurisdiction.city,
                content.jurisdiction.county,
                content.jurisdiction.state,
              ]
                .filter(Boolean)
                .join(", ") || "Lookup unavailable"}
            </p>
            <p>
              Generated {new Date(checklist.generated_at).toLocaleString()} ·
              Valid until {new Date(checklist.valid_until).toLocaleString()}
            </p>
            <p>{content.summary}</p>
            {role === "supervisor" && data?.run ? (
              <p>
                Updating automatically: {data.run.state} · Attempt{" "}
                {data.run.attempt}
                {data.run.error_category ? ` · ${data.run.error_category}` : ""}
              </p>
            ) : null}
            <ul>
              {readings.map((r) => (
                <li key={`${r.hazard}:${r.unit}:${r.forecast_for}`}>
                  {units[r.unit] ?? `${r.hazard} (${r.unit})`}:{" "}
                  {Number(r.value.toFixed(1))} ·{" "}
                  {r.forecast_for === "-infinity"
                    ? "Observation"
                    : `Forecast for ${new Date(r.forecast_for).toLocaleString()}`}{" "}
                  · Recorded {new Date(r.observed_at).toLocaleString()}
                </li>
              ))}
            </ul>
            {content.sources.map((source) => (
              <p key={source.id}>
                <a href={source.url} target="_blank" rel="noreferrer">
                  {source.title}
                </a>{" "}
                · {source.level} · {source.jurisdiction} · Checked{" "}
                {new Date(source.checked_at).toLocaleString()}
              </p>
            ))}
          </details>
          <Button
            variant="primary"
            disabled={
              busy || !!error || !checklist.current || checklist.acknowledged
            }
            onClick={() => void acknowledge()}
          >
            {checklist.acknowledged
              ? "Receipt recorded"
              : "Acknowledge this checklist"}
          </Button>
          <p className={styles.muted}>
            Records receipt of this version, not training or work completion.
          </p>
        </section>
      ) : null}
      <div className={styles.actions}>
        <Button variant="quiet" onClick={() => void refresh()}>
          Refresh checklist
        </Button>
        <span className={styles.muted}>Updates automatically.</span>
      </div>
    </div>
  );
}
function Instruction({
  item,
  sources,
}: {
  item: ChecklistContent["items"][number];
  sources: ChecklistContent["sources"];
}) {
  return (
    <li>
      <div className={styles.item}>
        <strong>{item.title}</strong>
        <details className={styles.evidence}>
          <summary>
            Scope &amp; sources ·{" "}
            {item.kind === "regulation"
              ? "Regulatory excerpt"
              : "Safety guidance"}
          </summary>
          <p>{item.conditions}</p>
          {item.citations.map((citation, i) => {
            const source = sources.find((s) => s.id === citation.source_id);
            return (
              <div key={i}>
                <blockquote>{citation.quote}</blockquote>
                {source ? (
                  <a href={source.url} target="_blank" rel="noreferrer">
                    {source.title}
                  </a>
                ) : null}
              </div>
            );
          })}
        </details>
      </div>
    </li>
  );
}
