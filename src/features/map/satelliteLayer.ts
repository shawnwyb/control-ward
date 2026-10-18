import type { MapLibreMap } from "maplibre-gl";

const SOURCE = "satellite";
const LAYER = "satellite";

/** USGS National Map imagery: US coverage, no key, public domain. Credit is required. */
export const SATELLITE_CREDIT = "Imagery: USGS The National Map";
const TILES =
  "https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}";

// The basemap's label colours before we recolour them for imagery, so turning it off restores them.
const labelPaint = new WeakMap<
  MapLibreMap,
  Map<string, [unknown, unknown, unknown]>
>();

/** Overlays that must stay above the imagery: weather frames and mud routes. */
const aboveImagery = (id: string) =>
  id.startsWith("radar-") || id.startsWith("wx-") || id.startsWith("mud-");

function anchor(map: MapLibreMap): string | undefined {
  const layers = map.getStyle().layers;
  return (
    layers.find((layer) => layer.id !== LAYER && aboveImagery(layer.id))?.id ??
    layers.find((layer) => layer.type === "symbol")?.id ??
    (map.getLayer("site-extent") ? "site-extent" : undefined)
  );
}

/** Idempotent: show or hide the satellite imagery. It sits over the basemap's land and roads, under labels and overlays. */
export function applySatellite(map: MapLibreMap, on: boolean): void {
  const saved = labelPaint.get(map) ?? new Map();
  labelPaint.set(map, saved);
  const symbols = map.getStyle().layers.filter((l) => l.type === "symbol");
  if (!on) {
    if (map.getLayer(LAYER)) map.removeLayer(LAYER);
    if (map.getSource(SOURCE)) map.removeSource(SOURCE);
    for (const layer of symbols) {
      const original = saved.get(layer.id);
      if (!original) continue;
      map.setPaintProperty(layer.id, "text-color", original[0]);
      map.setPaintProperty(layer.id, "text-halo-color", original[1]);
      map.setPaintProperty(layer.id, "text-halo-width", original[2]);
      saved.delete(layer.id);
    }
    return;
  }
  if (!map.getSource(SOURCE))
    map.addSource(SOURCE, {
      type: "raster",
      tiles: [TILES],
      tileSize: 256,
      maxzoom: 16,
      attribution: SATELLITE_CREDIT,
    });
  if (!map.getLayer(LAYER))
    map.addLayer(
      {
        id: LAYER,
        type: "raster",
        source: SOURCE,
        paint: { "raster-fade-duration": 200 },
      },
      anchor(map),
    );
  else if (anchor(map)) map.moveLayer(LAYER, anchor(map));
  // Dark labels vanish on imagery: light text with a dark outline.
  for (const layer of symbols) {
    if (!saved.has(layer.id))
      saved.set(layer.id, [
        map.getPaintProperty(layer.id, "text-color"),
        map.getPaintProperty(layer.id, "text-halo-color"),
        map.getPaintProperty(layer.id, "text-halo-width"),
      ]);
    map.setPaintProperty(layer.id, "text-color", "#ffffff");
    map.setPaintProperty(layer.id, "text-halo-color", "rgba(0,0,0,0.7)");
    map.setPaintProperty(layer.id, "text-halo-width", 1.5);
  }
}
