import { useEffect, useRef, type KeyboardEvent } from "react";
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
  /** Escape while picking. */
  onCancel: () => void;
  endpoints: { a: LngLat | null; b: LngLat | null };
  paths: { direct: LngLat[] | null; detour: LngLat[] | null };
  /** The road (OpenStreetMap way) picked in the route table: drawn on top, and the map zooms to it. */
  selectedWay: number | null;
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
          osm_id: f.properties?.osm_id,
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

/** South-west and north-east corners around some line features, or null when there are none. */
function boundsOf(
  features: Feature[],
): [[number, number], [number, number]] | null {
  let minX = 180,
    minY = 90,
    maxX = -180,
    maxY = -90;
  let any = false;
  for (const f of features) {
    const coords = (f.geometry as { coordinates?: number[][] } | null)
      ?.coordinates;
    for (const [x, y] of coords ?? []) {
      any = true;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }
  return any
    ? [
        [minX, minY],
        [maxX, maxY],
      ]
    : null;
}

const reducedMotion = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

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
  onCancel,
  endpoints,
  paths,
  selectedWay,
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
    selectedWay,
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
      selectedWay,
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
      selectedWay: way,
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
      brand = cssColor("--accent"),
      sev2 = cssColor("--severity-2"),
      sev3 = cssColor("--severity-3"),
      surface = cssColor("--bg");
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
    // The road picked in the route table: an ink halo with the result colour on top. The filter follows selectedWay.
    add({
      id: "mud-select-halo",
      type: "line",
      source: "nd-routes",
      filter: ["==", ["get", "osm_id"], way ?? -1],
      paint: { "line-color": ink, "line-width": 13 },
      layout: { "line-cap": "round", "line-join": "round" },
    });
    add({
      id: "mud-select",
      type: "line",
      source: "nd-routes",
      filter: ["==", ["get", "osm_id"], way ?? -1],
      paint: {
        "line-color": ["case", ["==", ["get", "flag"], 2], sev3, sev2],
        "line-width": 7,
      },
      layout: { "line-cap": "round", "line-join": "round" },
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
    vis(
      [
        "mud-casing",
        "mud-inspect",
        "mud-hold",
        "mud-select-halo",
        "mud-select",
      ],
      s.routes,
    );
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
              ? `Predicted rut depth about ${Number(p.rut).toFixed(1)} in. Inspect starts at 4 in and hold at 8 in; a soil rating or wet ground can set a higher result.`
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

  // Highlight the picked road and zoom to it.
  useEffect(() => {
    const m = map.current;
    if (!m || !ready.current) return;
    const filter: ["==", ["get", string], number] = [
      "==",
      ["get", "osm_id"],
      selectedWay ?? -1,
    ];
    for (const id of ["mud-select-halo", "mud-select"])
      if (m.getLayer(id)) m.setFilter(id, filter);
    if (selectedWay === null || !routes) return;
    const box = boundsOf(
      routes.features.filter((f) => f.properties?.osm_id === selectedWay),
    );
    if (box)
      m.fitBounds(box, {
        padding: 70,
        maxZoom: 17,
        duration: reducedMotion() ? 0 : 500,
      });
  }, [selectedWay, routes]);

  const crosshair = useRef<Marker | null>(null);
  const cancelRef = useRef(onCancel);
  useEffect(() => {
    cancelRef.current = onCancel;
  });

  // Keyboard picking: while picking, a crosshair starts at the map centre. Arrow keys move it (Shift moves it
  // further), Enter picks the point and Escape cancels. The map's own arrow-key panning is off meanwhile.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    if (!picking) {
      m.keyboard.enable();
      return;
    }
    m.keyboard.disable();
    const el = document.createElement("div");
    el.className = styles.crosshair;
    el.setAttribute("aria-hidden", "true");
    crosshair.current = new Marker({ element: el })
      .setLngLat(m.getCenter())
      .addTo(m);
    node.current?.focus({ preventScroll: true });
    return () => {
      crosshair.current?.remove();
      crosshair.current = null;
    };
  }, [picking]);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const m = map.current;
    const mark = crosshair.current;
    if (!picking || !m || !mark) return;
    if (event.key === "Escape") {
      event.preventDefault();
      cancelRef.current();
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const at = mark.getLngLat();
      latest.current.onPick([at.lng, at.lat]);
      return;
    }
    const direction: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, 1],
      ArrowDown: [0, -1],
    };
    const d = direction[event.key];
    if (!d) return;
    event.preventDefault();
    const view = m.getBounds();
    const step = event.shiftKey ? 0.2 : 0.05;
    const at = mark.getLngLat();
    const next = {
      lng: at.lng + d[0] * (view.getEast() - view.getWest()) * step,
      lat: at.lat + d[1] * (view.getNorth() - view.getSouth()) * step,
    };
    mark.setLngLat(next);
    if (!view.contains(next)) m.panTo(next, { duration: 0 });
  }

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
        "width:26px;height:26px;border-radius:50%;background:var(--accent);color:var(--bg);display:grid;place-items:center;font:600 13px var(--font-sans);border:2px solid var(--bg)";
      pins.current[k] = new Marker({ element: el }).setLngLat(at).addTo(m);
    });
  }, [picking, endpoints]);

  // Frame the flagged routes once they arrive.
  useEffect(() => {
    const m = map.current;
    if (!m || !routes?.features.length) return;
    const box = boundsOf(routes.features);
    if (box) m.fitBounds(box, { padding: 40, maxZoom: 15, duration: 0 });
  }, [routes]);

  return (
    <div className={styles.mapBox}>
      <div
        ref={node}
        role="region"
        aria-label="Map of flagged routes, tide shading and levees near the site. The same facts are listed below the map."
        tabIndex={picking ? 0 : -1}
        onKeyDown={onKeyDown}
      />
    </div>
  );
}
