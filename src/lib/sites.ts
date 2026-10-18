/*
 * Pure helpers for cross-site summaries. Kept free of runtime imports (no
 * Supabase client) so plain Node tests can load it; monitoring.ts re-exports.
 */
import type { LightningView, Subscores } from "./monitoring";

export type SiteSummary = {
  siteId: string;
  name: string;
  latitude: number;
  longitude: number;
  riskNow: number | null;
  riskTomorrow: number | null;
  topDriver: string | null;
  subscores: Subscores;
  activeAlerts: number;
  lightning: LightningView;
};

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
