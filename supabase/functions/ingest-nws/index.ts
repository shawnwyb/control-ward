// NWS active alerts per site: severity of the worst alert and whether a flood warning is in effect.
import {
  evaluateAll,
  fetchJson,
  ingestReadings,
  loadSites,
  serve,
  userAgent,
} from "../_shared/runtime.ts";
import { summarizeAlerts } from "../_shared/nws.ts";
import { bucketIso, pool } from "../_shared/util.ts";
import type { Reading } from "../_shared/types.ts";

serve("ingest-nws", async () => {
  const sites = await loadSites();
  const now = Date.now();
  const observed = bucketIso(now, 5);
  const results = await pool(sites, 6, async (site) => {
    const body = await fetchJson<Parameters<typeof summarizeAlerts>[0]>(
      `https://api.weather.gov/alerts/active?point=${site.latitude.toFixed(4)},${site.longitude.toFixed(4)}`,
      {
        headers: { "user-agent": userAgent(), accept: "application/geo+json" },
      },
    );
    return summarizeAlerts(body);
  });
  const rows: Reading[] = [];
  let failed = 0;
  results.forEach((r, i) => {
    if (!r) {
      failed++;
      return;
    } // keep the previous reading rather than guess; it expires after 3 hours
    const base = { site_id: sites[i].id, observed_at: observed, source: "nws" };
    rows.push({
      ...base,
      hazard: "weather",
      unit: "nws_alert_severity",
      value: r.severity,
    });
    rows.push({
      ...base,
      hazard: "flood",
      unit: "nws_flood_warning",
      value: r.floodWarning,
    });
  });
  const written = await ingestReadings(rows);
  const evaluated = await evaluateAll();
  return { sites: sites.length, failed, ...written, evaluated };
});
