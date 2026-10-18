import { useEffect, useRef, type KeyboardEvent, useState } from "react";
import {
  AttributionControl,
  type GeoJSONSource,
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
  offsetPoint,
  ringPolygon,
} from "../../lib/geo";
import { type Report, type Site } from "../../lib/types";
import type { CrewMember } from "../../lib/monitoring";
import type { SiteSummary } from "../../lib/sites";
import { timeAgo } from "../../lib/format";
import { basemapStyle, offlineStyle } from "./mapStyle";
import {
  centerMarkerElement,
  hazardCardElement,
  crewMarkerElement,
  hazardMarkerElement,
  pinMarkerElement,
  setSitePinSelected,
  sitePinElement,
  stopWorkMarkerElement,
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
  /** The report pin is shown and movable only while a report is being placed. */
  pinActive: boolean;
  disabled: boolean;
  /** Hazard linked to a hovered feed row: ringed on the map with its card open. */
  highlightId?: string | null;
  /** A feed row was clicked: pan to its marker. `nonce` re-fires the same id. */
  focusRequest?: { id: string; nonce: number };
  /** Weather to show; null or absent means no overlay. */
  weather?: WeatherView | null;
  /** Weather is on: frame the whole forecast area instead of the site. */
  regional?: boolean;
  /** Every site the user can see, drawn as score pins (sites without coordinates are skipped). */
  sites?: SiteSummary[];
  /** A site pin was clicked or pressed. */
  onSelectSite?: (siteId: string) => void;
  /** The site is in lightning stop-work: draw the 10-mile ring and a bolt. */
  stopWork?: boolean;
  /** Frame the whole 10-mile ring once each time the site enters stop-work. */
  fitStopWork?: boolean;
  onPin: (latitude: number, longitude: number) => void;
  onUnavailable: () => void;
};

/** Lightning stop-work radius: 10 miles. */
export const STOP_WORK_RADIUS_M = 16093;

const arrowKeys = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];
const cssColor = (name: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const reducedMotion = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** The camera that frames a site's 1200 m × 800 m extent. */
function siteBounds(site: Site): [[number, number], [number, number]] {
  const { southWest, northEast } = extentCorners(site);
  return [
    [southWest.longitude, southWest.latitude],
    [northEast.longitude, northEast.latitude],
  ];
}

/** Where the bolt sits: on the stop-work ring, due east of the site (clear of the chips and controls). */
function boltPoint(site: Site): [number, number] {
  const point = offsetPoint(site, 0, STOP_WORK_RADIUS_M);
  return [point.longitude, point.latitude];
}

export default function MapCanvas({
  site,
  reports,
  crew,
  crewFocus,
  pin,
  pinActive,
  disabled,
  highlightId,
  focusRequest,
  weather,
  regional,
  sites,
  onSelectSite,
  stopWork = false,
  fitStopWork = false,
  onPin,
  onUnavailable,
}: MapCanvasProps) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const pinMarker = useRef<Marker | null>(null);
  const hazardMarkers = useRef(
    new Map<string, { marker: Marker; key: string; report: Report }>(),
  );
  const crewMarkers = useRef(
    new Map<string, { marker: Marker; key: string }>(),
  );
  const sitePins = useRef(new Map<string, { marker: Marker; key: string }>());
  const centerMarker = useRef<Marker | null>(null);
  const boltMarker = useRef<Marker | null>(null);
  const popup = useRef<Popup | null>(null);
  const openCard = useRef<string | null>(null);
  // Focus asked for before its marker exists (a freshly mounted map, a roster still loading).
  const pendingCrew = useRef<string | null>(null);
  const pendingHazard = useRef<string | null>(null);
  // Handlers read the latest props without re-creating the map.
  const latest = useRef({
    pinActive,
    disabled,
    onPin,
    pin,
    weather,
    site,
    stopWork,
    onSelectSite,
  });
  useEffect(() => {
    latest.current = {
      pinActive,
      disabled,
      onPin,
      pin,
      weather,
      site,
      stopWork,
      onSelectSite,
    };
  });
  // The basemap style is (re)loaded asynchronously; overlays wait for it.
  const styleLoaded = useRef(false);
  const wind = useRef<WindParticles | null>(null);
  // Where to return when the regional weather view is turned off.
  const savedCamera = useRef<{ center: [number, number]; zoom: number } | null>(
    null,
  );

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

  // Created once and kept across site switches: a new site flies the camera instead.
  useEffect(() => {
    const node = container.current;
    if (!node) return;
    let instance: MapLibreMap;
    try {
      instance = new MapLibreMap({
        container: node,
        style: basemapStyle,
        bounds: siteBounds(latest.current.site),
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
    setMapReady(true);
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

    // A focused off-screen marker makes the browser scroll the map's box; keep it still.
    const unscroll = () => {
      node.scrollTop = 0;
      node.scrollLeft = 0;
    };
    node.addEventListener("scroll", unscroll);

    // Site area: dashed 300 m ring and the 1200 m × 800 m extent, plus the
    // 10-mile lightning ring (hidden unless the site is in stop-work).
    const addOverlays = () => {
      const ink = cssColor("--ink");
      const storm = cssColor("--risk-elevated") || "#d9730d";
      const current = latest.current.site;
      // Calm the basemap's labels a little so hazard markers stay loudest, but
      // keep place, road and water names readable.
      for (const layer of instance.getStyle().layers)
        if (layer.type === "symbol") {
          instance.setPaintProperty(layer.id, "text-opacity", 0.8);
          instance.setPaintProperty(layer.id, "icon-opacity", 0.6);
        }
      const sources: [string, ReturnType<typeof ringPolygon>][] = [
        ["site-extent", extentPolygon(current)],
        ["site-ring", ringPolygon(current)],
        ["stop-work", ringPolygon(current, STOP_WORK_RADIUS_M, 180)],
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
      const visibility = latest.current.stopWork ? "visible" : "none";
      if (!instance.getLayer("stop-work-fill"))
        instance.addLayer({
          id: "stop-work-fill",
          type: "fill",
          source: "stop-work",
          layout: { visibility },
          paint: { "fill-color": storm, "fill-opacity": 0.06 },
        });
      if (!instance.getLayer("stop-work-ring"))
        instance.addLayer({
          id: "stop-work-ring",
          type: "line",
          source: "stop-work",
          layout: { visibility },
          paint: {
            "line-color": storm,
            "line-width": 1.75,
            "line-dasharray": [3, 2],
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
    // Test hook: the current zoom, readable from the DOM.
    const publishZoom = () => {
      node.dataset.zoom = instance.getZoom().toFixed(2);
    };
    instance.on("moveend", publishZoom);
    publishZoom();
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
      if (latest.current.disabled || !latest.current.pinActive) return;
      latest.current.onPin(event.lngLat.lat, event.lngLat.lng);
    });

    centerMarker.current = new Marker({ element: centerMarkerElement() })
      .setLngLat([latest.current.site.longitude, latest.current.site.latitude])
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
    const workers = crewMarkers.current;
    const pins = sitePins.current;
    return () => {
      clearTimeout(timeout);
      node.removeEventListener("scroll", unscroll);
      styleLoaded.current = false;
      wind.current?.destroy();
      wind.current = null;
      savedCamera.current = null;
      popup.current?.remove();
      popup.current = null;
      openCard.current = null;
      markers.clear();
      workers.clear();
      pins.clear();
      pinMarker.current = null;
      centerMarker.current = null;
      boltMarker.current = null;
      // A new map (a dev remount) has not framed the ring yet.
      fittedFor.current = null;
      map.current = null;
      instance.remove();
    };
  }, []);

  // While the report drawer is open, the map treats the area it covers as off-limits: the pin
  // is brought into the visible part (right of the drawer, or above the phone sheet).
  const wasPinActive = useRef(false);
  const paddingSite = useRef(site.id);
  const hadPadding = useRef(false);
  useEffect(() => {
    const instance = map.current;
    const box = container.current;
    if (!instance || !box || !mapReady) return;
    const siteChanged = paddingSite.current !== site.id;
    paddingSite.current = site.id;
    const opening = pinActive && !wasPinActive.current;
    wasPinActive.current = pinActive;
    const none = { top: 0, right: 0, bottom: 0, left: 0 };
    let padding = none;
    if (pinActive) {
      const rect = box.getBoundingClientRect();
      if (window.innerWidth >= 768) {
        // Matches the drawer: min(21rem, pane - 2 gutters), plus its gutter and a margin.
        const width = Math.min(336, rect.width - 24);
        padding = { ...none, right: Math.round(width + 24) };
      } else {
        // The phone sheet is fixed to the bottom of the screen, at most 55% of its height.
        const top = window.innerHeight * 0.45;
        const covered = Math.max(0, rect.bottom - top);
        padding = {
          ...none,
          bottom: Math.round(Math.min(covered, rect.height - 120)),
        };
      }
    }
    const duration = reducedMotion() ? 0 : 350;
    const lngLat: [number, number] = [pin.longitude, pin.latitude];
    if (
      !pinActive ||
      !Number.isFinite(pin.latitude) ||
      !Number.isFinite(pin.longitude)
    ) {
      // Closing: reset the padding without animating the camera, so a site fly-to that
      // started in this same commit (a site switch closes the drawer) is not cancelled.
      // (This effect runs before the fly-to effect, so the flight starts from zero padding.)
      if (hadPadding.current) {
        if (siteChanged) instance.setPadding(padding);
        else instance.easeTo({ padding, duration });
      }
      hadPadding.current = false;
      return;
    }
    const point = instance.project(lngLat);
    const inside =
      point.x >= 30 &&
      point.x <= box.clientWidth - padding.right - 30 &&
      point.y >= 30 &&
      point.y <= box.clientHeight - padding.bottom - 30;
    hadPadding.current = true;
    instance.easeTo({
      padding,
      ...(opening || !inside ? { center: lngLat } : {}),
      duration,
    });
  }, [pinActive, pin.latitude, pin.longitude, mapReady]);

  // Another site was chosen: move the site overlays and fly there (instant under reduced motion).
  const shownSite = useRef(site.id);
  useEffect(() => {
    const instance = map.current;
    if (!instance || shownSite.current === site.id) return;
    shownSite.current = site.id;
    pendingCrew.current = null;
    pendingHazard.current = null;
    hideCard();
    centerMarker.current?.setLngLat([site.longitude, site.latitude]);
    boltMarker.current?.setLngLat(boltPoint(site));
    const data: [string, ReturnType<typeof ringPolygon>][] = [
      ["site-extent", extentPolygon(site)],
      ["site-ring", ringPolygon(site)],
      ["stop-work", ringPolygon(site, STOP_WORK_RADIUS_M, 180)],
    ];
    for (const [id, feature] of data)
      instance.getSource<GeoJSONSource>(id)?.setData(feature);
    const reduce = reducedMotion();
    const target = instance.cameraForBounds(siteBounds(site), { padding: 24 });
    if (savedCamera.current) {
      // Weather is on: frame the new site's forecast area, and come back to the site after.
      savedCamera.current = {
        center: [site.longitude, site.latitude],
        zoom: target?.zoom ?? instance.getZoom(),
      };
      const { west, south, east, north } = forecastBounds(site);
      instance.fitBounds(
        [
          [west, south],
          [east, north],
        ],
        { padding: 8, duration: reduce ? 0 : 1200 },
      );
      return;
    }
    const camera = {
      center: [site.longitude, site.latitude] as [number, number],
      zoom: target?.zoom ?? instance.getZoom(),
    };
    if (reduce) instance.jumpTo(camera);
    else instance.flyTo({ ...camera, duration: 1200 });
  }, [site]);

  // Keep the pin marker in step with the coordinate inputs.
  const pinSite = useRef(site.id);
  useEffect(() => {
    const marker = pinMarker.current;
    const instance = map.current;
    if (!marker || !instance) return;
    if (!Number.isFinite(pin.latitude) || !Number.isFinite(pin.longitude))
      return;
    marker.setLngLat([pin.longitude, pin.latitude]);
    marker.setDraggable(!disabled && pinActive);
    marker.getElement().style.display = pinActive ? "" : "none";
    // A site switch resets the pin to the new site; the fly-to already brings it into view.
    if (pinSite.current !== site.id) {
      pinSite.current = site.id;
      return;
    }
  }, [pin.latitude, pin.longitude, pinActive, disabled, site.id]);

  // Score pins for every site; clicking one selects that site.
  useEffect(() => {
    const instance = map.current;
    if (!instance) return;
    const pins = sitePins.current;
    const placed = (sites ?? []).filter(
      (summary) => summary.latitude !== null && summary.longitude !== null,
    );
    const live = new Set(placed.map((summary) => summary.siteId));
    for (const [id, entry] of pins)
      if (!live.has(id)) {
        entry.marker.remove();
        pins.delete(id);
      }
    for (const summary of placed) {
      const selected = summary.siteId === site.id;
      const key = `${summary.name}:${summary.riskNow}:${summary.latitude}:${summary.longitude}`;
      const existing = pins.get(summary.siteId);
      if (existing?.key === key) {
        setSitePinSelected(existing.marker.getElement(), selected);
        continue;
      }
      existing?.marker.remove();
      const lngLat: [number, number] = [summary.longitude!, summary.latitude!];
      const element = sitePinElement(summary, selected);
      element.addEventListener("click", (event) => {
        event.stopPropagation(); // choosing a site must not move the report pin
        latest.current.onSelectSite?.(summary.siteId);
      });
      // Tabbing to a pin that is off screen brings it into view.
      element.addEventListener("focus", () => {
        if (!instance.getBounds().contains(lngLat))
          instance.panTo(lngLat, { duration: reducedMotion() ? 0 : 300 });
      });
      const marker = new Marker({ element, anchor: "bottom" })
        .setLngLat(lngLat)
        .addTo(instance);
      pins.set(summary.siteId, { marker, key });
    }
  }, [sites, site.id]);

  // Site switching waits while a report or check-in is sending (changeSite ignores it then).
  useEffect(() => {
    for (const { marker } of sitePins.current.values())
      (marker.getElement() as HTMLButtonElement).disabled = disabled;
  }, [disabled, sites, site.id]);

  // Lightning stop-work: show the 10-mile ring and its bolt.
  useEffect(() => {
    const instance = map.current;
    if (!instance) return;
    if (styleLoaded.current)
      for (const id of ["stop-work-fill", "stop-work-ring"])
        if (instance.getLayer(id))
          instance.setLayoutProperty(
            id,
            "visibility",
            stopWork ? "visible" : "none",
          );
    if (stopWork && !boltMarker.current)
      boltMarker.current = new Marker({ element: stopWorkMarkerElement() })
        .setLngLat(boltPoint(latest.current.site))
        .addTo(instance);
    else if (!stopWork && boltMarker.current) {
      boltMarker.current.remove();
      boltMarker.current = null;
    }
  }, [stopWork]);

  // Entering stop-work frames the whole ring, once per episode (not on every poll, so it never
  // fights the user's panning). A site switch or the end of stop-work starts a new episode.
  const fittedFor = useRef<string | null>(null);
  useEffect(() => {
    const instance = map.current;
    if (!stopWork) {
      fittedFor.current = null;
      return;
    }
    if (!fitStopWork || !instance || fittedFor.current === site.id) return;
    fittedFor.current = site.id;
    // Weather already frames the wider area; leave that camera alone.
    if (savedCamera.current) return;
    const sw = offsetPoint(site, -STOP_WORK_RADIUS_M, -STOP_WORK_RADIUS_M);
    const ne = offsetPoint(site, STOP_WORK_RADIUS_M, STOP_WORK_RADIUS_M);
    instance.fitBounds(
      [
        [sw.longitude, sw.latitude],
        [ne.longitude, ne.latitude],
      ],
      { padding: 40, duration: reducedMotion() ? 0 : 1000 },
    );
  }, [stopWork, fitStopWork, site, mapReady]);

  // Weather overlay: raster layers follow the frames and the scrubber.
  useEffect(() => {
    const instance = map.current;
    if (instance && styleLoaded.current)
      applyWeather(instance, weather ?? null);
  }, [weather]);

  // Wind is a canvas of moving streaks, not a raster layer.
  useEffect(() => {
    const instance = map.current;
    if (!instance || weather?.kind !== "wind") {
      wind.current?.destroy();
      wind.current = null;
      return;
    }
    if (!wind.current)
      wind.current = new WindParticles(instance, reducedMotion());
    wind.current.setField(weather.grid, weather.index);
  }, [weather]);

  // Weather is regional: zoom out to the forecast area, and back when it's turned off.
  useEffect(() => {
    const instance = map.current;
    if (!instance) return;
    const duration = reducedMotion() ? 0 : 700;
    if (regional && !savedCamera.current) {
      const center = instance.getCenter();
      savedCamera.current = {
        center: [center.lng, center.lat],
        zoom: instance.getZoom(),
      };
      const { west, south, east, north } = forecastBounds(latest.current.site);
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
  }, [regional]);

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
    applyHazardFocus();
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
    applyCrewFocus();
  }, [crew]);

  // Pan to a worker and open their card, now or as soon as their marker exists.
  function applyCrewFocus() {
    const id = pendingCrew.current;
    const entry = id ? crewMarkers.current.get(id) : undefined;
    const instance = map.current;
    if (!entry || !instance) return;
    pendingCrew.current = null;
    instance.easeTo({
      center: entry.marker.getLngLat(),
      zoom: Math.max(instance.getZoom(), 15),
      duration: reducedMotion() ? 0 : 500,
    });
    if (!entry.marker.getPopup()?.isOpen()) entry.marker.togglePopup();
  }
  useEffect(() => {
    if (!crewFocus) return;
    pendingCrew.current = crewFocus.id;
    applyCrewFocus();
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

  // A clicked feed row brings its marker to the middle of the map, now or once it exists.
  function applyHazardFocus() {
    const id = pendingHazard.current;
    const entry = id ? hazardMarkers.current.get(id) : undefined;
    const instance = map.current;
    if (!entry || !instance) return;
    pendingHazard.current = null;
    instance.easeTo({
      center: [entry.report.longitude, entry.report.latitude],
      duration: reducedMotion() ? 0 : 350,
    });
  }
  useEffect(() => {
    if (!focusRequest) return;
    pendingHazard.current = focusRequest.id;
    applyHazardFocus();
  }, [focusRequest]);

  function move(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") return hideCard();
    // Arrow keys move the pin only while the map itself has focus (not a site pin).
    if (event.target !== event.currentTarget) return;
    if (disabled || !pinActive || !arrowKeys.includes(event.key)) return;
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
