import { useEffect, useMemo, useState } from "react";
import {
  Button,
  Field,
  Input,
  Panel,
  PanelHeader,
  Select,
  Segmented,
} from "../../components/ui";
import { useNotice } from "../../hooks/notice";
import { errorMessage } from "../../lib/format";
import {
  pushAudience,
  sendPush,
  waitForPush,
  type PushTarget,
} from "../../lib/monitoring";
import { hazardLabels, type Report } from "../../lib/types";
import styles from "./Dashboard.module.css";

type Mode = "all" | "selected" | "near";

type Props = {
  siteId: string;
  selected: Set<string>;
  reports: Report[];
};

export function PushComposer({ siteId, selected, reports }: Props) {
  const { announce } = useNotice();
  const [mode, setMode] = useState<Mode>("all");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [hazardId, setHazardId] = useState("");
  const [radius, setRadius] = useState("500");
  const [sending, setSending] = useState(false);
  const [audience, setAudience] = useState<{
    targeted: number;
    reachable: number;
  }>();

  const open = useMemo(() => reports.filter((r) => r.is_active), [reports]);
  const hazard = open.find((r) => r.id === hazardId) ?? open[0];
  const target = useMemo<PushTarget | undefined>(() => {
    if (mode === "all") return { mode: "all" };
    if (mode === "selected")
      return selected.size
        ? { mode: "users", user_ids: [...selected] }
        : undefined;
    const meters = Number(radius);
    if (!hazard || !(meters >= 50 && meters <= 100000)) return undefined;
    return {
      mode: "near",
      lat: hazard.latitude,
      lon: hazard.longitude,
      radius_m: meters,
    };
  }, [mode, selected, hazard, radius]);

  useEffect(() => {
    setAudience(undefined);
    if (!target) return;
    let cancelled = false;
    const load = () =>
      pushAudience(siteId, target)
        .then((result) => !cancelled && setAudience(result))
        .catch(() => undefined);
    const timer = setTimeout(() => void load(), 300);
    // Workers can turn notifications on while the composer is open.
    const interval = setInterval(() => void load(), 20000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      clearInterval(interval);
    };
  }, [siteId, target]);

  async function send() {
    if (!target || sending) return;
    setSending(true);
    try {
      const id = await sendPush(siteId, title.trim(), body.trim(), target);
      setTitle("");
      setBody("");
      announce("Sending…");
      const outcome = await waitForPush(id);
      if (!outcome) announce("Still sending. Check back in a minute.", false);
      else if (outcome.status === "failed")
        announce("The push couldn’t be sent. Try again.", true);
      else if (outcome.recipients === 0)
        announce(
          "No devices to notify. No one in this group has notifications on.",
          true,
        );
      else
        announce(
          `Delivered to ${outcome.delivered} of ${outcome.recipients} devices` +
            (outcome.failed
              ? `. ${outcome.failed} were unreachable and have been removed. Those workers need to turn notifications on again.`
              : ". If a phone shows nothing, check its notification settings."),
          outcome.delivered === 0,
        );
    } catch (error) {
      announce(errorMessage(error), true);
    } finally {
      setSending(false);
    }
  }

  const blocker = !target
    ? mode === "selected"
      ? "Tick at least one worker in the crew list."
      : mode === "near"
        ? "Choose a hazard and a radius of 50 to 100000 metres."
        : ""
    : !title.trim()
      ? "Add a title."
      : !body.trim()
        ? "Add a message."
        : audience?.reachable === 0
          ? "No one in this group has notifications on."
          : "";
  const ready =
    Boolean(target) && title.trim().length > 0 && body.trim().length > 0;
  return (
    <Panel id="push" aria-labelledby="push-title">
      <PanelHeader
        titleId="push-title"
        title="Send a push"
        description="Reaches workers who turned on notifications."
      />
      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <Segmented
          label="Who gets it"
          name="push-target"
          value={mode}
          options={[
            { value: "all", label: "Everyone" },
            { value: "selected", label: `Selected (${selected.size})` },
            { value: "near", label: "Near a hazard" },
          ]}
          onChange={setMode}
        />
        {mode === "near" ? (
          open.length ? (
            <div className={styles.row}>
              <Field id="push-hazard" label="Hazard">
                <Select
                  id="push-hazard"
                  value={hazard?.id ?? ""}
                  onChange={(event) => setHazardId(event.target.value)}
                >
                  {open.map((r) => (
                    <option key={r.id} value={r.id}>
                      {hazardLabels[r.type]} · severity {r.severity}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field id="push-radius" label="Within (metres)">
                <Input
                  id="push-radius"
                  mono
                  inputMode="numeric"
                  value={radius}
                  onChange={(event) => setRadius(event.target.value)}
                />
              </Field>
            </div>
          ) : (
            <p className={styles.muted}>No open hazards to centre on.</p>
          )
        ) : null}
        {mode === "selected" && !selected.size ? (
          <p className={styles.muted}>Tick workers in the crew list first.</p>
        ) : null}
        <Field id="push-title-input" label="Title">
          <Input
            id="push-title-input"
            maxLength={120}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </Field>
        <Field id="push-body" label="Message">
          <textarea
            id="push-body"
            className={styles.textarea}
            maxLength={400}
            value={body}
            onChange={(event) => setBody(event.target.value)}
          />
        </Field>
        <p className={styles.audience} id="push-audience">
          {audience
            ? `${audience.reachable} of ${audience.targeted} targeted workers can receive pushes.`
            : target
              ? "Checking who can receive it…"
              : ""}
        </p>
        <div className={styles.row}>
          <Button
            type="submit"
            variant="primary"
            busy={sending}
            disabled={Boolean(blocker) || !ready}
            aria-describedby="push-blocker"
          >
            Send push
          </Button>
          <span id="push-blocker" className={styles.muted}>
            {blocker}
          </span>
        </div>
      </form>
    </Panel>
  );
}
