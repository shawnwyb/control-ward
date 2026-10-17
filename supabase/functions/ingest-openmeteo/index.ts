// Heat, soil, rainfall and general weather for every site from one Open-Meteo request.
import {
  evaluateAll,
  fetchJson,
  ingestReadings,
  loadSites,
  serve,
} from "../_shared/runtime.ts";
import {
  buildReadings,
  openMeteoUrl,
  parseLocations,
} from "../_shared/openmeteo.ts";

serve("ingest-openmeteo", async () => {
  const sites = await loadSites();
  const body = await fetchJson<unknown>(openMeteoUrl(sites));
  const locations = parseLocations(body);
  if (locations.length !== sites.length)
    throw new Error(
      `Open-Meteo returned ${locations.length} locations for ${sites.length} sites`,
    );
  const now = Date.now();
  const rows = sites.flatMap((site, i) =>
    buildReadings(site, locations[i], now),
  );
  const written = await ingestReadings(rows);
  const evaluated = await evaluateAll();
  return { sites: sites.length, readings: rows.length, ...written, evaluated };
});
