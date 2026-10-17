import type { Feature, Polygon } from "geojson";

const METERS_PER_DEGREE_LATITUDE = 111320;

/** The site area drawn on the map: a 1200 m × 800 m extent and a 300 m ring. */
export const EXTENT_WIDTH_M = 1200;
export const EXTENT_HEIGHT_M = 800;
export const SITE_RADIUS_M = 300;

type Origin = { latitude: number; longitude: number };

export function metersPerDegreeLongitude(latitude: number): number {
  return METERS_PER_DEGREE_LATITUDE * Math.cos((latitude * Math.PI) / 180);
}

/** The coordinate that is `northMeters` north and `eastMeters` east of `origin`. */
export function offsetPoint(
  origin: Origin,
  northMeters: number,
  eastMeters: number,
): Origin {
  return {
    latitude: origin.latitude + northMeters / METERS_PER_DEGREE_LATITUDE,
    longitude:
      origin.longitude + eastMeters / metersPerDegreeLongitude(origin.latitude),
  };
}

/** Moves a pin by metres north and east, measured at the site's latitude. */
export function nudge(
  origin: Origin,
  latitude: number,
  longitude: number,
  northMeters: number,
  eastMeters: number,
): Origin {
  return {
    latitude: latitude + northMeters / METERS_PER_DEGREE_LATITUDE,
    longitude:
      longitude + eastMeters / metersPerDegreeLongitude(origin.latitude),
  };
}

function polygon(coordinates: [number, number][]): Feature<Polygon> {
  return {
    type: "Feature",
    properties: {},
    geometry: { type: "Polygon", coordinates: [coordinates] },
  };
}

export function ringPolygon(
  origin: Origin,
  radiusMeters = SITE_RADIUS_M,
  steps = 96,
): Feature<Polygon> {
  const points: [number, number][] = [];
  for (let step = 0; step <= steps; step++) {
    const angle = (step / steps) * 2 * Math.PI;
    const point = offsetPoint(
      origin,
      Math.cos(angle) * radiusMeters,
      Math.sin(angle) * radiusMeters,
    );
    points.push([point.longitude, point.latitude]);
  }
  return polygon(points);
}

export function extentCorners(origin: Origin) {
  const southWest = offsetPoint(
    origin,
    -EXTENT_HEIGHT_M / 2,
    -EXTENT_WIDTH_M / 2,
  );
  const northEast = offsetPoint(
    origin,
    EXTENT_HEIGHT_M / 2,
    EXTENT_WIDTH_M / 2,
  );
  return { southWest, northEast };
}

export function extentPolygon(origin: Origin): Feature<Polygon> {
  const { southWest: sw, northEast: ne } = extentCorners(origin);
  return polygon([
    [sw.longitude, sw.latitude],
    [ne.longitude, sw.latitude],
    [ne.longitude, ne.latitude],
    [sw.longitude, ne.latitude],
    [sw.longitude, sw.latitude],
  ]);
}
