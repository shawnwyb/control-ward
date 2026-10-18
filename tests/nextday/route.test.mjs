// Node runs the .ts directly (type stripping). Run: node --test tests/nextday/route.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import { metersBetween, nearestNode, planDetour } from "../../src/features/nextday/route.ts";

// Two equipment classes. Edge: [from, to, metres, flag(truck), flag(excavator), bits]
//   0 --(hold, 100)-- 1 --(ok, 100)-- 2      the short way 0-1-2 is 200 m, but 0-1 is at hold
//   0 --(ok, 150)-- 3 --(ok, 150)-- 2        the detour 0-3-2 is 300 m
const graph = () => ({
  equipment: ["road_truck", "excavator"],
  flags: ["ok", "inspect", "hold", "not rated"],
  nodes: [[-80.0, 25.0], [-80.001, 25.0], [-80.002, 25.0], [-80.001, 25.001]],
  edges: [[0, 1, 100, 2, 0, 0], [1, 2, 100, 0, 0, 0], [0, 3, 150, 0, 0, 0], [3, 2, 150, 3, 3, 0]],
});
const opts = (over = {}) => ({ equipment: "road_truck", avoid: "hold", avoidTide: false, allowPrivate: true, ...over });
const A = [-80.0, 25.0], B = [-80.002, 25.0];

test("the direct route uses the hold segment, the detour goes around it and reports unrated roads", () => {
  const r = planDetour(graph(), A, B, opts());
  assert.equal(r.direct.meters, 200);
  assert.equal(r.direct.rated.hold, 100);
  assert.equal(r.detour.meters, 300);
  assert.equal(r.detour.rated.hold, 0);
  assert.equal(r.detour.unrated, 150);
  assert.equal(r.detour.rated.ok, 150);
  assert.deepEqual(r.detour.coordinates.map((c) => c[1]), [25.0, 25.001, 25.0]);
});

test("another equipment class has its own flags", () => {
  const r = planDetour(graph(), A, B, opts({ equipment: "excavator" }));
  assert.equal(r.detour.meters, 200);                // nothing is at hold for the excavator
});

test("inspect segments are only avoided when asked", () => {
  const g = graph();
  g.edges[0][3] = 1;                                 // the short way is now inspect, not hold
  assert.equal(planDetour(g, A, B, opts()).detour.meters, 200);
  assert.equal(planDetour(g, A, B, opts({ avoid: "hold_inspect" })).detour.meters, 300);
});

test("tide-wet edges and private roads can be avoided", () => {
  const g = graph();
  g.edges[1][5] = 4;                                 // 1-2 is under the tide shading
  assert.equal(planDetour(g, A, B, opts({ equipment: "excavator" })).detour.meters, 200);
  assert.equal(planDetour(g, A, B, opts({ equipment: "excavator", avoidTide: true })).detour.meters, 300);
  const p = graph();
  p.edges[1][5] = 2;                                 // 1-2 is tagged private
  const withPrivate = planDetour(p, A, B, opts({ equipment: "excavator" }));
  assert.equal(withPrivate.detour.meters, 200);
  assert.equal(withPrivate.detour.privateRoad, 100);
  assert.equal(planDetour(p, A, B, opts({ equipment: "excavator", allowPrivate: false })).detour.meters, 300);
});

test("one-way edges are only used in their direction", () => {
  const g = graph();
  g.edges[2][5] = 1;                                 // 0 -> 3 is one-way
  g.edges[3][5] = 1;                                 // 3 -> 2 is one-way
  assert.equal(planDetour(g, A, B, opts()).detour.meters, 300);
  assert.equal(planDetour(g, B, A, opts()).detour, null);          // the way back needs 2-1-0, and 0-1 is at hold
  assert.equal(planDetour(g, B, A, opts()).direct.meters, 200);
});

test("no path, and clicks far from any road", () => {
  const g = graph();
  g.edges[2][3] = 2;                                 // both ways around are now at hold
  const r = planDetour(g, A, B, opts());
  assert.ok(r.direct);
  assert.equal(r.detour, null);
  const far = planDetour(graph(), [-81, 26], B, opts());
  assert.deepEqual([far.direct, far.detour, far.from], [null, null, null]);
  assert.equal(nearestNode(graph(), -80.0001, 25.0), 0);
  assert.equal(nearestNode(graph(), -80.5, 25.0), null);
});

test("distance helper agrees with the generator's 0.002 degrees = about 205 m at 25 N", () => {
  assert.ok(Math.abs(metersBetween([-80.002, 25.0], [-80.0, 25.0]) - 201) < 6);
});
