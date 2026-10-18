import { useEffect, useRef } from "react";
import {
  AttributionControl,
  MapLibreMap,
  Marker,
  NavigationControl,
  Popup,
  ScaleControl,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Feature, FeatureCollection } from "geojson";
import { basemapStyle, offlineStyle } from "../map/mapStyle";
import { centerMarkerElement } from "../map/markers";
import styles from "./NextDayReport.module.css";

export type Layers = { routes: boolean; tide: boolean; levees: boolean };

type Props = {
  center: { latitude: number; longitude: number };
  routes: FeatureCollection | null;
  tide: FeatureCollection | null;
  levees: FeatureCollection | null;
  equipment: string;
  show: Layers;
  onUnavailable: () => void;
};

const FLAGS = ["ok", "inspect", "hold"];
const cssColor = (name: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/** Route features carry rut results for every equipment class; the map layer needs the chosen class as flat properties. */
function flatten(
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

const EMPTY: FeatureCollection = { type: "FeatureCollection", features: [] };

function popupContent(lines: string[]): HTMLElement {
  const box = document.createElement("div");
  box.style.cssText =
    "font:14px/1.4 var(--font-sans);color:var(--ink);max-width:16rem";
  lines.forEach((text, i) => {
    const p = document.createElement(i === 0 ? "strong" : "div");
    p.textContent = text;
    box.appendChild(p);
  });
  return box;
}

export default function RouteMap({
  center,
  routes,
  tide,
  levees,
  equipment,
  show,
  onUnavailable,
}: Props) {
  const node = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const ready = useRef(false);
  const latest = useRef({ routes, tide, levees, equipment, show });
  useEffect(() => {
    latest.current = { routes, tide, levees, equipment, show };
  });

  function sync() {
    const m = map.current;
    if (!m || !ready.current) return;
    const {
      routes: r,
      tide: t,
      levees: l,
      equipment: e,
      show: s,
    } = latest.current;
    const set = (id: string, data: FeatureCollection | null) => {
      const src = m.getSource(id) as
        { setData(d: FeatureCollection): void } | undefined;
      if (src) src.setData(data ?? EMPTY);
      else m.addSource(id, { type: "geojson", data: data ?? EMPTY });
    };
    set("nd-routes", r ? flatten(r, e) : null);
    set("nd-tide", t);
    set("nd-levees", l);
    const ink = cssColor("--ink"),
      brand = cssColor("--brand"),
      sev2 = cssColor("--sev-2"),
      sev3 = cssColor("--sev-3"),
      surface = cssColor("--surface");
    const add = (spec: Parameters<MapLibreMap["addLayer"]>[0]) => {
      if (!m.getLayer(spec.id)) m.addLayer(spec);
    };
    // order: ground shading, levees, routes on top
    add({
      id: "tide-wet",
      type: "fill",
      source: "nd-tide",
      filter: ["==", ["get", "kind"], "wet"],
      paint: { "fill-color": brand, "fill-opacity": 0.4 },
    });
    add({
      id: "tide-marginal",
      type: "fill",
      source: "nd-tide",
      filter: ["==", ["get", "kind"], "marginal"],
      paint: { "fill-color": brand, "fill-opacity": 0.14 },
    });
    add({
      id: "tide-low",
      type: "line",
      source: "nd-tide",
      filter: ["==", ["get", "kind"], "low_spot"],
      paint: { "line-color": brand, "line-width": 2, "line-dasharray": [2, 2] },
    });
    add({
      id: "levee-area",
      type: "fill",
      source: "nd-levees",
      filter: ["==", ["get", "kind"], "area"],
      paint: { "fill-color": ink, "fill-opacity": 0.06 },
    });
    add({
      id: "levee-area-line",
      type: "line",
      source: "nd-levees",
      filter: ["==", ["get", "kind"], "area"],
      paint: { "line-color": ink, "line-width": 1.5, "line-dasharray": [1, 2] },
    });
    add({
      id: "levee-line",
      type: "line",
      source: "nd-levees",
      filter: ["==", ["get", "kind"], "levee"],
      paint: { "line-color": ink, "line-width": 3 },
    });
    add({
      id: "levee-wall",
      type: "line",
      source: "nd-levees",
      filter: ["==", ["get", "kind"], "floodwall"],
      paint: { "line-color": ink, "line-width": 5, "line-dasharray": [1, 1] },
    });
    add({
      id: "levee-point",
      type: "circle",
      source: "nd-levees",
      filter: ["in", ["get", "kind"], ["literal", ["closure", "pump"]]],
      paint: {
        "circle-radius": 5,
        "circle-color": surface,
        "circle-stroke-color": ink,
        "circle-stroke-width": 2,
      },
    });
    add({
      id: "mud-casing",
      type: "line",
      source: "nd-routes",
      filter: [">=", ["get", "flag"], 1],
      paint: { "line-color": surface, "line-width": 9 },
      layout: { "line-cap": "round" },
    });
    add({
      id: "mud-inspect",
      type: "line",
      source: "nd-routes",
      filter: ["==", ["get", "flag"], 1],
      paint: { "line-color": sev2, "line-width": 4, "line-dasharray": [2, 1] },
      layout: { "line-cap": "butt" },
    });
    add({
      id: "mud-hold",
      type: "line",
      source: "nd-routes",
      filter: ["==", ["get", "flag"], 2],
      paint: { "line-color": sev3, "line-width": 5 },
      layout: { "line-cap": "round" },
    });
    const vis = (ids: string[], on: boolean) =>
      ids.forEach(
        (id) =>
          m.getLayer(id) &&
          m.setLayoutProperty(id, "visibility", on ? "visible" : "none"),
      );
    vis(["mud-casing", "mud-inspect", "mud-hold"], s.routes);
    vis(["tide-wet", "tide-marginal", "tide-low"], s.tide);
    vis(
      [
        "levee-area",
        "levee-area-line",
        "levee-line",
        "levee-wall",
        "levee-point",
      ],
      s.levees,
    );
  }

  useEffect(() => {
    const el = node.current;
    if (!el) return;
    let instance: MapLibreMap;
    try {
      instance = new MapLibreMap({
        container: el,
        style: basemapStyle,
        center: [center.longitude, center.latitude],
        zoom: 13,
        minZoom: 8,
        maxZoom: 18,
        dragRotate: false,
        attributionControl: false,
        cooperativeGestures: true,
      });
    } catch {
      onUnavailable();
      return;
    }
    map.current = instance;
    instance.touchZoomRotate.disableRotation();
    instance.addControl(
      new NavigationControl({ showCompass: false }),
      "top-right",
    );
    instance.addControl(new ScaleControl({ unit: "imperial" }), "bottom-left");
    instance.addControl(
      new AttributionControl({ compact: true }),
      "bottom-right",
    );
    new Marker({ element: centerMarkerElement() })
      .setLngLat([center.longitude, center.latitude])
      .addTo(instance);

    let fellBack = false;
    const fallBack = () => {
      if (fellBack || ready.current) return;
      fellBack = true;
      instance.setStyle(offlineStyle());
    };
    instance.on("style.load", () => {
      ready.current = true;
      sync();
    });
    instance.on("error", fallBack);
    const timer = setTimeout(fallBack, 8000);

    const popup = new Popup({
      closeButton: true,
      closeOnClick: true,
      maxWidth: "none",
    });
    instance.on("click", ["mud-hold", "mud-inspect"], (event) => {
      const p = event.features?.[0]?.properties;
      if (!p) return;
      popup
        .setLngLat(event.lngLat)
        .setDOMContent(
          popupContent([
            `${FLAGS[Number(p.flag)] ?? "ok"} · ${p.highway ?? "unpaved way"}${p.name ? ` · ${p.name}` : ""}`,
            p.rut !== null && p.rut !== undefined
              ? `Predicted rut depth about ${Number(p.rut).toFixed(1)} in (inspect at 4 in, hold at 8 in).`
              : "Rut depth not available for this equipment.",
            `Score ${p.score ?? "n/a"} of 10 · ${p.length_ft} ft long.`,
          ]),
        )
        .addTo(instance);
    });
    for (const id of ["mud-hold", "mud-inspect"]) {
      instance.on(
        "mouseenter",
        id,
        () => (instance.getCanvas().style.cursor = "pointer"),
      );
      instance.on(
        "mouseleave",
        id,
        () => (instance.getCanvas().style.cursor = ""),
      );
    }
    return () => {
      clearTimeout(timer);
      ready.current = false;
      popup.remove();
      map.current = null;
      instance.remove();
    };
    // one map per site; the parent keys this component by site
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(sync, [routes, tide, levees, equipment, show]);

  // Frame the flagged routes once they arrive.
  useEffect(() => {
    const m = map.current;
    if (!m || !routes?.features.length) return;
    let minX = 180,
      minY = 90,
      maxX = -180,
      maxY = -90;
    for (const f of routes.features) {
      const coords = (f.geometry as { coordinates: number[][] }).coordinates;
      for (const [x, y] of coords) {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }
    m.fitBounds(
      [
        [minX, minY],
        [maxX, maxY],
      ],
      { padding: 40, maxZoom: 15, duration: 0 },
    );
  }, [routes]);

  return (
    <div className={styles.mapBox}>
      <div
        ref={node}
        role="img"
        aria-label="Map of flagged routes, tide shading and levees near the site. The same facts are listed below the map."
      />
    </div>
  );
}
