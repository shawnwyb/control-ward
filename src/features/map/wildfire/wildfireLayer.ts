import type { FeatureCollection } from "geojson";
import type { MapLibreMap } from "maplibre-gl";
import { distanceMeters } from "../../../lib/geo";

export const FIRE_SOURCE = "wildfires";
export const FIRE_LAYERS = ["wildfire-halo", "wildfire-dot"] as const;
/** Layers a person can click for details. */
export const FIRE_CLICKABLE = ["wildfire-dot"] as const;

/** Active wildfires from the NIFC WFIGS current incident layer (public, CORS-enabled, no key). */
const LAYER =
  "https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Incident_Locations_Current/FeatureServer/0/query";

const cssColor = (name: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/** Same filter as the ingest-wildfire function: wildfires not fully contained, 10 acres or more (or size unknown). */
export async function fetchFires(signal?: AbortSignal): Promise<FeatureCollection> {
  const query = new URLSearchParams({
    where:
      "IncidentTypeCategory='WF' AND (PercentContained IS NULL OR PercentContained<100) AND (IncidentSize IS NULL OR IncidentSize>=10)",
    outFields: "IncidentName,IncidentSize,PercentContained",
    outSR: "4326",
    f: "geojson",
    resultRecordCount: "2000",
  });
  const response = await fetch(`${LAYER}?${query}`, { signal });
  if (!response.ok) throw new Error(`NIFC ${response.status}`);
  return (await response.json()) as FeatureCollection;
}

/** Idempotent: make the map's wildfire layers match `fires`. Null removes them. Layers sit under the site outline. */
export function applyFires(
  map: MapLibreMap,
  fires: FeatureCollection | null,
): void {
  if (!fires) {
    for (const id of [...FIRE_LAYERS].reverse())
      if (map.getLayer(id)) map.removeLayer(id);
    if (map.getSource(FIRE_SOURCE)) map.removeSource(FIRE_SOURCE);
    return;
  }
  const source = map.getSource(FIRE_SOURCE) as
    { setData(d: FeatureCollection): void } | undefined;
  if (source) source.setData(fires);
  else map.addSource(FIRE_SOURCE, { type: "geojson", data: fires });
  const before = map.getLayer("site-extent") ? "site-extent" : undefined;
  const fire = cssColor("--risk-high") || "#d93025";
  // Bigger fires draw bigger: about 5 px at 10 acres up to 16 px at 100,000+.
  const radius = [
    "interpolate",
    ["linear"],
    ["ln", ["max", ["coalesce", ["get", "IncidentSize"], 10], 10]],
    Math.log(10),
    5,
    Math.log(100000),
    16,
  ];
  const add = (spec: Parameters<MapLibreMap["addLayer"]>[0]) => {
    if (!map.getLayer(spec.id)) map.addLayer(spec, before);
  };
  add({
    id: "wildfire-halo",
    type: "circle",
    source: FIRE_SOURCE,
    paint: {
      "circle-color": fire,
      "circle-opacity": 0.18,
      "circle-radius": ["*", radius, 2] as never,
    },
  });
  add({
    id: "wildfire-dot",
    type: "circle",
    source: FIRE_SOURCE,
    paint: {
      "circle-color": fire,
      "circle-radius": radius as never,
      "circle-stroke-color": cssColor("--bg") || "#fff",
      "circle-stroke-width": 1.5,
    },
  });
}

/** The card shown when a fire is clicked. Built with textContent only. */
export function firePopupElement(
  p: Record<string, unknown>,
  lngLat: { lng: number; lat: number },
  site: { latitude: number; longitude: number },
): HTMLElement {
  const box = document.createElement("div");
  box.style.cssText =
    "font:14px/1.4 var(--font-sans);color:var(--ink);max-width:16rem";
  const acres = Number(p.IncidentSize);
  const contained = p.PercentContained;
  const miles =
    distanceMeters(site.latitude, site.longitude, lngLat.lat, lngLat.lng) /
    1609.344;
  const lines = [
    `Wildfire · ${p.IncidentName ?? "Unnamed incident"}`,
    `${Number.isFinite(acres) && acres > 0 ? `${Math.round(acres).toLocaleString()} acres` : "Size unknown"} · ${
      contained !== null && contained !== undefined
        ? `${contained}% contained`
        : "containment unknown"
    }`,
    `${miles.toFixed(1)} miles from the site.`,
  ];
  lines.forEach((text, i) => {
    const line = document.createElement(i === 0 ? "strong" : "div");
    line.textContent = text;
    box.appendChild(line);
  });
  return box;
}
