// Active wildfires from the NIFC WFIGS current incident layer (public, no key).
import {
  evaluateAll,
  fetchJson,
  ingestReadings,
  loadSites,
  serve,
} from "../_shared/runtime.ts";
import { nearestFires, parseFires } from "../_shared/nifc.ts";
import { bucketIso } from "../_shared/util.ts";
import type { Reading } from "../_shared/types.ts";

const LAYER =
  "https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Incident_Locations_Current/FeatureServer/0/query";

serve("ingest-wildfire", async () => {
  const sites = await loadSites();
  const query = new URLSearchParams({
    where:
      "IncidentTypeCategory='WF' AND (PercentContained IS NULL OR PercentContained<100)",
    outFields: "IncidentName,IncidentSize,PercentContained",
    outSR: "4326",
    f: "json",
    resultRecordCount: "2000",
  });
  const fires = parseFires(await fetchJson(`${LAYER}?${query}`));
  const observed = bucketIso(Date.now(), 30);
  const rows: Reading[] = sites.flatMap((site) => {
    const { nearest, within } = nearestFires(site, fires);
    const base = {
      site_id: site.id,
      hazard: "wildfire" as const,
      observed_at: observed,
      source: "nifc",
    };
    // 999 means "no active fire known", so a cleared fire replaces the previous reading.
    return [
      {
        ...base,
        unit: "nearest_fire_mi",
        value: Math.round((nearest ?? 999) * 10) / 10,
      },
      { ...base, unit: "fires_within_25mi", value: within },
    ];
  });
  const written = await ingestReadings(rows);
  const evaluated = await evaluateAll();
  return { fires: fires.length, sites: sites.length, ...written, evaluated };
});
