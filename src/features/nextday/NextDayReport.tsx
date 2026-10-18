import { useMemo, useState } from "react";
import type { FeatureCollection } from "geojson";
import { Panel, PanelHeader } from "../../components/ui";
import type { NextDayReport as Report } from "../../lib/nextDayReport";
import { SectionNav } from "../dashboard/SectionNav";
import { useNotice } from "../../hooks/notice";
import { useSiteFeed } from "../../hooks/useSiteFeed";
import type { Report as CrewReport, Site } from "../../lib/types";
import { DisclaimerFooter } from "./DisclaimerFooter";
import { HazardCard } from "./HazardCard";
import { MudCard } from "./MudCard";
import { RoutePanel } from "./RoutePanel";
import { ScheduleMatrix } from "./ScheduleMatrix";
import { AirTile, TideTile, WildlifeTile } from "./Tiles";
import { VerdictCard } from "./VerdictCard";
import { flaggedRoutes, type RouteFeature } from "./routesList";
import { useJson } from "./useJson";
import { useReport } from "./useReport";
import styles from "./NextDayReport.module.css";

/** Jump links for phones: the page is long, and every card has an id. */
const SECTIONS = [
  ["verdict", "Summary"],
  ["hazard-index", "Hazard"],
  ["mud", "Mud"],
  ["weather", "Schedule"],
  ["routes", "Routes"],
  ["flood", "Tide"],
  ["air", "Air"],
  ["wildlife", "Wildlife"],
  ["gaps", "Notes"],
] as const;

/** The loaded report. Its own component so the equipment choice and the route file are shared by the mud card and the map. */
function Loaded({
  report,
  stale,
  crewReports,
}: {
  report: Report;
  stale: boolean;
  crewReports: CrewReport[];
}) {
  const eia = report.meta.site.eia;
  const routesJson = useJson<FeatureCollection>(eia, report.mud.routes_file);
  const [equipment, setEquipment] = useState(
    report.mud.default_equipment ?? "road_truck",
  );
  const pieces = routesJson.data
    ? (routesJson.data.features as unknown as RouteFeature[])
    : null;
  const flagged = useMemo(
    () => (pieces ? flaggedRoutes(pieces, equipment) : null),
    [pieces, equipment],
  );
  return (
    <div className={styles.stack} id="next-day-report">
      <SectionNav sections={SECTIONS} />
      <div className={styles.hero}>
        <VerdictCard report={report} stale={stale} />
        <HazardCard report={report} />
        <MudCard
          report={report}
          equipment={equipment}
          pieces={pieces}
          flagged={flagged}
        />
      </div>
      <ScheduleMatrix report={report} />
      <RoutePanel
        report={report}
        crewReports={crewReports}
        routesJson={routesJson}
        flagged={flagged}
        equipment={equipment}
        onEquipment={setEquipment}
      />
      <div className={styles.tiles}>
        <TideTile report={report} />
        <AirTile report={report} />
        <WildlifeTile report={report} crewReports={crewReports} />
      </div>
      <DisclaimerFooter report={report} />
    </div>
  );
}

/** The 6 PM next-day safety report for one site, read from the files that reports/next-day/run.sh writes. */
export function NextDayReport({ site }: { site: Site }) {
  const eia = site.eia_plant_id;
  const result = useReport(eia);
  const { announce } = useNotice();
  // Open crew reports (mud and wildlife) are drawn on the map next to the report's own layers.
  const feed = useSiteFeed(site.id, (message) => announce(message, true));

  if (!eia)
    return (
      <Panel>
        <PanelHeader title="Detailed forecast" />
        <p className={styles.muted}>
          A detailed forecast is not available for this site. The safety
          checklist and work plan are shown above.
        </p>
      </Panel>
    );
  if (result === null)
    return (
      <Panel>
        <p role="status" className={styles.muted}>
          Loading the report…
        </p>
      </Panel>
    );
  if (result.kind === "none")
    return (
      <Panel>
        <PanelHeader title="No report yet" />
        <p className={styles.muted}>
          No detailed forecast has been published for {site.name} yet. The
          safety checklist and work plan are shown above.
        </p>
      </Panel>
    );
  if (result.kind === "error")
    return (
      <Panel>
        <PanelHeader title="The report could not be shown" />
        <p role="alert">{result.message}</p>
      </Panel>
    );

  return (
    <Loaded
      key={eia}
      report={result.report}
      stale={result.stale}
      crewReports={feed.reports}
    />
  );
}
