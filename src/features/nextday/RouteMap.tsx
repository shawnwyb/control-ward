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

export type Layers = {
  routes: boolean;
  tide: boolean;
  levees: boolean;
  wildlife: boolean;
  crew: boolean;
};

/** Open crew reports of types the map shows: mud and wildlife. */
export type CrewPoint = {
  id: string;
  latitude: number;
  longitude: number;
  type: string;
  severity: number;
};

export type LngLat = [number, number];

type Props = {
  center: { latitude: number; longitude: number };
  routes: FeatureCollection | null;
  tide: FeatureCollection | null;
  levees: FeatureCollection | null;
  wildlife: FeatureCollection | null;
  crew: CrewPoint[];
  equipment: string;
  show: Layers;
  /** While true, a click on the map picks a detour start or end instead of opening a route card. */
  picking: boolean;
  onPick: (point: LngLat) => void;
  endpoints: { a: LngLat | null; b: LngLat | null };
  paths: { direct: LngLat[] | null; detour: LngLat[] | null };
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
  wildlife,
  crew,
  equipment,
  show,
  picking,
  onPick,
  endpoints,
  paths,
  onUnavailable,
}: Props) {
  const node = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const ready = useRef(false);
  const latest = useRef({
    routes,
    tide,
    levees,
    wildlife,
    crew,
    equipment,
    show,
    picking,
    onPick,
    paths,
  });
  useEffect(() => {
    latest.current = {
      routes,
      tide,
      levees,
      wildlife,
      crew,
      equipment,
      show,
      picking,
      onPick,
      paths,
    };
  });
  const pins = useRef<{ a: Marker | null; b: Marker | null }>({
    a: null,
    b: null,
  });

  function sync() {
    const m = map.current;
    if (!m || !ready.current) return;
    const {
      routes: r,
      tide: t,
      levees: l,
      wildlife: w,
      crew: c,
      equipment: e,
      show: s,
      paths: p,
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
    set("nd-wild", w);
    set(
      "nd-crew",
      c.length
        ? {
            type: "FeatureCollection",
            features: c.map((x) => ({
              type: "Feature",
              geometry: {
                type: "Point",
                coordinates: [x.longitude, x.latitude],
              },
              properties: { id: x.id, type: x.type, severity: x.severity },
            })),
          }
        : null,
    );
    const line = (coords: LngLat[] | null): FeatureCollection =>
      coords && coords.length > 1
        ? {
            type: "FeatureCollection",
            features: [
              {
                type: "Feature",
                geometry: { type: "LineString", coordinates: coords },
                properties: {},
              },
            ],
          }
        : EMPTY;
    set("nd-direct", line(p.direct));
    set("nd-detour", line(p.detour));
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
    add({
      id: "wild-point",
      type: "circle",
      source: "nd-wild",
      paint: {
        "circle-radius": 4.5,
        "circle-color": surface,
        "circle-stroke-color": ink,
        "circle-stroke-width": 2,
      },
    });
    add({
      id: "crew-point",
      type: "circle",
      source: "nd-crew",
      paint: {
        "circle-radius": 7,
        "circle-color": ["case", ["==", ["get", "type"], "mud"], sev2, ink],
        "circle-stroke-color": surface,
        "circle-stroke-width": 2.5,
      },
    });
    add({
      id: "detour-casing",
      type: "line",
      source: "nd-detour",
      paint: { "line-color": surface, "line-width": 9 },
      layout: { "line-cap": "round", "line-join": "round" },
    });
    add({
      id: "detour-direct",
      type: "line",
      source: "nd-direct",
      paint: { "line-color": ink, "line-width": 3, "line-dasharray": [1, 2] },
    });
    add({
      id: "detour-line",
      type: "line",
      source: "nd-detour",
      paint: { "line-color": brand, "line-width": 5 },
      layout: { "line-cap": "round", "line-join": "round" },
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
    // While a detour start or end is being picked, every click is a pick and no card opens.
    instance.on("click", (event) => {
      if (latest.current.picking)
        latest.current.onPick([event.lngLat.lng, event.lngLat.lat]);
    });
    instance.on("click", ["wild-point", "crew-point"], (event) => {
      if (latest.current.picking) return;
      const feature = event.features?.[0];
      const p = feature?.properties;
      if (!feature || !p) return;
      const lines =
        feature.layer.id === "crew-point"
          ? [
              `Crew report: ${p.type === "mud" ? "mud or rut" : p.type}`,
              `Severity ${p.severity} of 3.`,
            ]
          : [
              `${p.name ?? "Sighting"} (iNaturalist)`,
              `Seen ${p.date ?? "on an unknown date"}.`,
            ];
      popup
        .setLngLat(event.lngLat)
        .setDOMContent(popupContent(lines))
        .addTo(instance);
    });
    instance.on("click", ["mud-hold", "mud-inspect"], (event) => {
      if (latest.current.picking) return;
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
    for (const id of ["mud-hold", "mud-inspect", "wild-point", "crew-point"]) {
      instance.on("mouseenter", id, () => {
        if (!latest.current.picking)
          instance.getCanvas().style.cursor = "pointer";
      });
      instance.on("mouseleave", id, () => {
        instance.getCanvas().style.cursor = latest.current.picking
          ? "crosshair"
          : "";
      });
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

  useEffect(sync, [
    routes,
    tide,
    levees,
    wildlife,
    crew,
    equipment,
    show,
    paths,
  ]);

  // Start and end pins for the detour, and a crosshair while the manager is picking.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    m.getCanvas().style.cursor = picking ? "crosshair" : "";
    (["a", "b"] as const).forEach((k) => {
      const at = endpoints[k];
      pins.current[k]?.remove();
      pins.current[k] = null;
      if (!at) return;
      const el = document.createElement("div");
      el.textContent = k.toUpperCase();
      el.setAttribute("aria-hidden", "true");
      el.style.cssText =
        "width:26px;height:26px;border-radius:50%;background:var(--brand);color:var(--brand-ink);display:grid;place-items:center;font:600 13px var(--font-sans);border:2px solid var(--surface)";
      pins.current[k] = new Marker({ element: el }).setLngLat(at).addTo(m);
    });
  }, [picking, endpoints]);

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
