import { useCallback, useEffect, useRef, useState } from "react";
import {
  Button,
  Field,
  Input,
  Panel,
  PanelHeader,
  Select,
} from "../../components/ui";
import { errorMessage } from "../../lib/format";
import type { Role } from "../../lib/monitoring";
import type { Site } from "../../lib/types";
import * as api from "./api";
import type {
  Evidence,
  Revision,
  SafetyDraft,
  SafetyItem,
  SafetyJob,
  SafetyProfile,
  Workspace,
} from "./api";
import styles from "./SafetyPanel.module.css";

export function nextWorkDate(timezone = "America/New_York", now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = (type: string) => parts.find((p) => p.type === type)?.value;
  const date = new Date(
    `${value("year")}-${value("month")}-${value("day")}T12:00:00Z`,
  );
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}
export function SafetyPanel({ site, role }: { site: Site; role: Role }) {
  const [date, setDate] = useState(() => nextWorkDate(site.timezone));
  return (
    <Panel id="safety-checklist" aria-labelledby="safety-title">
      <PanelHeader
        title="Task safety checklist"
        titleId="safety-title"
        description="A cited checklist reviewed by your site supervisor. Live alerts and stop-work directions apply immediately."
        aside={
          <Field id="safety-date" label="Checklist work date">
            <Input
              id="safety-date"
              type="date"
              value={date}
              onChange={(e) => {
                if (e.target.value) setDate(e.target.value);
              }}
            />
          </Field>
        }
      />
      <SafetyWorkspace
        key={`${site.id}:${date}:${role}`}
        siteId={site.id}
        date={date}
        supervisor={role === "supervisor"}
      />
    </Panel>
  );
}
function EvidenceDetails({ evidence }: { evidence: Evidence[] }) {
  return (
    <div className={styles.stack}>
      {evidence.map((e) => (
        <details className={styles.evidence} key={e.id}>
          <summary>
            {e.title}
            {e.anchor ? ` · ${e.anchor}` : ""}
            {e.fictional ? " · FICTIONAL DEMO" : ""}
          </summary>
          <p>{e.excerpt}</p>
          <p>{e.conditions}</p>
          <p className={styles.muted}>
            {e.authority ?? "PlanIT record"} · Evidence {e.id}
            {e.version_id ? ` · Version ${e.version_id}` : ""}
          </p>
          <p className={styles.muted}>
            Effective: {e.effective_on ?? "unknown"} · Superseded:{" "}
            {e.superseded_on ?? "unknown"}
            {e.last_checked_at
              ? ` · Checked ${new Date(e.last_checked_at).toLocaleString()}`
              : ""}
            {e.observed_at
              ? ` · Recorded ${new Date(e.observed_at).toLocaleString()}`
              : ""}
          </p>
          {e.url && e.url.startsWith("https://www.osha.gov/") ? (
            <a href={e.url} target="_blank" rel="noreferrer">
              Open official source
            </a>
          ) : null}
        </details>
      ))}
    </div>
  );
}
function Items({ items }: { items: SafetyItem[] }) {
  return items.length ? (
    <ol className={styles.list}>
      {items.map((item, i) => (
        <li key={`${item.evidence_ids[0]}-${i}`}>
          <div className={styles.item}>
            <span className={styles.label}>
              {item.type.replaceAll("_", " ")} · {item.applicability}
            </span>
            <strong>{item.text}</strong>
            <span className={styles.muted}>{item.conditions}</span>
          </div>
        </li>
      ))}
    </ol>
  ) : (
    <p className={styles.muted}>
      No task instructions are supported in this revision. Review the coverage
      gaps.
    </p>
  );
}
function Gaps({ gaps }: { gaps: string[] }) {
  return gaps.length ? (
    <div className={styles.warning}>
      <strong>Coverage and unresolved questions</strong>
      <ul>
        {gaps.map((gap, i) => (
          <li key={i}>{gap}</li>
        ))}
      </ul>
    </div>
  ) : null;
}
function SafetyWorkspace({
  siteId,
  date,
  supervisor,
}: {
  siteId: string;
  date: string;
  supervisor: boolean;
}) {
  const [data, setData] = useState<Workspace>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const alive = useRef(true),
    sequence = useRef(0),
    inFlight = useRef(false);
  const refresh = useCallback(async () => {
    const seq = ++sequence.current;
    try {
      const next = await api.fetchWorkspace(siteId, date);
      if (alive.current && seq === sequence.current) {
        setData(next);
        setError("");
      }
    } catch (e) {
      if (alive.current && seq === sequence.current) setError(errorMessage(e));
    }
  }, [siteId, date]);
  useEffect(() => {
    alive.current = true;
    void refresh();
    const timer = setInterval(() => {
      if (!inFlight.current) void refresh();
    }, 3000);
    return () => {
      alive.current = false;
      sequence.current++;
      clearInterval(timer);
    };
  }, [refresh]);
  async function act(fn: () => Promise<unknown>, done: string) {
    if (inFlight.current) return false;
    inFlight.current = true;
    setBusy(true);
    setMessage("");
    try {
      await fn();
      if (alive.current) {
        setMessage(done);
        await refresh();
      }
      return true;
    } catch (e) {
      if (alive.current) setError(errorMessage(e));
      return false;
    } finally {
      inFlight.current = false;
      if (alive.current) setBusy(false);
    }
  }
  if (!data)
    return (
      <div className={styles.body}>
        {error ? (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        ) : (
          <p>Loading safety checklist…</p>
        )}
        <Button onClick={() => void refresh()}>Reload checklist</Button>
      </div>
    );
  const pub = data.publication;
  const current =
    pub?.status === "published" &&
    !pub.needs_review &&
    !pub.expired &&
    !data.freshness?.needs_review;
  const disabled = busy || !!error;
  return (
    <div className={styles.body}>
      {error ? (
        <p role="alert" className={styles.error}>
          {error}{" "}
          <Button variant="quiet" onClick={() => void refresh()}>
            Reload checklist
          </Button>
        </p>
      ) : null}
      {message ? <p role="status">{message}</p> : null}
      {!data.enabled ? (
        <p className={styles.muted}>
          Safety generation is disabled. Existing weather plans and live alerts
          remain available.
        </p>
      ) : null}
      {data.freshness?.feed_stale ? (
        <p className={styles.warning}>
          Hazard feed is missing or stale. Check live conditions with the
          supervisor before work.
        </p>
      ) : null}
      <section className={styles.box} aria-label="Published worker checklist">
        <h3>Published worker checklist</h3>
        {pub ? (
          <>
            <p>
              <strong>
                {pub.status === "withdrawn"
                  ? "Withdrawn"
                  : pub.status === "superseded"
                    ? "Superseded"
                    : pub.expired
                      ? "Expired"
                      : !current
                        ? "Needs supervisor review"
                        : "Published"}
              </strong>{" "}
              · Work date {date}
            </p>
            <p className={styles.muted}>
              Published {new Date(pub.published_at).toLocaleString()} ·
              Supervisor {pub.published_by} · Revision {pub.revision_id}
            </p>
            {!current ? (
              <p className={styles.warning}>
                This checklist is not current guidance. Ask the supervisor for
                the reviewed revision and follow live alerts.
              </p>
            ) : null}
            <Items items={pub.worker_payload.worker_items} />
            <Gaps gaps={pub.worker_payload.coverage_gaps} />
            <EvidenceDetails evidence={pub.worker_payload.evidence} />
            <p className={styles.muted}>
              Acknowledgement records receipt of this publication. It does not
              establish training, qualification or work completion.
            </p>
            <div className={styles.actions}>
              <Button
                variant="primary"
                disabled={disabled || !current || pub.acknowledged}
                onClick={() =>
                  void act(
                    () => api.acknowledge(pub.id),
                    "Receipt recorded for this publication.",
                  )
                }
              >
                {pub.acknowledged
                  ? "Receipt recorded"
                  : "Acknowledge this revision"}
              </Button>
              {supervisor && pub.status === "published" ? (
                <Button
                  variant="danger"
                  disabled={disabled}
                  onClick={() =>
                    void act(() => api.withdraw(pub.id), "Checklist withdrawn.")
                  }
                >
                  Withdraw checklist
                </Button>
              ) : null}
            </div>
          </>
        ) : (
          <p className={styles.muted}>
            No approved checklist for this site and date. Follow the existing
            weather briefing, live alerts and supervisor directions.
          </p>
        )}
      </section>
      {supervisor && data.context ? (
        <>
          <ContextForm
            key={`${siteId}:${date}`}
            context={data.context}
            disabled={disabled}
            onSave={(profile, job) =>
              act(
                () =>
                  api.saveContext(siteId, date, data.context!, profile, job),
                "Work context saved. Generate a fresh draft for these inputs.",
              )
            }
          />
          <div className={styles.actions}>
            <Button
              disabled={
                disabled ||
                !data.enabled ||
                !data.context.job_revision ||
                !data.context.profile.enabled ||
                data.run?.state === "queued" ||
                data.run?.state === "running"
              }
              onClick={() =>
                void act(
                  () => api.generate(siteId, date, !!data.run),
                  "Draft requested. It will appear here when generation finishes.",
                )
              }
            >
              {data.run ? "Generate new safety draft" : "Generate safety draft"}
            </Button>
            <Button variant="quiet" onClick={() => void refresh()}>
              Refresh safety status
            </Button>
          </div>
          {data.run ? (
            <p role="status">
              Generation: {data.run.state} · Attempt {data.run.attempt}
              {data.run.error_category
                ? ` · ${data.run.error_category}${data.run.state === "queued" ? ` · Retry after ${new Date(data.run.available_at).toLocaleTimeString()}` : ""}`
                : ""}
              . Publication requires supervisor review.
            </p>
          ) : null}
          {data.revision ? (
            <ReviewEditor
              key={data.revision.id}
              revision={data.revision}
              evidence={data.evidence ?? []}
              disabled={disabled}
              onSave={(content) =>
                act(
                  () => api.editRevision(data.revision!, content),
                  "New reviewed revision saved. Review the preview, then publish.",
                )
              }
              onPublish={() =>
                act(
                  () => api.publish(data.revision!),
                  "Safety checklist published to site members.",
                )
              }
            />
          ) : null}
        </>
      ) : null}
    </div>
  );
}
function ContextForm({
  context,
  disabled,
  onSave,
}: {
  context: NonNullable<Workspace["context"]>;
  disabled: boolean;
  onSave: (p: SafetyProfile, j: SafetyJob) => Promise<boolean>;
}) {
  const [profile, setProfile] = useState<SafetyProfile>({
    state: "FL",
    employer_sector: "unknown",
    classification: "unknown",
    enabled: false,
    ...context.profile,
  });
  const [job, setJob] = useState<SafetyJob>({
    task: "electrical_maintenance",
    description: "",
    equipment: "",
    conditions: "",
    energized: "unknown",
    ...context.job,
  });
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (!dirty) {
      setProfile({
        state: "FL",
        employer_sector: "unknown",
        classification: "unknown",
        enabled: false,
        ...context.profile,
      });
      setJob({
        task: "electrical_maintenance",
        description: "",
        equipment: "",
        conditions: "",
        energized: "unknown",
        ...context.job,
      });
    }
  }, [context, dirty]);
  const patchProfile = (p: Partial<SafetyProfile>) => {
    setDirty(true);
    setProfile((current) => ({ ...current, ...p }));
  };
  const patchJob = (p: Partial<SafetyJob>) => {
    setDirty(true);
    setJob((current) => ({ ...current, ...p }));
  };
  return (
    <form
      className={styles.box}
      aria-label="Planned work"
      onSubmit={(e) => {
        e.preventDefault();
        void onSave(profile, job).then((saved) => {
          if (saved) setDirty(false);
        });
      }}
    >
      <h3>Supervisor: confirm coverage and planned work</h3>
      <p className={styles.muted}>
        Pilot: Florida private-sector electrical operations/maintenance. Other
        or unknown selections produce coverage gaps. Confirm employer and
        installation coverage; registry ownership does not establish it.
      </p>
      <div className={styles.grid}>
        <Field id="safety-state" label="State">
          <Input
            id="safety-state"
            required
            maxLength={2}
            pattern="[A-Z]{2}"
            value={profile.state}
            onChange={(e) =>
              patchProfile({ state: e.target.value.toUpperCase() })
            }
          />
        </Field>
        <Field id="safety-sector" label="Employer sector">
          <Select
            id="safety-sector"
            value={profile.employer_sector}
            onChange={(e) =>
              patchProfile({
                employer_sector: e.target
                  .value as SafetyProfile["employer_sector"],
              })
            }
          >
            <option value="unknown">Unknown</option>
            <option value="private">Private sector</option>
            <option value="public">Public sector</option>
          </Select>
        </Field>
        <Field id="safety-classification" label="Work classification">
          <Select
            id="safety-classification"
            value={profile.classification}
            onChange={(e) =>
              patchProfile({
                classification: e.target
                  .value as SafetyProfile["classification"],
              })
            }
          >
            <option value="unknown">Unknown</option>
            <option value="operations_maintenance">
              Operations / maintenance
            </option>
            <option value="construction">Construction (unsupported)</option>
          </Select>
        </Field>
        <Field id="safety-task" label="Task category">
          <Select
            id="safety-task"
            value={job.task}
            onChange={(e) =>
              patchJob({ task: e.target.value as SafetyJob["task"] })
            }
          >
            <option value="electrical_maintenance">
              Electrical maintenance
            </option>
            <option value="construction">Construction (unsupported)</option>
            <option value="other">Other (unsupported)</option>
          </Select>
        </Field>
        <Field id="safety-energized" label="Energized status">
          <Select
            id="safety-energized"
            value={job.energized}
            onChange={(e) =>
              patchJob({ energized: e.target.value as SafetyJob["energized"] })
            }
          >
            <option value="unknown">Unknown — requires confirmation</option>
            <option value="energized">Energized</option>
            <option value="deenergized">Deenergized — verify controls</option>
          </Select>
        </Field>
        <Field id="safety-equipment" label="Equipment">
          <Input
            id="safety-equipment"
            maxLength={2000}
            value={job.equipment}
            onChange={(e) => patchJob({ equipment: e.target.value })}
          />
        </Field>
      </div>
      <Field id="safety-description" label="Planned task description">
        <textarea
          id="safety-description"
          className={styles.textarea}
          required
          maxLength={2000}
          value={job.description}
          onChange={(e) => patchJob({ description: e.target.value })}
        />
      </Field>
      <Field id="safety-conditions" label="Known conditions and unknowns">
        <textarea
          id="safety-conditions"
          className={styles.textarea}
          maxLength={2000}
          value={job.conditions}
          onChange={(e) => patchJob({ conditions: e.target.value })}
        />
      </Field>
      <Field
        id="safety-coverage"
        label="Coverage review notes (supervisors only)"
      >
        <textarea
          id="safety-coverage"
          className={styles.textarea}
          maxLength={2000}
          value={profile.coverage_notes ?? ""}
          onChange={(e) => patchProfile({ coverage_notes: e.target.value })}
        />
      </Field>
      <label className={styles.check}>
        <input
          type="checkbox"
          checked={profile.enabled}
          onChange={(e) => patchProfile({ enabled: e.target.checked })}
        />
        Enable safety drafts for this site
      </label>
      <div>
        <Button type="submit" disabled={disabled || !job.description}>
          Save work context
        </Button>
        {dirty ? (
          <span className={styles.muted}> Unsaved context changes</span>
        ) : null}
      </div>
    </form>
  );
}
function ReviewEditor({
  revision,
  evidence,
  disabled,
  onSave,
  onPublish,
}: {
  revision: Revision;
  evidence: Evidence[];
  disabled: boolean;
  onSave: (content: SafetyDraft) => Promise<boolean>;
  onPublish: () => Promise<boolean>;
}) {
  const [content, setContent] = useState(revision.content);
  const [dirty, setDirty] = useState(false);
  const patch = (change: Partial<SafetyDraft>) => {
    setContent((c) => ({ ...c, ...change }));
    setDirty(true);
  };
  return (
    <section className={styles.box} aria-label="Supervisor draft review">
      <h3>Supervisor draft review · Revision {revision.revision}</h3>
      <p className={styles.muted}>
        Select reviewed instructions for the worker checklist. Changes create a
        new revision. Task-specific operating instructions need an approved
        source; resolve gaps with the employee in charge.
      </p>
      {revision.content.supervisor_items.length ? (
        <>
          <h4>Supervisor follow-ups</h4>
          <Items items={revision.content.supervisor_items} />
          {revision.content.supervisor_items.map((item, i) => (
            <p key={i}>{item.explanation}</p>
          ))}
        </>
      ) : null}
      <Gaps gaps={content.coverage_gaps} />
      <h4>Approved evidence selections</h4>
      {evidence
        .filter((e) => e.audience === "crew" && !e.conflicts)
        .map((e) => {
          const selected = content.worker_items.some(
            (i) => i.evidence_ids[0] === e.id,
          );
          return (
            <label className={styles.check} key={e.id}>
              <input
                type="checkbox"
                checked={selected}
                disabled={disabled}
                onChange={() =>
                  patch({
                    worker_items: selected
                      ? content.worker_items.filter(
                          (i) => i.evidence_ids[0] !== e.id,
                        )
                      : [
                          ...content.worker_items,
                          {
                            type: e.kind,
                            task:
                              revision.content.worker_items[0]?.task ??
                              revision.content.supervisor_items[0]?.task ??
                              "electrical_maintenance",
                            text: e.instruction,
                            conditions: e.conditions,
                            explanation:
                              "Selected by supervisor from reviewed evidence.",
                            applicability: "supported",
                            evidence_ids: [e.id],
                          },
                        ],
                  })
                }
              />
              {e.instruction}
            </label>
          );
        })}
      <Field id="safety-admin-notes" label="Private review notes">
        <textarea
          id="safety-admin-notes"
          className={styles.textarea}
          maxLength={6000}
          value={content.admin_notes}
          onChange={(e) => patch({ admin_notes: e.target.value })}
        />
      </Field>
      <h4>Worker preview</h4>
      <Items items={content.worker_items} />
      <EvidenceDetails evidence={evidence} />
      <div className={styles.actions}>
        <Button
          disabled={disabled || !dirty}
          onClick={() => void onSave(content)}
        >
          Save reviewed revision
        </Button>
        <Button
          variant="primary"
          disabled={disabled || dirty}
          onClick={() => void onPublish()}
        >
          Publish safety checklist
        </Button>
        {dirty ? (
          <span className={styles.muted}>Save edits before publishing.</span>
        ) : null}
      </div>
    </section>
  );
}
