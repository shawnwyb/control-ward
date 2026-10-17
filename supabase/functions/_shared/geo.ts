const EARTH_RADIUS_MI = 3958.7613;

export function haversineMiles(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const rad = Math.PI / 180;
  const a =
    Math.sin(((lat2 - lat1) * rad) / 2) ** 2 +
    Math.cos(lat1 * rad) *
      Math.cos(lat2 * rad) *
      Math.sin(((lon2 - lon1) * rad) / 2) ** 2;
  return 2 * EARTH_RADIUS_MI * Math.asin(Math.sqrt(a));
}

export function boundingBox(
  points: { latitude: number; longitude: number }[],
  marginDeg: number,
) {
  const lats = points.map((p) => p.latitude);
  const lons = points.map((p) => p.longitude);
  return {
    south: Math.min(...lats) - marginDeg,
    north: Math.max(...lats) + marginDeg,
    west: Math.min(...lons) - marginDeg,
    east: Math.max(...lons) + marginDeg,
  };
}
