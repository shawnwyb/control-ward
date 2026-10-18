/*
 * Pure helpers for cross-site summaries. Kept free of runtime imports (no
 * Supabase client) so plain Node tests can load it; monitoring.ts re-exports.
 */
import type { LightningView, Subscores } from "./monitoring";

export type SiteSummary = {
  siteId: string;
  name: string;
  /** Null when the site has no coordinates yet; such sites get no map pin. */
  latitude: number | null;
  longitude: number | null;
  riskNow: number | null;
  riskTomorrow: number | null;
  topDriver: string | null;
  subscores: Subscores;
  activeAlerts: number;
  lightning: LightningView;
};

/** A `site_overview` row as returned by PostgREST (every column may be null). */
export type SiteOverviewRow = {
  site_id?: string | null;
  name?: string | null;
  lat?: number | null;
  lon?: number | null;
  risk_now?: number | null;
  risk_tomorrow?: number | null;
  top_driver?: string | null;
  subscores?: unknown;
  active_alert_count?: number | null;
  lightning?: unknown;
};

/** One overview row as a summary; null for a row without a site id. Missing coordinates stay null. */
export function siteSummaryFromRow(row: SiteOverviewRow): SiteSummary | null {
  if (!row.site_id) return null;
  const lightning = (row.lightning ?? {}) as Record<string, unknown>;
  return {
    siteId: row.site_id,
    name: row.name ?? "",
    latitude: typeof row.lat === "number" ? row.lat : null,
    longitude: typeof row.lon === "number" ? row.lon : null,
    riskNow: row.risk_now ?? null,
    riskTomorrow: row.risk_tomorrow ?? null,
    topDriver: row.top_driver ?? null,
    subscores: (row.subscores ?? {}) as Subscores,
    activeAlerts: Number(row.active_alert_count ?? 0),
    lightning: {
      status: lightning.status === "stop_work" ? "stop_work" : "clear",
      lastStrikeAt:
        typeof lightning.last_strike_at === "string"
          ? lightning.last_strike_at
          : null,
      lastStrikeDistanceM:
        typeof lightning.last_strike_distance_m === "number"
          ? lightning.last_strike_distance_m
          : null,
    },
  };
}

/** Accessible name of a site's map pin: "<name>, hazard index 5.2" or "..., hazard index no score". */
export function sitePinLabel(
  site: Pick<SiteSummary, "name" | "riskNow">,
): string {
  return `${site.name}, hazard index ${
    site.riskNow === null ? "no score" : site.riskNow.toFixed(1)
  }`;
}

/** Highest hazard index first, sites with no score last, ties by name. */
export function rankSites<T extends Pick<SiteSummary, "name" | "riskNow">>(
  sites: T[],
): T[] {
  return [...sites].sort((a, b) => {
    if (a.riskNow === null && b.riskNow !== null) return 1;
    if (a.riskNow !== null && b.riskNow === null) return -1;
    if (a.riskNow !== null && b.riskNow !== null && a.riskNow !== b.riskNow)
      return b.riskNow - a.riskNow;
    return a.name.localeCompare(b.name);
  });
}

/** The hazards driving a site's index: highest non-zero subscores first. */
export function topHazards(
  subscores: Subscores,
  limit = 2,
): (keyof Subscores)[] {
  return (Object.entries(subscores) as [keyof Subscores, number | undefined][])
    .filter(([, value]) => typeof value === "number" && value > 0)
    .sort((a, b) => (b[1] as number) - (a[1] as number))
    .slice(0, limit)
    .map(([key]) => key);
}

export type OverviewState = {
  sites: SiteSummary[];
  loaded: boolean;
  error: string | null;
};

export const initialOverviewState: OverviewState = {
  sites: [],
  loaded: false,
  error: null,
};

/**
 * Folds one fetch outcome into the hook state. A failure keeps the last good list,
 * records the message, and still marks the first attempt as finished, so callers
 * can tell loading from failed.
 */
export function nextOverviewState(
  prev: OverviewState,
  result: { ok: true; sites: SiteSummary[] } | { ok: false; message: string },
): OverviewState {
  return result.ok
    ? { sites: result.sites, loaded: true, error: null }
    : { sites: prev.sites, loaded: true, error: result.message };
}
