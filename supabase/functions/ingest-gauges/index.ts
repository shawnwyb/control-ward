// River stage per site gauge: NOAA NWPS first (also gives the flood stage), USGS as fallback.
import {
  evaluateAll,
  fetchJson,
  ingestReadings,
  loadSites,
  serve,
  userAgent,
} from "../_shared/runtime.ts";
import { parseNwps, parseUsgs } from "../_shared/gauges.ts";
import { bucketIso, chunk, pool } from "../_shared/util.ts";
import type { Reading } from "../_shared/types.ts";

serve("ingest-gauges", async () => {
  const sites = (await loadSites()).filter((s) => s.usgs_gauge_id);
  const observed = bucketIso(Date.now(), 15);
  const nwps = await pool(sites, 6, (site) =>
    fetchJson<Parameters<typeof parseNwps>[0]>(
      `https://api.water.noaa.gov/nwps/v1/gauges/${site.usgs_gauge_id}`,
      { headers: { "user-agent": userAgent() } },
      2,
    ).then(parseNwps),
  );

  const rows: Reading[] = [];
  const fallback: typeof sites = [];
  sites.forEach((site, i) => {
    const g = nwps[i];
    const base = {
      site_id: site.id,
      hazard: "flood" as const,
      observed_at: observed,
    };
    if (g && g.stage !== null) {
      rows.push({
        ...base,
        unit: "gauge_stage_ft",
        value: g.stage,
        source: "nwps",
      });
      if (g.floodStage !== null)
        rows.push({
          ...base,
          unit: "gauge_flood_stage_ft",
          value: g.floodStage,
          source: "nwps",
        });
    } else fallback.push(site);
  });

  let usgsStages = 0;
  for (const group of chunk(fallback, 40)) {
    const ids = [...new Set(group.map((s) => s.usgs_gauge_id!))].join(",");
    try {
      const body = await fetchJson<Parameters<typeof parseUsgs>[0]>(
        `https://waterservices.usgs.gov/nwis/iv/?format=json&sites=${ids}&parameterCd=00065&siteStatus=active`,
      );
      const stages = parseUsgs(body);
      for (const site of group) {
        const stage = stages.get(site.usgs_gauge_id!);
        if (stage !== undefined) {
          rows.push({
            site_id: site.id,
            hazard: "flood",
            unit: "gauge_stage_ft",
            value: stage,
            observed_at: observed,
            source: "usgs",
          });
          usgsStages++;
        }
      }
    } catch (error) {
      console.error("usgs batch failed", error);
    }
  }
  const written = await ingestReadings(rows);
  const evaluated = await evaluateAll();
  return {
    gauges: sites.length,
    nwps: sites.length - fallback.length,
    usgs: usgsStages,
    ...written,
    evaluated,
  };
});
