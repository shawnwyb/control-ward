import type { NextDayReport } from "../../lib/nextDayReport";
import { AboutData } from "./AboutData";
import styles from "./NextDayReport.module.css";

const WORD: Record<string, string> = {
  missing: "Missing",
  stale: "Out of date",
  not_applicable: "Not applicable",
  ok: "Note",
};

/** A titled group of notes. Nothing renders when the group is empty. */
function Group({
  title,
  items,
}: {
  title: string;
  items: (string | null | undefined)[];
}) {
  const shown = items.filter((i): i is string => Boolean(i));
  if (!shown.length) return null;
  return (
    <>
      <h3 className={styles.sub}>{title}</h3>
      <ul className={styles.list}>
        {shown.map((c) => (
          <li key={c} className={styles.muted}>
            {c}
          </li>
        ))}
      </ul>
    </>
  );
}

/**
 * Every missing, old or not-applicable input with its reason (nothing is dropped silently), the limits that always
 * apply, and the model and data notes that used to sit in an "About" fold on each card. One fold, closed on screen,
 * open when the page prints.
 */
export function DisclaimerFooter({ report }: { report: NextDayReport }) {
  const { mud, heat, wildlife, routing, air, gaps } = report;
  const defaultEq = mud.equipment?.find((e) => e.key === mud.default_equipment);
  const counts = mud.segment_counts;
  return (
    <section id="gaps" aria-label="Model and data disclaimers">
      <AboutData
        label="Model and data disclaimers (mud model, heat bands, NOAA, OSHA, National Weather Service)"
        className={styles.footer}
      >
        <h3 className={styles.sub} style={{ marginTop: 0 }}>
          Data gaps
        </h3>
        {gaps.length ? (
          <ul className={styles.plain}>
            {gaps.map((g) => (
              <li key={`${g.section}-${g.reason}`}>
                <strong>
                  {WORD[g.status] ?? g.status}:{" "}
                  {g.section.replace(".", " / ").replace("_", " ")}.
                </strong>{" "}
                {g.reason}
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.muted}>Every input was available.</p>
        )}

        <h3 className={styles.sub}>Limits that always apply</h3>
        <ul className={styles.list}>
          {report.limits.map((l) => (
            <li key={l} className={styles.muted}>
              {l}
            </li>
          ))}
        </ul>

        <Group
          title="Mud ratings"
          items={[
            ...(mud.caveats ?? []).slice(1),
            counts && defaultEq
              ? `For ${defaultEq.label.split(":")[0].toLowerCase()}, ${counts.hold} segments are at hold, ${counts.inspect} at inspect and ${counts.ok} are ok.`
              : null,
            mud.horizon
              ? `Soil moisture ${mud.horizon.soil_moisture}, forecast rain ${mud.horizon.rain_in.toFixed(1)} in.`
              : null,
          ]}
        />
        <Group
          title="Heat"
          items={[
            ...(heat.notes ?? []),
            heat.source
              ? `Bands: ${heat.source.table}, ${heat.source.url}, retrieved ${heat.source.retrieved}. Water and rest advice follows OSHA: ${heat.source.osha.join(", ")}.`
              : null,
          ]}
        />
        <Group
          title="Wildlife"
          items={[
            (wildlife?.caveats ?? [])[0],
            (wildlife?.caveats ?? [])[2],
            wildlife?.source
              ? `Source: ${wildlife.source.name}. ${wildlife.source.note}`
              : null,
          ]}
        />
        <Group
          title="Roads and detours"
          items={(routing?.caveats ?? []).slice(0, -1)}
        />
        <Group title="Air quality" items={air.notes ?? []} />
      </AboutData>
    </section>
  );
}
