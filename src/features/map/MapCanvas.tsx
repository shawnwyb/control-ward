import { useEffect, useRef, type KeyboardEvent } from "react";
import {
  AttributionControl,
  Marker,
  MapLibreMap,
  NavigationControl,
  Popup,
  ScaleControl,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  extentCorners,
  extentPolygon,
  nudge,
  ringPolygon,
} from "../../lib/geo";
import { type Report, type Site } from "../../lib/types";
import type { CrewMember } from "../../lib/monitoring";
import { timeAgo } from "../../lib/format";
import { basemapStyle, offlineStyle } from "./mapStyle";
import {
  centerMarkerElement,
  hazardCardElement,
  crewMarkerElement,
  hazardMarkerElement,
  pinMarkerElement,
} from "./markers";
import { forecastBounds } from "./weather/forecast";
import type { WeatherView } from "./weather/types";
import { applyWeather } from "./weather/weatherLayer";
import { WindParticles } from "./weather/windParticles";
import styles from "./MapCanvas.module.css";

export type MapCanvasProps = {
  site: Site;
  reports: Report[];
  /** Supervisors only: last known worker positions. */
  crew?: CrewMember[];
  /** Pan to a worker and open their card. */
  crewFocus?: { id: string; nonce: number };
  pin: { latitude: number; longitude: number };
  disabled: boolean;
  /** Hazard linked to a hovered feed row: ringed on the map with its card open. */
  highlightId?: string | null;
  /** A feed row was clicked: pan to its marker. `nonce` re-fires the same id. */
  focusRequest?: { id: string; nonce: number };
  /** Weather to show; null or absent means no overlay. */
  weather?: WeatherView | null;
  /** Weather is on: frame the whole forecast area instead of the site. */
  regional?: boolean;
  onPin: (latitude: number, longitude: number) => void;
  onUnavailable: () => void;
};

const arrowKeys = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];
const cssColor = (name: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export default function MapCanvas({
  site,
  reports,
  crew,
  crewFocus,
  pin,
  disabled,
  highlightId,
  focusRequest,
  weather,
  regional,
  onPin,
  onUnavailable,
}: MapCanvasProps) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const pinMarker = useRef<Marker | null>(null);
  const hazardMarkers = useRef(
    new Map<string, { marker: Marker; key: string; report: Report }>(),
  );
  const crewMarkers = useRef(
    new Map<string, { marker: Marker; key: string }>(),
  );
  const popup = useRef<Popup | null>(null);
  const openCard = useRef<string | null>(null);
  // Handlers read the latest props without re-creating the map.
  const latest = useRef({ disabled, onPin, pin, weather });
  useEffect(() => {
    latest.current = { disabled, onPin, pin, weather };
  });
  // The basemap style is (re)loaded asynchronously; overlays wait for it.
  const styleLoaded = useRef(false);

  // One shared hover card, filled from the latest copy of the report.
  function showCard(id: string) {
    const entry = hazardMarkers.current.get(id);
    const instance = map.current;
    if (!entry || !instance || !popup.current) return;
    openCard.current = id;
    popup.current
      .setLngLat([entry.report.longitude, entry.report.latitude])
      .setDOMContent(hazardCardElement(entry.report))
      .addTo(instance);
  }
  function hideCard() {
    openCard.current = null;
    popup.current?.remove();
  }

  useEffect(() => {
    const node = container.current;
    if (!node) return;
    let instance: MapLibreMap;
    try {
      const { southWest, northEast } = extentCorners(site);
      instance = new MapLibreMap({
        container: node,
        style: basemapStyle,
        bounds: [
          [southWest.longitude, southWest.latitude],
          [northEast.longitude, northEast.latitude],
        ],
        fitBoundsOptions: { padding: 24 },
        // Low enough to zoom out to weather scale (a few hundred km).
        minZoom: 5,
        maxZoom: 19,
        // Arrow keys are the pin's; the map must not pan on them.
        keyboard: false,
        dragRotate: false,
        pitchWithRotate: false,
        attributionControl: false,
        // Phones: one finger scrolls the page, two move the map.
        cooperativeGestures: true,
      });
    } catch {
      onUnavailable(); // no WebGL
      return;
    }
    map.current = instance;
    instance.touchZoomRotate.disableRotation();
    instance.getCanvas().tabIndex = -1;
    instance.addControl(
      new NavigationControl({ showCompass: false }),
      "top-right",
    );
    instance.addControl(new ScaleControl({ unit: "metric" }), "bottom-left");
    instance.addControl(
      new AttributionControl({ compact: true }),
      "bottom-right",
    );
    // Start collapsed so credits don't cover the map; one tap opens them.
    // MapLibre re-opens the control while loading, so collapse once it is idle.
    instance.once("idle", () => {
      const attribution = node.querySelector(".maplibregl-ctrl-attrib");
      attribution?.removeAttribute("open");
      attribution?.classList.remove("maplibregl-compact-show");
    });

    // Site area: dashed 300 m ring and the 1200 m × 800 m extent.
    const addOverlays = () => {
      const ink = cssColor("--ink");
      // Quiet the basemap's labels so they never compete with hazard markers.
      for (const layer of instance.getStyle().layers)
        if (layer.type === "symbol") {
          instance.setPaintProperty(layer.id, "text-opacity", 0.55);
          instance.setPaintProperty(layer.id, "icon-opacity", 0.55);
        }
      const sources: [string, ReturnType<typeof ringPolygon>][] = [
        ["site-extent", extentPolygon(site)],
        ["site-ring", ringPolygon(site)],
      ];
      for (const [id, data] of sources)
        if (!instance.getSource(id))
          instance.addSource(id, { type: "geojson", data });
      if (!instance.getLayer("site-extent"))
        instance.addLayer({
          id: "site-extent",
          type: "line",
          source: "site-extent",
          paint: { "line-color": ink, "line-width": 1.5, "line-opacity": 0.55 },
        });
      if (!instance.getLayer("site-ring"))
        instance.addLayer({
          id: "site-ring",
          type: "line",
          source: "site-ring",
          paint: {
            // Neutral: brand blue means "you" (the pin), not "the site".
            "line-color": ink,
            "line-width": 2,
            "line-dasharray": [2, 2],
          },
        });
    };
    let styleReady = false;
    let fellBack = false;
    const useOfflineStyle = () => {
      if (fellBack) return;
      fellBack = true;
      instance.setStyle(offlineStyle());
    };
    instance.on("style.load", () => {
      styleReady = true;
      styleLoaded.current = true;
      addOverlays();
      // A new style (e.g. the offline fallback) drops our sources: put weather back.
      applyWeather(instance, latest.current.weather ?? null);
    });
    // Basemap unreachable: keep the overlays on a plain ground instead of a blank box.
    instance.on("error", () => {
      if (!styleReady) useOfflineStyle();
    });
    const timeout = setTimeout(() => {
      if (!styleReady) useOfflineStyle();
    }, 8000);

    popup.current = new Popup({
      closeButton: false,
      closeOnClick: false,
      closeOnMove: false,
      focusAfterOpen: false,
      offset: 22,
      maxWidth: "none",
      className: styles.popup,
    });

    instance.on("click", (event) => {
      // A tap on the map first dismisses an open card (touch has no hover).
      if (openCard.current) return hideCard();
      if (latest.current.disabled) return;
      latest.current.onPin(event.lngLat.lat, event.lngLat.lng);
    });

    new Marker({ element: centerMarkerElement() })
      .setLngLat([site.longitude, site.latitude])
      .addTo(instance);

    const marker = new Marker({ element: pinMarkerElement(), draggable: true })
      .setLngLat([latest.current.pin.longitude, latest.current.pin.latitude])
      .addTo(instance);
    marker.on("dragend", () => {
      const { lat, lng } = marker.getLngLat();
      latest.current.onPin(lat, lng);
    });
    pinMarker.current = marker;

    const markers = hazardMarkers.current;
    return () => {
      clearTimeout(timeout);
      styleLoaded.current = false;
      wind.current?.destroy();
      wind.current = null;
      savedCamera.current = null;
      popup.current?.remove();
      popup.current = null;
      openCard.current = null;
      markers.clear();
      pinMarker.current = null;
      map.current = null;
      instance.remove();
    };
    // The map is created once per site (SiteMap is keyed by site).
  }, [site.id]);

  // Keep the pin marker in step with the coordinate inputs.
  useEffect(() => {
    const marker = pinMarker.current;
    const instance = map.current;
    if (!marker || !instance) return;
    if (!Number.isFinite(pin.latitude) || !Number.isFinite(pin.longitude))
      return;
    marker.setLngLat([pin.longitude, pin.latitude]);
    marker.setDraggable(!disabled);
    if (!instance.getBounds().contains([pin.longitude, pin.latitude]))
      instance.easeTo({ center: [pin.longitude, pin.latitude] });
  }, [pin.latitude, pin.longitude, disabled]);

  // Weather overlay: raster layers follow the frames and the scrubber.
  useEffect(() => {
    const instance = map.current;
    if (instance && styleLoaded.current)
      applyWeather(instance, weather ?? null);
  }, [weather]);

  // Wind is a canvas of moving streaks, not a raster layer.
  const wind = useRef<WindParticles | null>(null);
  useEffect(() => {
    const instance = map.current;
    if (!instance || weather?.kind !== "wind") {
      wind.current?.destroy();
      wind.current = null;
      return;
    }
    if (!wind.current)
      wind.current = new WindParticles(
        instance,
        window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      );
    wind.current.setField(weather.grid, weather.index);
  }, [weather]);

  // Weather is regional: zoom out to the forecast area, and back when it's turned off.
  const savedCamera = useRef<{ center: [number, number]; zoom: number } | null>(
    null,
  );
  useEffect(() => {
    const instance = map.current;
    if (!instance) return;
    const duration = window.matchMedia("(prefers-reduced-motion: reduce)")
      .matches
      ? 0
      : 700;
    if (regional && !savedCamera.current) {
      const center = instance.getCenter();
      savedCamera.current = {
        center: [center.lng, center.lat],
        zoom: instance.getZoom(),
      };
      const { west, south, east, north } = forecastBounds(site);
      instance.fitBounds(
        [
          [west, south],
          [east, north],
        ],
        { padding: 8, duration },
      );
    } else if (!regional && savedCamera.current) {
      instance.easeTo({ ...savedCamera.current, duration });
      savedCamera.current = null;
    }
  }, [regional, site]);

  // Active hazards as shape markers.
  useEffect(() => {
    const instance = map.current;
    if (!instance) return;
    const markers = hazardMarkers.current;
    const active = reports.filter((report) => report.is_active);
    const live = new Set(active.map((report) => report.id));
    for (const [id, entry] of markers)
      if (!live.has(id)) {
        entry.marker.remove();
        markers.delete(id);
        if (openCard.current === id) hideCard();
      }
    for (const report of active) {
      const key = `${report.severity}:${report.type}:${report.latitude}:${report.longitude}`;
      const existing = markers.get(report.id);
      if (existing?.key === key) {
        existing.report = report;
        // Keep an open card current (confirmations, last confirmed).
        if (openCard.current === report.id) showCard(report.id);
        continue;
      }
      existing?.marker.remove();
      const element = hazardMarkerElement(report);
      // Hover is mouse-only; touch taps open the card via click.
      element.addEventListener("pointerenter", (event) => {
        if (event.pointerType === "mouse") showCard(report.id);
      });
      element.addEventListener("pointerleave", (event) => {
        if (event.pointerType === "mouse") hideCard();
      });
      element.addEventListener("click", (event) => {
        event.stopPropagation(); // inspecting a hazard must not move the pin
        showCard(report.id);
      });
      const marker = new Marker({ element })
        .setLngLat([report.longitude, report.latitude])
        .addTo(instance);
      markers.set(report.id, { marker, key, report });
      if (openCard.current === report.id) showCard(report.id);
    }
  }, [reports]);

  // Last known worker positions (supervisors only).
  useEffect(() => {
    const instance = map.current;
    if (!instance) return;
    const markers = crewMarkers.current;
    const located = (crew ?? []).filter(
      (member) => member.latitude !== null && member.longitude !== null,
    );
    const live = new Set(located.map((member) => member.user_id));
    for (const [id, entry] of markers)
      if (!live.has(id)) {
        entry.marker.remove();
        markers.delete(id);
      }
    for (const member of located) {
      const key = `${member.latitude}:${member.longitude}:${member.is_stale}:${member.located_at}`;
      const existing = markers.get(member.user_id);
      if (existing?.key === key) continue;
      existing?.marker.remove();
      const card = document.createElement("div");
      const strong = document.createElement("strong");
      strong.textContent = member.name;
      const when = document.createElement("div");
      when.textContent = member.located_at
        ? `Last seen ${timeAgo(member.located_at)}`
        : "Location unknown";
      card.append(strong, when);
      const marker = new Marker({
        element: crewMarkerElement(member.name, member.is_stale),
      })
        .setLngLat([member.longitude!, member.latitude!])
        .setPopup(
          new Popup({ offset: 16, closeButton: false }).setDOMContent(card),
        )
        .addTo(instance);
      markers.set(member.user_id, { marker, key });
    }
  }, [crew]);

  useEffect(() => {
    if (!crewFocus) return;
    const entry = crewMarkers.current.get(crewFocus.id);
    const instance = map.current;
    if (!entry || !instance) return;
    instance.easeTo({
      center: entry.marker.getLngLat(),
      zoom: Math.max(instance.getZoom(), 15),
    });
    if (!entry.marker.getPopup()?.isOpen()) entry.marker.togglePopup();
  }, [crewFocus]);

  // A hovered feed row rings its marker and opens the same card as hovering the marker.
  const rowCard = useRef<string | null>(null);
  useEffect(() => {
    const markers = hazardMarkers.current;
    for (const [id, entry] of markers)
      entry.marker
        .getElement()
        .classList.toggle(styles.highlight, id === highlightId);
    if (highlightId && markers.has(highlightId)) {
      rowCard.current = highlightId;
      showCard(highlightId);
    } else if (rowCard.current) {
      if (openCard.current === rowCard.current) hideCard();
      rowCard.current = null;
    }
  }, [highlightId, reports]);

  // A clicked feed row brings its marker to the middle of the map.
  useEffect(() => {
    if (!focusRequest) return;
    const entry = hazardMarkers.current.get(focusRequest.id);
    if (!entry) return;
    map.current?.easeTo({
      center: [entry.report.longitude, entry.report.latitude],
      duration: 350,
    });
  }, [focusRequest]);

  function move(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") return hideCard();
    if (disabled || !arrowKeys.includes(event.key)) return;
    event.preventDefault();
    const distance = event.shiftKey ? 100 : 10;
    const north =
      event.key === "ArrowUp"
        ? distance
        : event.key === "ArrowDown"
          ? -distance
          : 0;
    const east =
      event.key === "ArrowRight"
        ? distance
        : event.key === "ArrowLeft"
          ? -distance
          : 0;
    const next = nudge(site, pin.latitude, pin.longitude, north, east);
    onPin(next.latitude, next.longitude);
  }

  return (
    <div
      ref={container}
      id="pin-map"
      className={styles.map}
      role="application"
      tabIndex={0}
      aria-label="Site pin map. Click to place a pin, or use arrow keys to move it."
      onKeyDown={move}
    />
  );
}
