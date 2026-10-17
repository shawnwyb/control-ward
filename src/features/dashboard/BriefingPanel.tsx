import { useEffect, useState } from "react";
import { Badge, Button, Panel, PanelHeader } from "../../components/ui";
import { useNotice } from "../../hooks/notice";
import { useLive } from "../../hooks/useLive";
import { errorMessage } from "../../lib/format";
import {
  fetchBriefingDraft,
  requestBriefingDraft,
  saveBriefingDraft,
  sendBriefing,
  type BriefingContent,
  type BriefingDraft,
  type PlanHour,
} from "../../lib/monitoring";
import styles from "./Dashboard.module.css";

/** Spells out which hours are blocked and why, since the grid only shows a colour and "no". */
function BlockedHours({ hours }: { hours: PlanHour[] }) {
  const runs: string[] = [];
  let i = 5;
  while (i <= 20) {
    if (hours[i]?.safe !== false) {
      i++;
      continue;
    }
    const start = i;
    const why = new Set<string>();
    while (i <= 20 && hours[i]?.safe === false) {
      hours[i].blocked_by.forEach((reason) => why.add(reason));
      i++;
    }
    const pad = (h: number) => String(h).padStart(2, "0");
    runs.push(`${pad(start)}:00 to ${pad(i)}:00 · ${[...why].join(", ")}`);
  }
  return runs.length ? (
    <p className={styles.muted}>Blocked hours: {runs.join("; ")}.</p>
  ) : null;
}

export function BriefingPanel({ siteId }: { siteId: string }) {
  const { announce } = useNotice();
  const {
    data: draft,
    loaded,
    refresh,
  } = useLive<BriefingDraft | null>(
    siteId,
    ["briefing_drafts"],
    fetchBriefingDraft,
    null,
    5000,
    (message) => announce(message, true),
  );
  const [edit, setEdit] = useState<BriefingContent>();
  const [dirty, setDirty] = useState(false);
  const [working, setWorking] = useState(false);

  // Take the server copy unless the supervisor is mid-edit.
  useEffect(() => {
    if (draft && draft.status !== "generating" && !dirty)
      setEdit(draft.content);
  }, [draft, dirty]);

  async function act(task: () => Promise<void>, done: string) {
    setWorking(true);
    try {
      await task();
      announce(done);
      await refresh();
    } catch (error) {
      announce(errorMessage(error), true);
    } finally {
      setWorking(false);
    }
  }

  const patch = (changes: Partial<BriefingContent>) => {
    setEdit((current) => (current ? { ...current, ...changes } : current));
    setDirty(true);
  };
  const setWindow = (key: "start" | "end", value: string) =>
    patch({
      work_window: {
        start: edit?.work_window?.start ?? "07:00",
        end: edit?.work_window?.end ?? "15:00",
        [key]: value,
      },
    });

  const sent = draft?.status === "sent";
  const generating = draft?.status === "generating";
  return (
    <Panel id="plan" aria-labelledby="briefing-title">
      <PanelHeader
        titleId="briefing-title"
        title={draft ? `Plan for ${draft.for_date}` : "Next-day plan"}
        description="Suggested working hours from the hourly forecast around the site, plus traffic, school and wildlife context. Review before it goes to the crew."
        aside={
          draft?.source ? (
            <Badge>
              {draft.source === "gemini" ? "AI-assisted" : "Forecast rules"}
            </Badge>
          ) : null
        }
      />
      {!draft && loaded ? (
        <p className={styles.muted}>
          No plan yet. Plans are drafted at 6 PM local time, or you can draft
          one now.
        </p>
      ) : null}
      {generating ? (
        <p className={styles.muted} role="status">
          Drafting the plan… this takes about a minute.
        </p>
      ) : null}
      {edit && draft && !generating ? (
        <div className={styles.plan} id="briefing-plan">
          <div className={styles.window}>
            <strong>Work window</strong>
            <input
              type="time"
              aria-label="Work window start"
              value={edit.work_window?.start ?? ""}
              disabled={sent}
              onChange={(event) => setWindow("start", event.target.value)}
            />
            <span aria-hidden="true">to</span>
            <input
              type="time"
              aria-label="Work window end"
              value={edit.work_window?.end ?? ""}
              disabled={sent}
              onChange={(event) => setWindow("end", event.target.value)}
            />
            {!edit.work_window ? (
              <span className={styles.muted}>No safe window found</span>
            ) : null}
          </div>
          {edit.hourly ? (
            <ol className={styles.hours} aria-label="Hourly outlook">
              {edit.hourly
                .filter((h) => h.hour >= 5 && h.hour <= 20)
                .map((h) => (
                  <li
                    key={h.hour}
                    className={`${styles.hour} ${h.safe ? "" : styles.blocked}`}
                    title={
                      h.safe ? "Clear" : `Blocked: ${h.blocked_by.join(", ")}`
                    }
                  >
                    {String(h.hour).padStart(2, "0")}
                    <small>{h.safe ? "ok" : "no"}</small>
                  </li>
                ))}
            </ol>
          ) : null}
          {edit.hourly ? <BlockedHours hours={edit.hourly} /> : null}
          <label>
            <span className={styles.scoreLabel}>Summary for the crew</span>
            <textarea
              className={styles.textarea}
              value={edit.summary}
              maxLength={400}
              disabled={sent}
              onChange={(event) => patch({ summary: event.target.value })}
            />
          </label>
          {edit.reasons.length ? (
            <ul className={styles.muted}>
              {edit.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          ) : null}
          <div className={styles.contextGrid}>
            {(
              [
                ["traffic", "Traffic"],
                ["school", "Schools"],
                ["wildlife", "Wildlife"],
              ] as const
            ).map(([key, label]) =>
              edit.context[key] ? (
                <div key={key}>
                  <h3>{label}</h3>
                  <p>{edit.context[key]}</p>
                </div>
              ) : null,
            )}
          </div>
          {edit.ai_note ? <p className={styles.muted}>{edit.ai_note}</p> : null}
          {edit.neighbors?.length ? (
            <p className={styles.muted}>
              Nearby sites:{" "}
              {edit.neighbors
                .slice(0, 4)
                .map(
                  (n) =>
                    `${n.name} (${n.distance_km} km, risk ${n.risk_tomorrow ?? "—"})`,
                )
                .join(" · ")}
            </p>
          ) : null}
        </div>
      ) : null}
      <div className={styles.row} style={{ marginTop: "var(--space-4)" }}>
        {!sent ? (
          <Button
            busy={working || generating}
            onClick={() =>
              void act(async () => {
                setDirty(false);
                await requestBriefingDraft(siteId);
              }, "Drafting started.")
            }
          >
            {draft ? "Redraft" : "Draft now"}
          </Button>
        ) : null}
        {draft && !generating && !sent ? (
          <>
            <Button
              disabled={!dirty}
              busy={working}
              onClick={() =>
                void act(async () => {
                  await saveBriefingDraft(siteId, draft.for_date, edit!);
                  setDirty(false);
                }, "Draft saved.")
              }
            >
              Save edits
            </Button>
            <Button
              variant="primary"
              busy={working}
              onClick={() =>
                void act(async () => {
                  if (dirty)
                    await saveBriefingDraft(siteId, draft.for_date, edit!);
                  await sendBriefing(siteId, draft.for_date);
                  setDirty(false);
                }, "Plan sent to the crew.")
              }
            >
              Approve and send to crew
            </Button>
          </>
        ) : null}
        {sent ? (
          <Badge>
            Sent to crew{" "}
            {draft?.sent_at
              ? new Date(draft.sent_at).toLocaleTimeString([], {
                  hour: "numeric",
                  minute: "2-digit",
                })
              : ""}
          </Badge>
        ) : null}
      </div>
    </Panel>
  );
}
