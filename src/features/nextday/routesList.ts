/*
 * The flagged routes as a list, from the report's mud_routes.geojson. Pure functions with no run-time imports, so Node
 * can test them (tests/nextday/routesList.test.mjs). Each feature is one piece of an OpenStreetMap way, about 330 ft
 * long. A person thinks of a road, so pieces of the same way are added together.
 */

export type RouteFeature = {
  properties: {
    osm_id: number;
    highway?: string | null;
    name?: string | null;
    length_ft: number;
    /** equipment key -> [flag index, score, rut depth in inches]. Flag 0 ok, 1 inspect, 2 hold. */
    r: Record<string, [number, number, number | null] | undefined>;
  };
};

export type FlaggedRoute = {
  osmId: number;
  highway: string;
  name: string | null;
  flaggedFeet: number;
  worstFlag: 1 | 2;
  worstRutIn: number | null;
  pieces: number;
};

const FEET_PER_MILE = 5280;

/** Flagged routes for one equipment class: hold before inspect, then the longest flagged stretch first. */
export function flaggedRoutes(
  features: RouteFeature[],
  equipment: string,
): FlaggedRoute[] {
  const byWay = new Map<number, FlaggedRoute>();
  for (const f of features) {
    const p = f.properties;
    const r = p.r[equipment];
    if (!r || r[0] < 1) continue;
    const flag = r[0] >= 2 ? 2 : 1;
    const rut = typeof r[2] === "number" ? r[2] : null;
    const cur = byWay.get(p.osm_id);
    if (!cur) {
      byWay.set(p.osm_id, {
        osmId: p.osm_id,
        highway: p.highway ?? "way",
        name: p.name ?? null,
        flaggedFeet: p.length_ft,
        worstFlag: flag,
        worstRutIn: rut,
        pieces: 1,
      });
      continue;
    }
    cur.flaggedFeet += p.length_ft;
    cur.pieces += 1;
    if (flag > cur.worstFlag) cur.worstFlag = flag;
    if (rut !== null && (cur.worstRutIn === null || rut > cur.worstRutIn))
      cur.worstRutIn = rut;
  }
  return [...byWay.values()].sort(
    (a, b) =>
      b.worstFlag - a.worstFlag ||
      b.flaggedFeet - a.flaggedFeet ||
      a.osmId - b.osmId,
  );
}

const WORDS: Record<string, string> = {
  service: "service road",
  track: "track",
  unclassified: "road",
  residential: "residential road",
};

/** "Poinsettia Road" or "Unnamed service road". */
export function routeLabel(route: FlaggedRoute): string {
  return route.name ?? `Unnamed ${WORDS[route.highway] ?? route.highway}`;
}

/** "0.62 mi" for a length in feet. */
export function milesText(feet: number): string {
  const miles = feet / FEET_PER_MILE;
  return `${miles.toFixed(miles < 10 ? 2 : 1)} mi`;
}

/** Largest predicted rut among the flagged routes, or null when no flagged route has a rut value. */
export function maxPredictedRut(routes: FlaggedRoute[]): number | null {
  const ruts = routes
    .map((r) => r.worstRutIn)
    .filter((v): v is number => v !== null);
  return ruts.length ? Math.max(...ruts) : null;
}

/** Total flagged length for the whole list, in feet. */
export function totalFlaggedFeet(routes: FlaggedRoute[]): number {
  return routes.reduce((sum, r) => sum + r.flaggedFeet, 0);
}
