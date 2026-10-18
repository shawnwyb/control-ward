import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Field, Input, Panel, PanelHeader } from "../../components/ui";
import { errorMessage } from "../../lib/format";
import type { Role } from "../../lib/monitoring";
import type { Site } from "../../lib/types";
import * as api from "./api";
import type { Reading, Workspace } from "./api";
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
export function SafetyPanel({ site }: { site: Site; role: Role }) {
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
        description="Generated automatically from this worksite's location, official safety sources and local conditions. Live alerts and stop-work directions apply immediately."
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
      />
    </Panel>
  );
}
function AutomaticChecklist({
  siteId,
  date,
}: {
  siteId: string;
  date: string;
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
          Automatic safety generation is not configured. Existing weather plans
          and live alerts remain available.
        </p>
      ) : null}
      {data?.run && data.run.state !== "succeeded" ? (
        <p role="status">
          Updating automatically: {data.run.state} · Attempt {data.run.attempt}
          {data.run.error_category ? ` · ${data.run.error_category}` : ""}. No
          supervisor action is required to generate a checklist.
        </p>
      ) : null}
      {data && !checklist ? (
        <p>
          No generated checklist for this site and date yet. The site worker
          prepares it automatically; follow live alerts and existing site
          procedures while it is unavailable.
        </p>
      ) : null}
      {checklist && content ? (
        <>
          <section
            className={styles.box}
            aria-label="Automatic worker checklist"
          >
            <h3>Automatic worker checklist</h3>
            <p>
              <strong>
                {checklist.current ? "Current" : "Updating / out of date"}
              </strong>{" "}
              · Work date {checklist.work_date}
            </p>
            <p className={styles.muted}>
              Generated {new Date(checklist.generated_at).toLocaleString()} ·
              Valid until {new Date(checklist.valid_until).toLocaleString()}
            </p>
            {!checklist.current ? (
              <p className={styles.warning}>
                Conditions changed or this checklist expired. A replacement is
                prepared automatically. Follow live alerts; acknowledgement is
                unavailable until current guidance arrives.
              </p>
            ) : null}
            <p>{content.summary}</p>
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
            <h4>Local conditions</h4>
            {content.conditions.length ? (
              <ul className={styles.list}>
                {conditionRows(content.conditions).map((reading) => (
                  <li
                    key={`${reading.hazard}:${reading.unit}:${reading.forecast_for}`}
                  >
                    <strong>
                      {units[reading.unit] ??
                        `${reading.hazard} (${reading.unit})`}
                      : {Number(reading.value.toFixed(1))}
                    </strong>
                    <span className={styles.muted}>
                      {" "}
                      ·{" "}
                      {reading.forecast_for === "-infinity"
                        ? "Observation"
                        : `Forecast for ${new Date(reading.forecast_for).toLocaleString()}`}{" "}
                      · Recorded{" "}
                      {new Date(reading.observed_at).toLocaleString()}
                      {Date.now() - Date.parse(reading.observed_at) > 7200000
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
            <h4>Worker checklist</h4>
            {content.items.length ? (
              <ol className={styles.list}>
                {content.items.map((item) => (
                  <li key={item.id}>
                    <div className={styles.item}>
                      <span className={styles.label}>
                        {item.kind === "regulation"
                          ? "Regulatory source — applicability depends on scope"
                          : "Safety guidance"}
                      </span>
                      <strong>{item.title}</strong>
                      <span>{item.text}</span>
                      <span className={styles.muted}>{item.conditions}</span>
                      {item.citations.map((citation, i) => {
                        const source = content.sources.find(
                          (s) => s.id === citation.source_id,
                        );
                        return (
                          <details className={styles.evidence} key={i}>
                            <summary>
                              {source?.title ?? "Supporting source"}
                            </summary>
                            <blockquote>{citation.quote}</blockquote>
                            {source?.url ? (
                              <a
                                href={source.url}
                                target="_blank"
                                rel="noreferrer"
                              >
                                Open official source
                              </a>
                            ) : null}
                          </details>
                        );
                      })}
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <p>
                No verified instruction could be extracted. See the coverage
                gaps below.
              </p>
            )}
            {content.coverage_gaps.length ? (
              <div className={styles.warning}>
                <strong>Coverage and unavailable information</strong>
                <ul>
                  {content.coverage_gaps.map((gap, i) => (
                    <li key={i}>{gap}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            <h4>Sources checked automatically</h4>
            {content.sources.map((source) => (
              <details className={styles.evidence} key={source.id}>
                <summary>{source.title}</summary>
                <p>
                  {source.level} · {source.jurisdiction} · Checked{" "}
                  {new Date(source.checked_at).toLocaleString()}
                </p>
                {source.url ? (
                  <a href={source.url} target="_blank" rel="noreferrer">
                    Open official source
                  </a>
                ) : null}
              </details>
            ))}
            {content.search_entry_point ? (
              <iframe
                title="Google Search source suggestions"
                sandbox="allow-popups"
                srcDoc={content.search_entry_point}
                className={styles.searchSuggestions}
              />
            ) : null}
            <p className={styles.muted}>
              Acknowledgement records receipt of this version. It does not
              establish training, qualification or work completion.
            </p>
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
          </section>
        </>
      ) : null}
      <div className={styles.actions}>
        <Button variant="quiet" onClick={() => void refresh()}>
          Refresh checklist
        </Button>
        <span className={styles.muted}>
          Research, generation and updates run automatically.
        </span>
      </div>
    </div>
  );
}
