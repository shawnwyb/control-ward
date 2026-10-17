import { haversineMiles } from "./geo.ts";

export interface Fire {
  lat: number;
  lon: number;
  acres: number | null;
  contained: number | null;
}

interface FireCollection {
  features?: {
    attributes?: {
      IncidentSize?: number | null;
      PercentContained?: number | null;
    };
    geometry?: { x: number; y: number };
  }[];
}

// Active wildfires only: not fully contained, and large enough to matter (>= 10 acres or size unknown).
export function parseFires(body: FireCollection): Fire[] {
  const fires: Fire[] = [];
  for (const f of body.features ?? []) {
    const g = f.geometry,
      a = f.attributes ?? {};
    if (!g || !Number.isFinite(g.x) || !Number.isFinite(g.y)) continue;
    const contained = a.PercentContained ?? null;
    if (contained !== null && contained >= 100) continue;
    if (a.IncidentSize != null && a.IncidentSize < 10) continue;
    fires.push({
      lat: g.y,
      lon: g.x,
      acres: a.IncidentSize ?? null,
      contained,
    });
  }
  return fires;
}

export function nearestFires(
  site: { latitude: number; longitude: number },
  fires: Fire[],
) {
  let nearest: number | null = null,
    within = 0;
  for (const f of fires) {
    const d = haversineMiles(site.latitude, site.longitude, f.lat, f.lon);
    if (nearest === null || d < nearest) nearest = d;
    if (d <= 25) within++;
  }
  return { nearest, within };
}
