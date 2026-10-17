// Lightning flashes -> ingest_strikes. The 10 mi / 30:00 rules live in Postgres, not here.
// Blitzortung is not used: its terms forbid storm-warning use. NOAA GOES GLM is the source (LIGHTNING_SOURCE=glm).
import { File } from "npm:jsfive@0.4.2";
import { loadSites, rpc, serve, userAgent } from "../_shared/runtime.ts";
import { boundingBox } from "../_shared/geo.ts";
import {
  extractStrikes,
  GLM_BUCKET,
  listingPrefixes,
  parseListing,
  recentKeys,
} from "../_shared/glm.ts";
import type { Strike } from "../_shared/types.ts";
import { pool } from "../_shared/util.ts";

const WINDOW_MS = 150_000;
// deno-lint-ignore no-explicit-any
const env = (name: string) =>
  (globalThis as any).Deno.env.get(name) as string | undefined;

async function glmStrikes(
  sites: Awaited<ReturnType<typeof loadSites>>,
): Promise<{ strikes: Strike[]; files: number }> {
  const now = Date.now();
  const box = boundingBox(sites, 0.5);
  const headers = { "user-agent": userAgent() };
  const listings = await Promise.all(
    listingPrefixes(now, WINDOW_MS).map(async (prefix) => {
      const res = await fetch(`${GLM_BUCKET}/?list-type=2&prefix=${prefix}`, {
        headers,
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) throw new Error(`GLM listing failed: ${res.status}`);
      return parseListing(await res.text());
    }),
  );
  const keys = recentKeys(listings.flat(), now, WINDOW_MS);
  const parsed = await pool(keys, 4, async (key) => {
    const res = await fetch(`${GLM_BUCKET}/${key}`, {
      headers,
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`GLM file failed: ${res.status}`);
    return extractStrikes(new File(await res.arrayBuffer()), box);
  });
  return { strikes: parsed.flatMap((p) => p ?? []), files: keys.length };
}

serve("ingest-lightning", async () => {
  const source = env("LIGHTNING_SOURCE") ?? "none";
  if (source === "none") return { source, strikes: 0 };
  if (source !== "glm") throw new Error(`Unknown LIGHTNING_SOURCE ${source}`);
  const { strikes, files } = await glmStrikes(await loadSites());
  if (!strikes.length) return { source, files, flashes: 0 };
  return {
    source,
    files,
    flashes: strikes.length,
    ...(await rpc<Record<string, unknown>>("ingest_strikes", {
      p_batch: strikes,
    })),
  };
});
