import {
  useEffect,
  useId,
  type Ref,
  useRef,
  useState,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { Button, Icon, RadioCard, SeverityMark, cx } from "../../components/ui";
import {
  hazardLabels,
  severityLabels,
  type HazardType,
  type Severity,
} from "../../lib/types";
import type { ReportDraft } from "./types";
import styles from "./ReportDrawer.module.css";

export type Locating = "idle" | "pending" | "denied";

type Props = {
  open: boolean;
  /** Only used for the drawer's accessible context; the pin itself lives on the map. */
  site: { name: string };
  draft: ReportDraft;
  busy: boolean;
  locating: Locating;
  /** Accuracy of the location fix, in feet (shown in the hint when known). */
  accuracyFt?: number;
  onChange: (patch: Partial<ReportDraft>) => void;
  onSubmit: () => void;
  onClose: () => void;
};

const hazardTypes = Object.keys(hazardLabels) as HazardType[];
const severities: Severity[] = [1, 2, 3];
const tabbable =
  'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

function hint(locating: Locating, accuracyFt?: number) {
  if (locating === "denied")
    return "Couldn't get your location. Click the map to place the pin.";
  if (locating === "pending") return "Finding your location…";
  return accuracyFt === undefined
    ? "Click the map to move the pin."
    : `Pinned at your location · ±${accuracyFt} ft · click map to move`;
}

/**
 * Report a hazard: a panel over the right of the map (a bottom sheet on phones). The map
 * stays usable beside it, so it is a non-modal dialog; focus is kept inside while open.
 */
export function ReportDrawer({
  open,
  site,
  draft,
  busy,
  locating,
  accuracyFt,
  onChange,
  onSubmit,
  onClose,
}: Props) {
  const root = useRef<HTMLElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const titleId = useId();

  // Move focus in when it opens; Escape closes it from anywhere.
  useEffect(() => {
    if (!open) return;
    title.current?.focus();
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Clear the native file input once the draft's file is gone (sent, removed, site changed).
  useEffect(() => {
    if (!draft.file && fileInput.current) fileInput.current.value = "";
  }, [draft.file]);

  function trap(event: KeyboardEvent) {
    if (event.key !== "Tab" || !root.current) return;
    const items = [...root.current.querySelectorAll<HTMLElement>(tabbable)];
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === title.current)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    onSubmit();
  }

  function drop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    if (busy) return;
    const file = event.dataTransfer.files[0];
    if (file) onChange({ file });
  }

  return (
    <aside
      ref={root}
      id="report-drawer"
      role="dialog"
      aria-labelledby={titleId}
      aria-describedby={`${titleId}-hint`}
      className={styles.drawer}
      data-open={open || undefined}
      inert={!open}
      onKeyDown={trap}
    >
      <header className={styles.head}>
        <h2 id={titleId} ref={title} tabIndex={-1} className={styles.title}>
          Report a hazard
        </h2>
        <button
          type="button"
          className={styles.close}
          aria-label="Close"
          onClick={onClose}
        >
          <Icon name="close" size={18} />
        </button>
      </header>
      <p id={`${titleId}-hint`} className={styles.hint} aria-live="polite">
        <span
          className={cx(styles.dot, locating === "denied" && styles.warn)}
        />
        {hint(locating, accuracyFt)}
        <span className={styles.siteName}> {site.name}</span>
      </p>
      <form id="report-form" className={styles.form} onSubmit={submit}>
        <fieldset className={styles.group} disabled={busy} role="radiogroup">
          <legend className={styles.legend}>What did you spot?</legend>
          <div className={styles.types}>
            {hazardTypes.map((type) => (
              <RadioCard
                key={type}
                name="type"
                value={type}
                checked={draft.type === type}
                onChange={() => onChange({ type })}
              >
                <Icon name={type} size={22} />
                {hazardLabels[type]}
              </RadioCard>
            ))}
          </div>
        </fieldset>

        <fieldset className={styles.group} disabled={busy} role="radiogroup">
          <legend className={styles.legend}>How bad is it?</legend>
          <div className={styles.severities}>
            {severities.map((severity) => (
              <RadioCard
                key={severity}
                variant="segment"
                tone={severity}
                name="severity"
                value={severity}
                checked={draft.severity === severity}
                onChange={() => onChange({ severity })}
              >
                <span className={styles.level}>
                  <SeverityMark severity={severity} size={14} />
                  {severityLabels[severity]}
                </span>
              </RadioCard>
            ))}
          </div>
        </fieldset>

        <div
          className={cx(styles.drop, dragging && styles.dragging)}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={drop}
        >
          <label className={styles.pick}>
            <Icon name="upload" size={20} />
            <span className={styles.pickText}>
              {draft.file ? (
                <strong className={styles.fileName}>{draft.file.name}</strong>
              ) : (
                <>
                  <strong>Add photo</strong>{" "}
                  <span className={styles.optional}>(optional)</span>
                </>
              )}
            </span>
            <input
              ref={fileInput}
              id="photo"
              name="photo"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className={styles.fileInput}
              disabled={busy}
              onChange={(event) => onChange({ file: event.target.files?.[0] })}
            />
          </label>
          {draft.file ? (
            <button
              type="button"
              className={styles.remove}
              disabled={busy}
              aria-label={`Remove ${draft.file.name}`}
              onClick={() => onChange({ file: undefined })}
            >
              <Icon name="close" size={16} />
            </button>
          ) : (
            <span className={styles.limits}>
              Drop or click · JPEG, PNG or WebP, up to 5 MB
            </span>
          )}
        </div>

        <Button
          id="submit-report"
          type="submit"
          variant="primary"
          block
          busy={busy}
        >
          {busy ? "Sending…" : "Send report"}
        </Button>
      </form>
    </aside>
  );
}

/** The dark floating button at the bottom right of the map that opens the drawer. */
export function ReportButton({
  ref,
  hidden,
  onClick,
}: {
  ref?: Ref<HTMLButtonElement>;
  /** Out of sight (and out of the tab order) while the drawer is open. */
  hidden: boolean;
  onClick: () => void;
}) {
  return (
    <button
      ref={ref}
      type="button"
      className={styles.launch}
      data-hidden={hidden || undefined}
      inert={hidden}
      onClick={onClick}
    >
      <Icon name="alert" size={18} />
      Report hazard
    </button>
  );
}
