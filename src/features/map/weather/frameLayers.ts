import type {
  ImageSourceSpecification,
  MapLibreMap,
  RasterSourceSpecification,
} from "maplibre-gl";

export type FrameSource = {
  /** Identity of this frame's data. A different key replaces the source. */
  key: string;
  spec: RasterSourceSpecification | ImageSourceSpecification;
};

// What each source on each map currently holds, so a changed frame can be swapped.
const applied = new WeakMap<MapLibreMap, Map<string, string>>();

/**
 * Idempotent: make the map hold exactly `frames` as layers under `prefix`.
 * Every frame is a layer, all but `index` at zero opacity, so frames preload
 * and stepping through them is a short cross-fade instead of a reload.
 * Layers sit under the basemap's labels and under our site ring.
 */
export function applyFrameLayers(
  map: MapLibreMap,
  prefix: string,
  frames: FrameSource[],
  index: number,
  opacity: number,
): void {
  const keys = applied.get(map) ?? new Map<string, string>();
  applied.set(map, keys);
  const wanted = new Set(frames.map((_, i) => prefix + i));

  for (const layer of map.getStyle().layers)
    if (layer.id.startsWith(prefix) && !wanted.has(layer.id))
      map.removeLayer(layer.id);
  for (const id of Object.keys(map.getStyle().sources))
    if (id.startsWith(prefix) && !wanted.has(id)) {
      map.removeSource(id);
      keys.delete(id);
    }
  if (!frames.length) return;

  const before =
    map.getStyle().layers.find((layer) => layer.type === "symbol")?.id ??
    (map.getLayer("site-extent") ? "site-extent" : undefined);
  frames.forEach((frame, i) => {
    const id = prefix + i;
    if (map.getSource(id) && keys.get(id) !== frame.key) {
      if (map.getLayer(id)) map.removeLayer(id);
      map.removeSource(id);
    }
    if (!map.getSource(id)) {
      map.addSource(id, frame.spec);
      keys.set(id, frame.key);
    }
    if (!map.getLayer(id))
      map.addLayer(
        {
          id,
          type: "raster",
          source: id,
          paint: {
            "raster-opacity": 0,
            "raster-opacity-transition": { duration: 180, delay: 0 },
            "raster-resampling": "linear",
            "raster-fade-duration": 0,
          },
        },
        before,
      );
    map.setPaintProperty(id, "raster-opacity", i === index ? opacity : 0);
  });
}

/** Drop every layer and source under `prefix`, and forget their keys. */
export function clearFrameLayers(map: MapLibreMap, prefix: string): void {
  applyFrameLayers(map, prefix, [], 0, 0);
}
