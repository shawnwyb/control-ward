import type { StyleSpecification } from "maplibre-gl";

/**
 * Basemap: OpenFreeMap "liberty". It is free, needs no API key, and shows
 * water, wetlands and landcover, roads and place names, so crews can read the
 * ground around a site. MapCanvas calms its labels a little so hazard markers
 * stay the loudest layer. Override with VITE_MAP_STYLE_URL (any MapLibre style URL).
 */
export const basemapStyle: string =
  import.meta.env.VITE_MAP_STYLE_URL ||
  "https://tiles.openfreemap.org/styles/liberty";

/** Used when the basemap cannot load (offline, blocked, bad URL). Overlays still work. */
export function offlineStyle(): StyleSpecification {
  const ground =
    getComputedStyle(document.documentElement)
      .getPropertyValue("--fill")
      .trim() || "#f1f1ef";
  return {
    version: 8,
    sources: {},
    layers: [
      {
        id: "background",
        type: "background",
        paint: { "background-color": ground },
      },
    ],
  };
}
