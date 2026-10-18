import { lazy, Suspense, useEffect, useState } from "react";
import type { FeatureCollection } from "geojson";
import { Badge, Panel, PanelHeader, Segmented } from "../../components/ui";
import { reportFileUrl, type NextDayReport } from "../../lib/nextDayReport";
import type { Layers } from "./RouteMap";
import styles from "./NextDayReport.module.css";

const RouteMap = lazy(() => import("./RouteMap"));

/** Short names keep the equipment switch inside a phone screen; the full name is the spoken label. */
const SHORT: Record<string, string> = {
  road_truck: "Trucks",
  excavator: "Excavator",
  crawler_crane: "Crane",
};

function useGeojson(
  eia: string,
  rel: string | null | undefined,
): FeatureCollection | null {
  const [data, setData] = useState<FeatureCollection | null>(null);
  useEffect(() => {
    setData(null);
    if (!rel) return;
    const ctl = new AbortController();
    fetch(reportFileUrl(eia, rel), { signal: ctl.signal })
      .then((r) => (r.ok ? (r.json() as Promise<FeatureCollection>) : null))
      .then((d) => !ctl.signal.aborted && setData(d))
      .catch(() => undefined);
    return () => ctl.abort();
  }, [eia, rel]);
  return data;
}

export function RoutePanel({ report }: { report: NextDayReport }) {
  const eia = report.meta.site.eia;
  const { mud, flood } = report;
  const routes = useGeojson(eia, mud.routes_file);
  const tide = useGeojson(eia, flood.tide.shading_file);
  const levees = useGeojson(eia, flood.levees.map_file);
  const equipmentList = mud.equipment ?? [];
  const [equipment, setEquipment] = useState(
    mud.default_equipment ?? "road_truck",
  );
  const [show, setShow] = useState<Layers>({
    routes: true,
    tide: true,
    levees: true,
  });
  const [noMap, setNoMap] = useState(false);
  const current = equipmentList.find((e) => e.key === equipment);
  const anyLayer = Boolean(
    mud.routes_file || flood.tide.shading_file || flood.levees.map_file,
  );

  return (
    <Panel id="routes" aria-labelledby="routes-title">
      <PanelHeader
        title="Routes to avoid, tide and levees"
        titleId="routes-title"
        description="Unpaved routes near the site, ranked by predicted rutting for the report day. This map also shows ground the tide can reach and mapped levees."
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
            equipment={equipment}
            show={show}
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
      </ul>

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
