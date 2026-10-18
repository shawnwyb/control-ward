/*
 * Detour search over the road graph in public/reports/<eia>/<date>/road_graph.json (written by reports/next-day).
 * Pure functions with no imports at run time, so Node can test them (tests/nextday/route.test.mjs).
 *
 * Edge: [from, to, metres, flag per equipment..., bits]. Flags: 0 ok, 1 inspect, 2 hold, 3 not rated.
 * Bits: 1 one-way (from -> to only), 2 tagged private, 4 inside the tide shading.
 */

export type RoadGraph = {
  nodes: [number, number][];
  edges: number[][];
  equipment: string[];
  flags: string[];
};

export type Avoid = "hold" | "hold_inspect";
export type RouteOptions = { equipment: string; avoid: Avoid; avoidTide: boolean; allowPrivate: boolean };

export type RouteResult = {
  coordinates: [number, number][];
  meters: number;
  /** Metres on rated edges by flag, and on edges the mud model does not rate. */
  rated: { ok: number; inspect: number; hold: number };
  unrated: number;
  privateRoad: number;
  tideWet: number;
};

export const NOT_RATED = 3;
const ONEWAY = 1;
const PRIVATE = 2;
const TIDE_WET = 4;

const METERS_PER_DEG_LAT = 110_540;
export function metersBetween(a: [number, number], b: [number, number]): number {
  const kx = Math.cos(((a[1] + b[1]) / 2) * (Math.PI / 180)) * 111_320;
  return Math.hypot((b[0] - a[0]) * kx, (b[1] - a[1]) * METERS_PER_DEG_LAT);
}

/** Nearest node to a point, or null if none is within `maxMeters` (a click far from any mapped road). */
export function nearestNode(graph: RoadGraph, lon: number, lat: number, maxMeters = 400): number | null {
  let best = -1;
  let bestD = Infinity;
  graph.nodes.forEach((n, i) => {
    const d = metersBetween([lon, lat], n);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return best >= 0 && bestD <= maxMeters ? best : null;
}

type Arc = { to: number; edge: number[]; flag: number };

function adjacency(graph: RoadGraph, options: RouteOptions | null, equipmentIndex: number): Arc[][] {
  const out: Arc[][] = graph.nodes.map(() => []);
  for (const e of graph.edges) {
    const bits = e[e.length - 1];
    const flag = e[3 + equipmentIndex];
    if (options) {
      if (flag === 2 || (options.avoid === "hold_inspect" && flag === 1)) continue;
      if (options.avoidTide && bits & TIDE_WET) continue;
    }
    if (!(options?.allowPrivate ?? true) && bits & PRIVATE) continue;
    out[e[0]].push({ to: e[1], edge: e, flag });
    if (!(bits & ONEWAY)) out[e[1]].push({ to: e[0], edge: e, flag });
  }
  return out;
}

class MinHeap {
  private items: [number, number][] = [];
  get size() {
    return this.items.length;
  }
  push(priority: number, value: number) {
    const a = this.items;
    a.push([priority, value]);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p][0] <= a[i][0]) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop(): [number, number] | undefined {
    const a = this.items;
    if (!a.length) return undefined;
    const top = a[0];
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

function search(graph: RoadGraph, from: number, to: number, options: RouteOptions | null, equipment: string): RouteResult | null {
  const eq = Math.max(0, graph.equipment.indexOf(equipment));
  const adj = adjacency(graph, options, eq);
  const dist = new Float64Array(graph.nodes.length).fill(Infinity);
  const prev = new Int32Array(graph.nodes.length).fill(-1);
  const via: (Arc | null)[] = new Array(graph.nodes.length).fill(null);
  const heap = new MinHeap();
  dist[from] = 0;
  heap.push(0, from);
  while (heap.size) {
    const [d, u] = heap.pop()!;
    if (d > dist[u]) continue;
    if (u === to) break;
    for (const arc of adj[u]) {
      const nd = d + arc.edge[2];
      if (nd < dist[arc.to]) {
        dist[arc.to] = nd;
        prev[arc.to] = u;
        via[arc.to] = arc;
        heap.push(nd, arc.to);
      }
    }
  }
  if (!Number.isFinite(dist[to])) return null;
  const nodes: number[] = [];
  const result: RouteResult = { coordinates: [], meters: dist[to], rated: { ok: 0, inspect: 0, hold: 0 }, unrated: 0, privateRoad: 0, tideWet: 0 };
  for (let n = to; n !== -1; n = prev[n]) {
    nodes.push(n);
    const arc = via[n];
    if (arc && n !== from) {
      const m = arc.edge[2];
      if (arc.flag === NOT_RATED) result.unrated += m;
      else result.rated[(["ok", "inspect", "hold"] as const)[arc.flag]] += m;
      const bits = arc.edge[arc.edge.length - 1];
      if (bits & PRIVATE) result.privateRoad += m;
      if (bits & TIDE_WET) result.tideWet += m;
    }
  }
  nodes.reverse();
  result.coordinates = nodes.map((n) => graph.nodes[n]);
  return result;
}

export type Detour = {
  /** Shortest path with no mud or tide limits: the route a driver would take without the report. */
  direct: RouteResult | null;
  /** Shortest path that keeps off the flagged edges, or null if the graph has none. */
  detour: RouteResult | null;
  from: number | null;
  to: number | null;
};

export function planDetour(graph: RoadGraph, a: [number, number], b: [number, number], options: RouteOptions): Detour {
  const from = nearestNode(graph, a[0], a[1]);
  const to = nearestNode(graph, b[0], b[1]);
  if (from === null || to === null) return { direct: null, detour: null, from, to };
  return {
    direct: search(graph, from, to, null, options.equipment),
    detour: search(graph, from, to, options, options.equipment),
    from,
    to,
  };
}
