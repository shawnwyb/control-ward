import type { MapLibreMap } from "maplibre-gl";
import { applyFrameLayers, clearFrameLayers } from "./frameLayers";
import { OPEN_METEO_CREDIT } from "./forecast";
import { RADAR_CREDIT, RADAR_OPACITY, radarTileUrl } from "./radar";
import type { WeatherView } from "./types";

const RADAR = "radar-";
const FIELD = "wx-";
const FIELD_OPACITY = 0.78;

/**
 * Idempotent: make the map's raster weather layers match `view`. Wind is a
 * canvas, not a layer, so it (and null) simply clears the raster layers.
 */
export function applyWeather(map: MapLibreMap, view: WeatherView | null): void {
  if (view?.kind === "radar") {
    clearFrameLayers(map, FIELD);
    applyFrameLayers(
      map,
      RADAR,
      view.frames.map((time) => ({
        key: time,
        spec: {
          type: "raster",
          tiles: [radarTileUrl(time)],
          tileSize: 512,
          maxzoom: 9,
          attribution: RADAR_CREDIT,
        },
      })),
      view.index,
      RADAR_OPACITY,
    );
    return;
  }
  clearFrameLayers(map, RADAR);
  if (view?.kind === "field") {
    applyFrameLayers(
      map,
      FIELD,
      view.images.map((url, i) => ({
        // The image differs per variable and per frame; coordinates are shared.
        key: `${view.variable}:${i}:${url.length}:${url.slice(-24)}`,
        spec: {
          type: "image",
          url,
          coordinates: view.coordinates as [
            [number, number],
            [number, number],
            [number, number],
            [number, number],
          ],
        },
      })),
      view.index,
      FIELD_OPACITY,
    );
    return;
  }
  clearFrameLayers(map, FIELD);
}

export const FIELD_CREDIT = OPEN_METEO_CREDIT;
