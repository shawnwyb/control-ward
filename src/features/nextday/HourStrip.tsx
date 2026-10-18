import { SeverityMark } from "../../components/ui";
import type { Severity } from "../../lib/types";
import { formatHour, type BandId } from "../../lib/nextDayReport";
import styles from "./NextDayReport.module.css";

export type StripCell = {
  hour: number;
  value: string;
  /** Spoken description, for example "3 PM, heat index 104 F, Danger". */
  label: string;
  band?: BandId | null;
  mark?: Severity | null;
  peak?: boolean;
  blocked?: boolean;
};

/** One cell per hour. Colour is never the only cue: each cell has a number and, above caution, a severity shape. */
export function HourStrip({
  cells,
  caption,
}: {
  cells: StripCell[];
  caption: string;
}) {
  return (
    <ol className={styles.strip} aria-label={caption}>
      {cells.map((c) => (
        <li
          key={c.hour}
          className={styles.cell}
          data-band={c.band ?? undefined}
          data-peak={c.peak ? "true" : undefined}
          data-blocked={c.blocked ? "true" : undefined}
          aria-label={c.label}
          title={c.label}
        >
          <span>{formatHour(c.hour)}</span>
          <b>{c.value}</b>
          {c.mark ? (
            <SeverityMark severity={c.mark} size={14} />
          ) : (
            <span aria-hidden="true">&nbsp;</span>
          )}
        </li>
      ))}
    </ol>
  );
}
