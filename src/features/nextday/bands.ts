import type { Severity } from "../../lib/types";
import type { BandId, HeatBand } from "../../lib/nextDayReport";

/** Severity shape paired with each heat band, so the band survives greyscale. Extreme danger also gets a heavy outline. */
export const BAND_SEVERITY: Record<BandId, Severity | null> = {
  low: null,
  caution: 1,
  extreme_caution: 2,
  danger: 3,
  extreme_danger: 3,
};

/** "91 to 102 F" for a band, from the report's own band list. */
export function bandRange(bands: HeatBand[], id: BandId): string {
  const i = bands.findIndex((b) => b.id === id);
  const band = bands[i];
  if (!band) return "";
  const next = bands[i + 1];
  if (band.min === null) return `below ${next?.min ?? 80} F`;
  if (!next) return `${band.min} F and above`;
  return `${band.min} to ${(next.min ?? 0) - 1} F`;
}

export const REASON_TEXT: Record<string, string> = {
  heat: "heat",
  wind: "wind",
  storms: "storms",
  rain: "rain",
};
