import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import type { FeatureCollection } from "geojson";
import {
  Badge,
  Button,
  Panel,
  PanelHeader,
  Segmented,
} from "../../components/ui";
import { reportFileUrl, type NextDayReport } from "../../lib/nextDayReport";
import type { Report } from "../../lib/types";
import {
  planDetour,
  type Avoid,
  type RoadGraph,
  type RouteResult,
} from "./route";
import type { CrewPoint, Layers, LngLat } from "./RouteMap";
import styles from "./NextDayReport.module.css";

const RouteMap = lazy(() => import("./RouteMap"));

/** Short names keep the equipment switch inside a phone screen; the full name is the spoken label. */
const SHORT: Record<string, string> = {
  road_truck: "Trucks",
  excavator: "Excavator",
  crawler_crane: "Crane",
};

const MILES_PER_METER = 1 / 1609.344;
const miles = (m: number) =>
  `${(m * MILES_PER_METER).toFixed(m * MILES_PER_METER < 10 ? 2 : 1)} mi`;

function useJson<T>(eia: string, rel: string | null | undefined): T | null {
  const [data, setData] = useState<T | null>(null);
  useEffect(() => {
    setData(null);
    if (!rel) return;
    const ctl = new AbortController();
    fetch(reportFileUrl(eia, rel), { signal: ctl.signal })
      .then((r) => (r.ok ? (r.json() as Promise<T>) : null))
      .then((d) => !ctl.signal.aborted && setData(d))
      .catch(() => undefined);
    return () => ctl.abort();
  }, [eia, rel]);
  return data;
}

function describe(
  label: string,
  r: RouteResult | null,
  equipmentName: string,
): string {
  if (!r)
    return `${label}: no connected path between the two points in the road data.`;
  const parts = [`${label}: ${miles(r.meters)}`];
  const hold = r.rated.hold;
  parts.push(
    hold > 0
      ? `${miles(hold)} of it at hold for ${equipmentName}`
      : "no segment at hold",
  );
  if (r.rated.inspect > 0) parts.push(`${miles(r.rated.inspect)} at inspect`);
  if (r.unrated > 0)
    parts.push(`${miles(r.unrated)} on roads the mud model does not rate`);
  if (r.privateRoad > 0)
    parts.push(`${miles(r.privateRoad)} on roads tagged private`);
  if (r.tideWet > 0)
    parts.push(`${miles(r.tideWet)} on ground the tide can reach`);
  return `${parts.join("; ")}.`;
}

export function RoutePanel({
  report,
  crewReports,
}: {
  report: NextDayReport;
  crewReports: Report[];
}) {
  const eia = report.meta.site.eia;
  const { mud, flood } = report;
  const routes = useJson<FeatureCollection>(eia, mud.routes_file);
  const tide = useJson<FeatureCollection>(eia, flood.tide.shading_file);
  const levees = useJson<FeatureCollection>(eia, flood.levees.map_file);
  const wildlife = useJson<FeatureCollection>(eia, report.wildlife?.map_file);
  const graph = useJson<RoadGraph>(eia, report.routing?.graph_file);
  const equipmentList = mud.equipment ?? [];
  const [equipment, setEquipment] = useState(
    mud.default_equipment ?? "road_truck",
  );
  const [show, setShow] = useState<Layers>({
    routes: true,
    tide: true,
    levees: true,
    wildlife: true,
    crew: true,
  });
  const [noMap, setNoMap] = useState(false);
  const current = equipmentList.find((e) => e.key === equipment);
  const crew: CrewPoint[] = useMemo(
    () =>
      crewReports
        .filter(
          (r) => r.is_active && (r.type === "mud" || r.type === "wildlife"),
        )
        .map((r) => ({
          id: r.id,
          latitude: r.latitude,
          longitude: r.longitude,
          type: r.type,
          severity: r.severity,
        })),
    [crewReports],
  );
  const anyLayer = Boolean(
    mud.routes_file ||
    flood.tide.shading_file ||
    flood.levees.map_file ||
    report.wildlife?.map_file ||
    crew.length,
  );

  // ---- detour planner
  const [picking, setPicking] = useState(false);
  const [a, setA] = useState<LngLat | null>(null);
  const [b, setB] = useState<LngLat | null>(null);
  const [avoid, setAvoid] = useState<Avoid>("hold");
  const [avoidTide, setAvoidTide] = useState(false);
  const [allowPrivate, setAllowPrivate] = useState(true);
  const onPick = (point: LngLat) => {
    if (!a || (a && b)) {
      setA(point);
      setB(null);
    } else {
      setB(point);
      setPicking(false);
    }
  };
  const plan = useMemo(
    () =>
      graph && a && b
        ? planDetour(graph, a, b, { equipment, avoid, avoidTide, allowPrivate })
        : null,
    [graph, a, b, equipment, avoid, avoidTide, allowPrivate],
  );
  const equipmentName = (current?.label ?? equipment).split(":")[0];
  const clearPlan = () => {
    setA(null);
    setB(null);
    setPicking(false);
  };

  return (
    <Panel id="routes" aria-labelledby="routes-title">
      <PanelHeader
        title="Routes to avoid, tide and levees"
        titleId="routes-title"
        description="Unpaved routes near the site, ranked by predicted rutting for the report day. This map also shows ground the tide can reach, mapped levees, wildlife sightings and crew reports."
        aside={mud.horizon ? <Badge>{mud.horizon.label}</Badge> : null}
      />
      {mud.status === "missing" || mud.status === "not_applicable" ? (
        <p className={styles.muted}>Routes: {mud.reason}</p>
      ) : null}
      {mud.status === "stale" ? (
        <p className={styles.banner}>{mud.reason}</p>
      ) : null}
      {equipmentList.length ? (
        <div className={`${styles.controls} ${styles.noPrint}`}>
          <Segmented
            label="Equipment"
            name="route-equipment"
            value={equipment}
            options={equipmentList.map((e) => ({
              value: e.key,
              label: SHORT[e.key] ?? e.label.split(":")[0],
              ariaLabel: e.label,
            }))}
            onChange={setEquipment}
          />
          {(
            [
              ["routes", "Routes", Boolean(mud.routes_file)],
              ["tide", "Tide shading", Boolean(flood.tide.shading_file)],
              ["levees", "Levees", Boolean(flood.levees.map_file)],
              ["wildlife", "Sightings", Boolean(report.wildlife?.map_file)],
              ["crew", "Crew reports", crew.length > 0],
            ] as const
          ).map(([key, label, has]) => (
            <label key={key} className={styles.check}>
              <input
                type="checkbox"
                checked={show[key] && has}
                disabled={!has}
                onChange={(e) => setShow({ ...show, [key]: e.target.checked })}
              />{" "}
              {label}
            </label>
          ))}
        </div>
      ) : null}
      {anyLayer && !noMap ? (
        <Suspense fallback={<p className={styles.muted}>Loading the map…</p>}>
          <RouteMap
            key={eia}
            center={{
              latitude: report.meta.site.latitude,
              longitude: report.meta.site.longitude,
            }}
            routes={routes}
            tide={tide}
            levees={levees}
            wildlife={wildlife}
            crew={crew}
            equipment={equipment}
            show={show}
            picking={picking}
            onPick={onPick}
            endpoints={{ a, b }}
            paths={{
              direct: plan?.direct?.coordinates ?? null,
              detour: plan?.detour?.coordinates ?? null,
            }}
            onUnavailable={() => setNoMap(true)}
          />
        </Suspense>
      ) : (
        <p className={styles.muted}>
          {noMap
            ? "The map could not start on this device. The lists below have the same facts."
            : "No map layers apply to this site and day."}
        </p>
      )}
      <ul className={styles.legend} aria-label="Map key">
        <li>
          <span
            className={styles.swatch}
            style={{ background: "var(--sev-3)" }}
          />{" "}
          Hold: predicted rut 8 in or more (thick line)
        </li>
        <li>
          <span
            className={styles.swatch}
            style={{ background: "var(--sev-2)" }}
          />{" "}
          Inspect: predicted rut 4 to 8 in (dashed line)
        </li>
        <li>
          <span
            className={styles.swatch}
            style={{ background: "var(--brand)", opacity: 0.5 }}
          />{" "}
          Tide can reach this ground (dark blue)
        </li>
        <li>
          <span
            className={styles.swatch}
            style={{ background: "var(--brand)", opacity: 0.2 }}
          />{" "}
          Within 0.3 m of the high-tide level (light blue)
        </li>
        <li>
          <span
            className={styles.swatch}
            style={{ background: "var(--ink)" }}
          />{" "}
          Levee or floodwall; circles are closures and pumps
        </li>
        <li>
          Hollow circle: iNaturalist sighting. Orange dot: crew mud report. Dark
          dot: crew wildlife report.
        </li>
      </ul>

      {graph && report.routing?.status === "ok" ? (
        <section aria-labelledby="detour-title" className={styles.noPrint}>
          <h3 id="detour-title" className={styles.sub}>
            Plan a detour
          </h3>
          <p className={styles.muted}>
            Pick a start and an end on the map. The planner finds the shortest
            road path that keeps off flagged routes for the equipment chosen
            above.
          </p>
          <div className={styles.controls}>
            <Button
              onClick={() =>
                picking ? setPicking(false) : (clearPlan(), setPicking(true))
              }
            >
              {picking
                ? "Cancel"
                : a || b
                  ? "Start again"
                  : "Pick start and end on the map"}
            </Button>
            {a || b ? <Button onClick={clearPlan}>Clear</Button> : null}
            <Segmented
              label="Avoid"
              name="detour-avoid"
              value={avoid}
              options={[
                { value: "hold", label: "Hold only" },
                { value: "hold_inspect", label: "Hold and inspect" },
              ]}
              onChange={setAvoid}
            />
            {flood.tide.shading_file ? (
              <label className={styles.check}>
                <input
                  type="checkbox"
                  checked={avoidTide}
                  onChange={(e) => setAvoidTide(e.target.checked)}
                />{" "}
                Avoid ground the tide can reach
              </label>
            ) : null}
            <label className={styles.check}>
              <input
                type="checkbox"
                checked={allowPrivate}
                onChange={(e) => setAllowPrivate(e.target.checked)}
              />{" "}
              Allow roads tagged private
            </label>
          </div>
          <p role="status" aria-live="polite">
            {picking
              ? a && !b
                ? "Now click the end point."
                : "Click the start point."
              : null}
          </p>
          {plan ? (
            plan.from === null || plan.to === null ? (
              <p>
                One of the points is more than 400 m from any mapped road. Pick
                a point closer to a road.
              </p>
            ) : (
              <ul className={styles.plain}>
                {plan.snapMeters &&
                Math.max(plan.snapMeters.from, plan.snapMeters.to) > 50 ? (
                  <li className={styles.muted}>
                    The points were moved to the nearest connected road: start{" "}
                    {plan.snapMeters.from} m, end {plan.snapMeters.to} m.
                  </li>
                ) : null}
                <li>
                  {describe(
                    "Direct route (dotted line)",
                    plan.direct,
                    equipmentName,
                  )}
                </li>
                <li>
                  <strong>
                    {plan.detour
                      ? describe(
                          "Detour (blue line)",
                          plan.detour,
                          equipmentName,
                        )
                      : "No road path avoids the flagged routes between these points. Try 'Hold only', or another end point."}
                  </strong>
                  {plan.detour &&
                  plan.direct &&
                  plan.detour.meters > plan.direct.meters
                    ? ` The detour is ${miles(plan.detour.meters - plan.direct.meters)} longer.`
                    : ""}
                </li>
              </ul>
            )
          ) : null}
          <ul className={styles.list}>
            {(report.routing.caveats ?? []).map((c) => (
              <li key={c} className={styles.muted}>
                {c}
              </li>
            ))}
          </ul>
        </section>
      ) : report.routing && report.routing.status !== "ok" ? (
        <p className={styles.muted}>Detours: {report.routing.reason}</p>
      ) : null}

      {current && mud.segment_counts ? (
        <>
          <h3 className={styles.sub}>Routes to avoid, in words</h3>
          <p>
            For <strong>{current.label}</strong> ({mud.passes} pass): worst
            result <strong>{current.worst_flag}</strong>, score{" "}
            {current.score.toFixed(1)} of 10.{" "}
            {Math.round((current.flagged_route_ft / 5280) * 10) / 10} of{" "}
            {Math.round((current.route_ft / 5280) * 10) / 10} miles of rated
            route are flagged.
          </p>
          <p className={styles.muted}>
            For road trucks, {mud.segment_counts.hold} segments are at hold,{" "}
            {mud.segment_counts.inspect} at inspect and {mud.segment_counts.ok}{" "}
            are ok. Soil moisture {mud.horizon?.soil_moisture}, forecast rain{" "}
            {mud.horizon?.rain_in.toFixed(1)} in.
          </p>
          <ul className={styles.list}>
            {(mud.caveats ?? []).map((c) => (
              <li key={c} className={styles.muted}>
                {c}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </Panel>
  );
}
