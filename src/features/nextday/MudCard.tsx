import {
  Badge,
  iconMarkup,
  Panel,
  PanelHeader,
  SeverityTag,
  StatusTag,
} from "../../components/ui";
import type { NextDayReport } from "../../lib/nextDayReport";
import { FLAG_WORD, mudShare, polylineSlice, type Pt } from "./briefing";
import {
  maxPredictedRut,
  type FlaggedRoute,
  type RouteFeature,
} from "./routesList";
import styles from "./NextDayReport.module.css";

const FEET_PER_MILE = 5280;
const mi = (ft: number) => (ft / FEET_PER_MILE).toFixed(1);

/** A rising line, as in the Mud trafficability art in docs/presentation-plan/presentation.html, redrawn for a 460 x 150 box. */
const SLOPE: Pt[] = [
  [24, 128],
  [104, 98],
  [174, 112],
  [244, 68],
  [314, 82],
  [374, 42],
  [436, 20],
];

const pointsAttr = (pts: Pt[]) => pts.map((p) => p.join(",")).join(" ");

/**
 * The slope divides into ok, inspect and hold by their share of the rated route length. The truck marks the
 * equipment class the rating is for. It does not mark a place on the slope.
 */
function Slope({
  share,
  summary,
}: {
  share: NonNullable<ReturnType<typeof mudShare>>;
  summary: string;
}) {
  const parts = [
    { key: "ok", ft: share.okFt, className: styles.slopeOk },
    { key: "inspect", ft: share.inspectFt, className: styles.slopeInspect },
    { key: "hold", ft: share.holdFt, className: styles.slopeHold },
  ];
  let t = 0;
  return (
    <svg
      className={styles.slope}
      viewBox="0 0 460 150"
      role="img"
      aria-label={summary}
    >
      <polyline points={pointsAttr(SLOPE)} className={styles.slopeTrack} />
      {parts.map((p) => {
        const from = t;
        t += p.ft / share.totalFt;
        return p.ft > 0 ? (
          <polyline
            key={p.key}
            points={pointsAttr(polylineSlice(SLOPE, from, t))}
            className={p.className}
          />
        ) : null;
      })}
      <g
        className={styles.truck}
        transform="translate(2 84)"
        dangerouslySetInnerHTML={{ __html: iconMarkup("truck", 34) }}
      />
    </svg>
  );
}

export function MudCard({
  report,
  equipment,
  pieces,
  flagged,
}: {
  report: NextDayReport;
  equipment: string;
  /** Route pieces from mud_routes.geojson, or null until the file loads. */
  pieces: RouteFeature[] | null;
  flagged: FlaggedRoute[] | null;
}) {
  const mud = report.mud;
  const eq =
    mud.equipment?.find((e) => e.key === equipment) ?? mud.equipment?.[0];
  if (!eq || mud.status === "missing" || mud.status === "not_applicable")
    return (
      <Panel id="mud" className={styles.heroCard} aria-labelledby="mud-title">
        <PanelHeader title="Mud trafficability" titleId="mud-title" />
        <p className={styles.muted}>
          {mud.reason ?? "No mud rating for this site and day."}
        </p>
      </Panel>
    );
  const share = mudShare(eq, pieces, eq.key);
  const rut = flagged ? maxPredictedRut(flagged) : null;
  const name = eq.label.split(":")[0];
  const summary = share
    ? `Rated route length for ${name}: ${mi(share.okFt)} miles ok, ${mi(share.inspectFt)} inspect, ${mi(share.holdFt)} hold.`
    : "";
  return (
    <Panel id="mud" className={styles.heroCard} aria-labelledby="mud-title">
      <PanelHeader
        title="Mud trafficability"
        titleId="mud-title"
        aside={mud.horizon ? <Badge>{mud.horizon.label}</Badge> : null}
      />
      {mud.status === "stale" ? (
        <p className={styles.banner}>{mud.reason}</p>
      ) : null}
      <p className={styles.gaugeReadout}>
        <span className={styles.scoreValue}>{eq.score.toFixed(1)}</span>{" "}
        <span className={styles.muted}>/ 10</span>{" "}
        {eq.worst_flag === "hold" ? (
          <SeverityTag severity={3}>{FLAG_WORD.hold}</SeverityTag>
        ) : eq.worst_flag === "inspect" ? (
          <SeverityTag severity={2}>{FLAG_WORD.inspect}</SeverityTag>
        ) : (
          <StatusTag>{FLAG_WORD.ok}</StatusTag>
        )}
      </p>
      <p className={styles.driver}>
        <strong>
          {mi(eq.flagged_route_ft)} of {mi(eq.route_ft)} mi
        </strong>{" "}
        of rated route flagged for {name}
        {rut !== null ? ` · max predicted rut ${rut.toFixed(1)} in` : ""}
      </p>
      {share ? (
        <>
          <Slope share={share} summary={summary} />
          <ul
            className={styles.slopeKey}
            aria-label="Rated route length by result"
          >
            <li data-flag="ok">OK {mi(share.okFt)} mi</li>
            <li data-flag="inspect">Inspect {mi(share.inspectFt)} mi</li>
            <li data-flag="hold">Hold {mi(share.holdFt)} mi</li>
          </ul>
        </>
      ) : null}
      {eq.worst_flag === "hold" ? (
        <p className={styles.small}>
          Hold can come from the soil rating as well as from predicted rut
          depth.
        </p>
      ) : null}
      <p className={styles.small}>{(mud.caveats ?? [])[0]}</p>
    </Panel>
  );
}
