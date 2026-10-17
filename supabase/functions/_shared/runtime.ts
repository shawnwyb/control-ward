// Deno-only helpers shared by every Edge Function. Pure logic lives in the sibling modules.
import type { Reading, Site } from "./types.ts";
import { chunk } from "./util.ts";

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (req: Request) => Response | Promise<Response>): void;
};

const url = () => Deno.env.get("SUPABASE_URL")!;
const key = () => Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
export const userAgent = () =>
  Deno.env.get("NWS_USER_AGENT") ?? "PlanITControl/1.0 (SwampHacks project)";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

// Cron calls carry a shared secret (kept in Vault and as a function secret). The service-role key never leaves the function.
function authorized(req: Request): boolean {
  const expected = Deno.env.get("CRON_SECRET");
  const got = req.headers.get("x-cron-secret") ?? "";
  if (!expected || got.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++)
    diff |= got.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

export function serve(
  name: string,
  run: () => Promise<Record<string, unknown>>,
): void {
  Deno.serve(async (req) => {
    if (!authorized(req)) return json({ error: "unauthorized" }, 401);
    try {
      return json({ ok: true, function: name, ...(await run()) });
    } catch (error) {
      console.error(name, error);
      return json({ ok: false, function: name, error: String(error) }, 500);
    }
  });
}

export async function fetchJson<T>(
  target: string,
  init: RequestInit = {},
  attempts = 3,
): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(target, {
        ...init,
        signal: AbortSignal.timeout(20_000),
      });
      if (res.ok) return (await res.json()) as T;
      last = new Error(
        `${res.status} ${res.statusText} for ${target.slice(0, 80)}`,
      );
      if (res.status < 500 && res.status !== 429) break;
    } catch (error) {
      last = error;
    }
    await new Promise((r) => setTimeout(r, 400 * (i + 1)));
  }
  throw last;
}

async function rest<T>(path: string, init: RequestInit): Promise<T> {
  const res = await fetch(`${url()}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: key(),
      authorization: `Bearer ${key()}`,
      "content-type": "application/json",
      ...init.headers,
    },
  });
  if (!res.ok)
    throw new Error(`${path} failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

export const rpc = <T = unknown>(name: string, args: Record<string, unknown>) =>
  rest<T>(`rpc/${name}`, { method: "POST", body: JSON.stringify(args) });

// Only real registry plants are monitored (eia_plant_id set); test and demo sites are skipped.
export const loadSites = () =>
  rest<Site[]>(
    "sites?select=id,latitude,longitude,timezone,usgs_gauge_id&eia_plant_id=not.is.null&order=id",
    { method: "GET" },
  );

export async function ingestReadings(
  rows: Reading[],
): Promise<{ inserted: number; updated: number }> {
  let inserted = 0,
    updated = 0;
  for (const batch of chunk(rows, 2000)) {
    const r = await rpc<{ inserted: number; updated: number }>(
      "ingest_readings",
      { p_batch: batch },
    );
    inserted += r.inserted;
    updated += r.updated;
  }
  return { inserted, updated };
}

export const evaluateAll = () =>
  rpc<{ evaluated: number; failed: number }>("evaluate_all_sites", {});
