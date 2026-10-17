import type { StyleSpecification } from "maplibre-gl";

/**
 * Basemap: OpenFreeMap "positron". It is free, needs no API key, and is a
 * pale neutral style, so hazard markers stay the loudest thing on the map.
 * Override with VITE_MAP_STYLE_URL (any MapLibre style URL).
 */
export const basemapStyle: string =
  import.meta.env.VITE_MAP_STYLE_URL ||
  "https://tiles.openfreemap.org/styles/positron";

/** Used when the basemap cannot load (offline, blocked, bad URL). Overlays still work. */
export function offlineStyle(): StyleSpecification {
  const ground =
    getComputedStyle(document.documentElement)
      .getPropertyValue("--map-ground")
      .trim() || "#ece9de";
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
