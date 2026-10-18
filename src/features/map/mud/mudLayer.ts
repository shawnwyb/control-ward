import type { Feature, FeatureCollection } from "geojson";
import type { MapLibreMap } from "maplibre-gl";

export const MUD_SOURCE = "mud-routes";
export const MUD_LAYERS = ["mud-casing", "mud-inspect", "mud-hold"] as const;
/** Layers a person can click for details. */
export const MUD_CLICKABLE = ["mud-hold", "mud-inspect"] as const;
export const MUD_FLAGS = ["ok", "inspect", "hold"] as const;

/** Short names keep the equipment chips inside a phone screen; the full name is the spoken label. */
export const EQUIPMENT_SHORT: Record<string, string> = {
  road_truck: "Trucks",
  excavator: "Excavator",
  crawler_crane: "Crane",
};

export type MudRoutes = { routes: FeatureCollection; equipment: string };

const cssColor = (name: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/** Route features carry rut results for every equipment class; the map layer needs the chosen class as flat properties. */
export function flattenMud(
  routes: FeatureCollection,
  equipment: string,
): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: routes.features.map((f) => {
      const r = (
        f.properties?.r as
          Record<string, [number, number, number | null]> | undefined
      )?.[equipment];
      return {
        ...f,
        properties: {
          highway: f.properties?.highway,
          name: f.properties?.name,
          length_ft: f.properties?.length_ft,
          flag: r?.[0] ?? 0,
          score: r?.[1] ?? null,
          rut: r?.[2] ?? null,
        },
      } as Feature;
    }),
  };
}

/** How many segments need a look for this equipment: the text summary for people who cannot see the lines. */
export function countFlags(
  routes: FeatureCollection,
  equipment: string,
): { inspect: number; hold: number } {
  const counts = { inspect: 0, hold: 0 };
  for (const feature of flattenMud(routes, equipment).features) {
    if (feature.properties?.flag === 1) counts.inspect++;
    if (feature.properties?.flag === 2) counts.hold++;
  }
  return counts;
}

/** Idempotent: make the map's mud layers match `mud`. Null removes them. Layers sit under the site outline. */
export function applyMud(map: MapLibreMap, mud: MudRoutes | null): void {
  if (!mud) {
    for (const id of [...MUD_LAYERS].reverse())
      if (map.getLayer(id)) map.removeLayer(id);
    if (map.getSource(MUD_SOURCE)) map.removeSource(MUD_SOURCE);
    return;
  }
  const data = flattenMud(mud.routes, mud.equipment);
  const source = map.getSource(MUD_SOURCE) as
    { setData(d: FeatureCollection): void } | undefined;
  if (source) source.setData(data);
  else map.addSource(MUD_SOURCE, { type: "geojson", data });
  const before = map.getLayer("site-extent") ? "site-extent" : undefined;
  const add = (spec: Parameters<MapLibreMap["addLayer"]>[0]) => {
    if (!map.getLayer(spec.id)) map.addLayer(spec, before);
  };
  add({
    id: "mud-casing",
    type: "line",
    source: MUD_SOURCE,
    filter: [">=", ["get", "flag"], 1],
    paint: { "line-color": cssColor("--bg"), "line-width": 9 },
    layout: { "line-cap": "round" },
  });
  add({
    id: "mud-inspect",
    type: "line",
    source: MUD_SOURCE,
    filter: ["==", ["get", "flag"], 1],
    paint: {
      "line-color": cssColor("--risk-elevated"),
      "line-width": 4,
      "line-dasharray": [2, 1],
    },
    layout: { "line-cap": "butt" },
  });
  add({
    id: "mud-hold",
    type: "line",
    source: MUD_SOURCE,
    filter: ["==", ["get", "flag"], 2],
    paint: { "line-color": cssColor("--risk-high"), "line-width": 5 },
    layout: { "line-cap": "round" },
  });
}

/** The card shown when a route is clicked. */
export function mudPopupElement(p: Record<string, unknown>): HTMLElement {
  const box = document.createElement("div");
  box.style.cssText =
    "font:14px/1.4 var(--font-sans);color:var(--ink);max-width:16rem";
  const lines = [
    `${MUD_FLAGS[Number(p.flag)] ?? "ok"} · ${p.highway ?? "unpaved way"}${p.name ? ` · ${p.name}` : ""}`,
    p.rut !== null && p.rut !== undefined
      ? `Predicted rut depth about ${Number(p.rut).toFixed(1)} in (inspect at 4 in, hold at 8 in).`
      : "Rut depth not available for this equipment.",
    `Score ${p.score ?? "n/a"} of 10 · ${p.length_ft} ft long.`,
  ];
  lines.forEach((text, i) => {
    const line = document.createElement(i === 0 ? "strong" : "div");
    line.textContent = text;
    box.appendChild(line);
  });
  return box;
}
