import { useEffect, useRef, type FormEvent } from "react";
import {
  Button,
  Field,
  Icon,
  Input,
  Panel,
  PanelHeader,
  RadioCard,
  SeverityMark,
} from "../../components/ui";
import {
  hazardLabels,
  severityLabels,
  type HazardType,
  type Severity,
} from "../../lib/types";
import type { ReportDraft } from "./types";
import styles from "./ReportForm.module.css";

type Props = {
  draft: ReportDraft;
  busy: boolean;
  className?: string;
  onChange: (patch: Partial<ReportDraft>) => void;
  onSubmit: () => void;
  onLocate: () => void;
};

const hazardTypes = Object.keys(hazardLabels) as HazardType[];
const severities: Severity[] = [1, 2, 3];

export function ReportForm({
  draft,
  busy,
  className,
  onChange,
  onSubmit,
  onLocate,
}: Props) {
  const fileInput = useRef<HTMLInputElement>(null);
  // Clear the native file input once a saved report resets the draft.
  useEffect(() => {
    if (!draft.file && fileInput.current) fileInput.current.value = "";
  }, [draft.file]);

  function submit(event: FormEvent) {
    event.preventDefault();
    onSubmit();
  }

  return (
    <Panel emphasis className={className} aria-labelledby="report-title">
      <PanelHeader
        titleId="report-title"
        title="Report a hazard"
        description="A quick update makes a safer site."
      />
      <form id="report-form" className={styles.form} onSubmit={submit}>
        <fieldset className={styles.group} disabled={busy}>
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
                <Icon name={type} size={24} />
                {hazardLabels[type]}
              </RadioCard>
            ))}
          </div>
        </fieldset>

        <fieldset className={styles.group} disabled={busy}>
          <legend className={styles.legend}>How severe is it?</legend>
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
                <span className={styles.levelTop}>
                  <SeverityMark severity={severity} size={16} />
                  <b className={styles.level}>{severity}</b>
                </span>{" "}
                <span>{severityLabels[severity]}</span>
              </RadioCard>
            ))}
          </div>
        </fieldset>

        <fieldset className={styles.group} disabled={busy}>
          <legend className={styles.legend}>Pin the location</legend>
          <Button
            id="locate"
            variant="secondary"
            block
            icon={<Icon name="locate" />}
            onClick={onLocate}
          >
            Use my location
          </Button>
          <p className={styles.help}>
            Or tap the site map, or enter coordinates.
          </p>
          <div className={styles.coordinates}>
            <Field id="latitude" label="Latitude">
              <Input
                mono
                id="latitude"
                name="latitude"
                type="number"
                step="any"
                min={-90}
                max={90}
                required
                value={draft.latitude}
                onChange={(event) => onChange({ latitude: event.target.value })}
              />
            </Field>
            <Field id="longitude" label="Longitude">
              <Input
                mono
                id="longitude"
                name="longitude"
                type="number"
                step="any"
                min={-180}
                max={180}
                required
                value={draft.longitude}
                onChange={(event) =>
                  onChange({ longitude: event.target.value })
                }
              />
            </Field>
          </div>
        </fieldset>

        <fieldset className={styles.group} disabled={busy}>
          <legend className={styles.legend}>
            Add a photo <span className={styles.optional}>(optional)</span>
          </legend>
          <label className={styles.upload} htmlFor="photo">
            <Icon name="upload" size={24} />
            <span className={styles.uploadText}>
              <strong id="photo-name">
                {draft.file?.name ?? "Choose a photo"}
              </strong>
              <span>JPEG, PNG or WebP, up to 5 MB</span>
            </span>
            <input
              ref={fileInput}
              id="photo"
              name="photo"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className={styles.fileInput}
              onChange={(event) => onChange({ file: event.target.files?.[0] })}
            />
          </label>
        </fieldset>

        <p className={styles.merge}>
          Same hazard nearby? We’ll merge your report and add a confirmation.
        </p>

        {/* Stays in view while the form scrolls, so submitting never needs a hunt. */}
        <div className={styles.actions}>
          <Button
            id="submit-report"
            type="submit"
            variant="primary"
            block
            busy={busy}
            icon={<Icon name="arrow-right" />}
          >
            {busy ? "Saving report…" : "Submit hazard report"}
          </Button>
        </div>
      </form>
    </Panel>
  );
}
