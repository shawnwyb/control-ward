import { lazy, Suspense, useMemo, useRef, useState } from "react";
import type { FeatureCollection } from "geojson";
import {
  Badge,
  Button,
  Panel,
  PanelHeader,
  Segmented,
} from "../../components/ui";
import type { NextDayReport } from "../../lib/nextDayReport";
import type { Report } from "../../lib/types";
import {
  planDetour,
  type Avoid,
  type RoadGraph,
  type RouteResult,
} from "./route";
import type { CrewPoint, Layers, LngLat } from "./RouteMap";
import { FlaggedRoutes } from "./FlaggedRoutes";
import type { FlaggedRoute } from "./routesList";
import { useJson } from "./useJson";
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
  routesJson,
  flagged,
  equipment,
  onEquipment,
}: {
  report: NextDayReport;
  crewReports: Report[];
  routesJson: { data: FeatureCollection | null; failed: boolean };
  flagged: FlaggedRoute[] | null;
  equipment: string;
  onEquipment: (key: string) => void;
}) {
  const eia = report.meta.site.eia;
  const { mud, flood } = report;
  const tideJson = useJson<FeatureCollection>(eia, flood.tide.shading_file);
  const leveesJson = useJson<FeatureCollection>(eia, flood.levees.map_file);
  const wildlifeJson = useJson<FeatureCollection>(
    eia,
    report.wildlife?.map_file,
  );
  const graphJson = useJson<RoadGraph>(eia, report.routing?.graph_file);
  const routes = routesJson.data;
  const tide = tideJson.data;
  const levees = leveesJson.data;
  const wildlife = wildlifeJson.data;
  const graph = graphJson.data;
  const failedLayers = [
    routesJson.failed && "routes",
    tideJson.failed && "tide shading",
    leveesJson.failed && "levees",
    wildlifeJson.failed && "sightings",
    graphJson.failed && "road data for detours",
  ].filter(Boolean) as string[];
  const equipmentList = mud.equipment ?? [];
  const [selectedWay, setSelectedWay] = useState<number | null>(null);
  const mapCol = useRef<HTMLDivElement>(null);
  // Picking a road, or a detour point, needs the map on screen. The table and the detour buttons sit below it.
  const showMap = (smooth: boolean) =>
    mapCol.current?.scrollIntoView({
      behavior:
        smooth && !window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "smooth"
          : "auto",
      block: "nearest",
    });
  const selectWay = (osmId: number | null) => {
    setSelectedWay(osmId);
    // Side by side on a wide screen the map is already in view.
    if (osmId !== null && !window.matchMedia("(min-width: 64rem)").matches)
      showMap(true);
  };
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
  const startAtPlant = () => {
    setA([report.meta.site.longitude, report.meta.site.latitude]);
    setB(null);
    setPicking(true);
    showMap(false);
  };

  // Each layer, and why it is missing when it is.
  const layerList = [
    {
      key: "routes",
      label: "Routes",
      has: Boolean(mud.routes_file),
      why: mud.routes_file ? null : (mud.reason ?? "no flagged routes"),
    },
    {
      key: "tide",
      label: "Tide shading",
      has: Boolean(flood.tide.shading_file),
      why: flood.tide.shading_file
        ? null
        : (flood.tide.shading_reason ?? flood.tide.reason ?? "no tide data"),
    },
    {
      key: "levees",
      label: "Levees",
      has: Boolean(flood.levees.map_file),
      why: flood.levees.map_file
        ? null
        : (flood.levees.reason ?? "no levees mapped nearby"),
    },
    {
      key: "wildlife",
      label: "Sightings",
      has: Boolean(report.wildlife?.map_file),
      why: report.wildlife?.map_file
        ? null
        : (report.wildlife?.reason ??
          "no recent public sightings with coordinates"),
    },
    {
      key: "crew",
      label: "Crew reports",
      has: crew.length > 0,
      why:
        crew.length > 0
          ? null
          : "no open mud or wildlife reports from the crew",
    },
  ] as const;
  const missingLayers = layerList.filter((l) => !l.has);

  return (
    <Panel id="routes" aria-labelledby="routes-title">
      <PanelHeader
        title="Routes to avoid"
        titleId="routes-title"
        description="Unpaved routes for the report day, with tide, levee, sighting and crew layers."
        aside={mud.horizon ? <Badge>{mud.horizon.label}</Badge> : null}
      />
      {mud.status === "missing" || mud.status === "not_applicable" ? (
        <p className={styles.muted}>Routes: {mud.reason}</p>
      ) : null}
      <div className={styles.zone3}>
        <div ref={mapCol} className={styles.mapCol}>
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
                onChange={onEquipment}
              />
              {layerList.map(({ key, label, has }) => (
                <label key={key} className={styles.check}>
                  <input
                    type="checkbox"
                    checked={show[key] && has}
                    disabled={!has}
                    onChange={(e) =>
                      setShow({ ...show, [key]: e.target.checked })
                    }
                  />{" "}
                  {label}
                </label>
              ))}
            </div>
          ) : null}
          {missingLayers.length ? (
            <p className={`${styles.small} ${styles.noPrint}`}>
              Not shown:{" "}
              {missingLayers.map((l) => `${l.label} (${l.why})`).join("; ")}.
            </p>
          ) : null}
          {failedLayers.length ? (
            <p className={styles.banner} role="alert">
              Could not load: {failedLayers.join(", ")}. Reload the page to try
              again.
            </p>
          ) : null}
          {anyLayer && !noMap ? (
            <Suspense
              fallback={<p className={styles.muted}>Loading the map…</p>}
            >
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
                onCancel={() => setPicking(false)}
                endpoints={{ a, b }}
                paths={{
                  direct: plan?.direct?.coordinates ?? null,
                  detour: plan?.detour?.coordinates ?? null,
                }}
                selectedWay={selectedWay}
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
                style={{ background: "var(--severity-3)" }}
              />{" "}
              Hold: predicted rut 8 in or more, or a poor soil rating (thick
              line)
            </li>
            <li>
              <span
                className={styles.swatch}
                style={{ background: "var(--severity-2)" }}
              />{" "}
              Inspect: predicted rut 4 to 8 in, a fair soil rating or wet ground
              (dashed line)
            </li>
            <li>
              <span
                className={styles.swatch}
                style={{ background: "var(--accent)", opacity: 0.5 }}
              />{" "}
              Tide can reach this ground (dark blue)
            </li>
            <li>
              <span
                className={styles.swatch}
                style={{ background: "var(--accent)", opacity: 0.2 }}
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
              Hollow circle: iNaturalist sighting. Orange dot: crew mud report.
              Dark dot: crew wildlife report.
            </li>
          </ul>
        </div>
        {mud.routes_file && equipmentList.length ? (
          <FlaggedRoutes
            routes={routesJson.failed ? null : flagged}
            failed={routesJson.failed}
            equipmentName={equipmentName}
            selected={selectedWay}
            onSelect={selectWay}
          />
        ) : null}
      </div>

      {graph && report.routing?.status === "ok" ? (
        <section aria-labelledby="detour-title" className={styles.noPrint}>
          <h3 id="detour-title" className={styles.sub}>
            Plan a detour
          </h3>
          <p className={styles.muted}>
            Pick a start and an end on the map, with a click or with the
            keyboard. The planner finds the shortest road path that keeps off
            flagged routes for the equipment chosen above.
          </p>
          <div className={styles.controls}>
            <Button
              onClick={() =>
                picking
                  ? setPicking(false)
                  : (clearPlan(), setPicking(true), showMap(false))
              }
            >
              {picking
                ? "Cancel"
                : a || b
                  ? "Start again"
                  : "Pick start and end on the map"}
            </Button>
            {!picking && !a && !b ? (
              <Button onClick={startAtPlant}>Start at the plant</Button>
            ) : null}
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
                ? "Now choose the end point the same way."
                : "Choose the start point: click the map, or use the arrow keys to move the crosshair and press Enter. Escape cancels."
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
          <p className={styles.muted}>
            {(report.routing.caveats ?? []).at(-1)}
          </p>
        </section>
      ) : report.routing && report.routing.status !== "ok" ? (
        <p className={styles.muted}>Detours: {report.routing.reason}</p>
      ) : null}
    </Panel>
  );
}
