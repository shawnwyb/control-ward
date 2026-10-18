import { Badge, Panel, PanelHeader } from "../../components/ui";
import {
  formatLocalClock,
  type LeveeSection,
  type NextDayReport,
  type RiverSection,
  type TideSection,
} from "../../lib/nextDayReport";
import { Abbr } from "./Abbr";
import { AboutData } from "./AboutData";
import styles from "./NextDayReport.module.css";

const FT_PER_M = 3.28084;

function River({ river }: { river: RiverSection }) {
  if (river.status !== "ok" || !river.gauge)
    return (
      <p className={styles.muted}>{river.reason ?? "No river gauge data."}</p>
    );
  const u = river.stage_unit ?? "ft";
  const t = river.thresholds ?? {};
  return (
    <>
      <p>
        <a href={river.gauge.url}>{river.gauge.name}</a> ({river.gauge.lid}),{" "}
        {river.gauge.distance_km} km from the site.
        {river.observed ? (
          <>
            {" "}
            Now {river.observed.stage} {u},{" "}
            {river.observed.category.replace("_", " ")}
            {river.observed.trend ? `, ${river.observed.trend}` : ""}
            {river.observed.change_6h !== null
              ? ` (${river.observed.change_6h > 0 ? "+" : ""}${river.observed.change_6h} ${u} in 6 hours)`
              : ""}
            .
          </>
        ) : null}
      </p>
      {river.forecast ? (
        <p>
          <strong>
            Forecast crest {river.forecast.crest.stage} {u}
          </strong>{" "}
          (
          {river.forecast.crest.category === "none"
            ? "below flood stage"
            : `${river.forecast.crest.category} flood stage`}
          ) on{" "}
          {new Date(river.forecast.crest.time).toLocaleString(undefined, {
            weekday: "short",
            hour: "numeric",
            minute: "2-digit",
            timeZone: "UTC",
          })}{" "}
          UTC.
          {river.forecast.report_day_max
            ? ` Highest on the report day: ${river.forecast.report_day_max.stage} ${u}.`
            : ""}
        </p>
      ) : (
        <p className={styles.muted}>{river.forecast_note}</p>
      )}
      <p className={styles.small}>
        Flood stages at this gauge:{" "}
        {(["action", "minor", "moderate", "major"] as const)
          .filter((k) => t[k] !== undefined)
          .map((k) => `${k} ${t[k]} ${u}`)
          .join(", ")}
        . {(river.caveats ?? []).join(" ")}
      </p>
    </>
  );
}

function Levees({ levees }: { levees: LeveeSection }) {
  if (levees.status !== "ok")
    return <p className={styles.muted}>{levees.reason ?? "No levee data."}</p>;
  return (
    <>
      <p>
        {levees.inside_leveed_area ? (
          <strong>The site is inside a mapped leveed area. </strong>
        ) : (
          <>Not inside a mapped leveed area. </>
        )}
        {levees.nearest_levee_km !== null &&
        levees.nearest_levee_km !== undefined ? (
          <>Nearest levee or floodwall: {levees.nearest_levee_km} km. </>
        ) : null}
        {levees.closure_structures ? (
          <>{levees.closure_structures} closure structure(s) and </>
        ) : null}
        {levees.pump_stations ? (
          <>{levees.pump_stations} pump station(s) are mapped nearby.</>
        ) : null}
      </p>
      <ul className={styles.plain}>
        {(levees.systems ?? []).map((s) => (
          <li key={s.id}>
            <strong>{s.name ?? `System ${s.id}`}</strong>{" "}
            {s.inside ? (
              <Badge>site inside</Badge>
            ) : s.nearest_km !== null ? (
              <Badge>{s.nearest_km} km</Badge>
            ) : null}
            <div className={styles.muted}>
              USACE inspection rating: {s.inspection_rating ?? "unknown"}
              {s.fema_accreditation ? ` · FEMA: ${s.fema_accreditation}` : ""}
              {s.flood_sources ? ` · flood sources: ${s.flood_sources}` : ""}
              {s.warning_system ? ` · warning system: ${s.warning_system}` : ""}
            </div>
          </li>
        ))}
      </ul>
      <ul className={styles.list}>
        {[(levees.caveats ?? [])[0], (levees.caveats ?? []).at(-1)]
          .filter((c, i, all) => c && all.indexOf(c) === i)
          .map((c) => (
            <li key={c} className={styles.muted}>
              {c}
            </li>
          ))}
      </ul>
      <AboutData label="About the levee data">
        <ul className={styles.list}>
          {(levees.caveats ?? []).slice(1, -1).map((c) => (
            <li key={c} className={styles.muted}>
              {c}
            </li>
          ))}
        </ul>
        <p className={styles.small}>
          Source: <a href={levees.source?.url}>{levees.source?.name}</a>.
        </p>
      </AboutData>
    </>
  );
}

function Tide({ tide }: { tide: TideSection }) {
  if (tide.status !== "ok" || !tide.events)
    return <p className={styles.muted}>{tide.reason ?? "No tide data."}</p>;
  const day = (t: string) => t.slice(0, 10);
  const forDay =
    tide.rising?.[0]?.start.slice(0, 10) ?? tide.events[0].t.slice(0, 10);
  const events = tide.events.filter((e) => day(e.t) === forDay);
  return (
    <>
      <p>
        Station <a href={tide.station?.url}>{tide.station?.name}</a>,{" "}
        {tide.station?.distance_km} km from the site. Times are local to the
        station.
        {tide.highest ? (
          <>
            {" "}
            <strong>
              Highest tide {formatLocalClock(tide.highest.t)}:{" "}
              {tide.highest.ft_mllw} ft above{" "}
              <Abbr long="mean lower low water: the average of the lowest tide each day">
                MLLW
              </Abbr>
              {tide.highest.m_navd88 !== null ? (
                <>
                  {" "}
                  ({(tide.highest.m_navd88 * FT_PER_M).toFixed(1)} ft against{" "}
                  <Abbr long="North American Vertical Datum of 1988: the land-height reference the ground model uses">
                    NAVD88
                  </Abbr>
                  , the land-height reference)
                </>
              ) : null}
              .
            </strong>
          </>
        ) : null}
      </p>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <caption className={styles.small}>
            High and low tides on the report day. MLLW is mean lower low water,
            the average of the lowest tide each day.
          </caption>
          <thead>
            <tr>
              <th scope="col">Time</th>
              <th scope="col">Tide</th>
              <th scope="col">Height above MLLW (ft)</th>
            </tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.t}>
                <td>{formatLocalClock(e.t)}</td>
                <td>{e.type === "H" ? "High" : "Low"}</td>
                <td>{e.ft_mllw}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>
        <strong>Water is rising:</strong>{" "}
        {tide.rising?.length
          ? tide.rising
              .map(
                (w) =>
                  `${formatLocalClock(w.start)} to ${formatLocalClock(w.end)}`,
              )
              .join("; ")
          : "not on this day"}
        .
      </p>
      <p>
        <strong>Within one hour of high water:</strong>{" "}
        {tide.near_high?.length
          ? tide.near_high
              .map(
                (w) =>
                  `${formatLocalClock(w.start)} to ${formatLocalClock(w.end)}`,
              )
              .join("; ")
          : "none on this day"}
        .
      </p>
      <ul className={styles.list}>
        {(tide.caveats ?? []).map((c) => (
          <li key={c} className={styles.muted}>
            {c}
          </li>
        ))}
        {tide.shading_reason ? (
          <li className={styles.muted}>
            No flood shading: {tide.shading_reason}
          </li>
        ) : null}
      </ul>
    </>
  );
}

export function FloodPanel({ report }: { report: NextDayReport }) {
  const { river, levees, tide } = report.flood;
  return (
    <Panel id="flood" aria-labelledby="flood-title">
      <PanelHeader
        title="Flood: river, levees and tide"
        titleId="flood-title"
        description="Forecast water levels near the site. A forecast is not a guarantee, and a levee is not a guarantee."
      />
      <h3 className={styles.sub} style={{ marginTop: 0 }}>
        River
      </h3>
      <River river={river} />
      <h3 className={styles.sub}>Levees (National Levee Database)</h3>
      <Levees levees={levees} />
      <h3 className={styles.sub}>Tide</h3>
      <Tide tide={tide} />
    </Panel>
  );
}
