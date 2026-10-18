import { fetchReadings } from "../lib/monitoring";
import type { Reading } from "../lib/explain";
import { useLive } from "./useLive";

const none: Reading[] = [];

/**
 * The site's live readings, for explaining its hazard scores. Refreshed on the same
 * 30 s cadence as the site risk poll. Stale-guarded by useLive: one site's readings
 * never show under another site's name.
 */
export function useReadings(siteId: string) {
  return useLive<Reading[]>(siteId, [], fetchReadings, none, 30000);
}
