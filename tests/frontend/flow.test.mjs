import test from "node:test";
import assert from "node:assert/strict";
import {
  allocateFlags,
  pointAt,
  scaleX,
  sliceRoute,
  travelKeyframes,
} from "../../src/features/models/flowGeometry.ts";

const L = [
  [0, 0],
  [10, 0],
  [10, 10],
];

test("pointAt walks a polyline by length and reports the heading", () => {
  assert.deepEqual(pointAt(L, 0), { x: 0, y: 0, angle: 0 });
  assert.deepEqual(pointAt(L, 0.25), { x: 5, y: 0, angle: 0 });
  assert.deepEqual(pointAt(L, 0.5), { x: 10, y: 0, angle: 0 });
  assert.deepEqual(pointAt(L, 0.75), { x: 10, y: 5, angle: 90 });
  assert.deepEqual(pointAt(L, 1), { x: 10, y: 10, angle: 90 });
});

test("pointAt clamps to the ends", () => {
  assert.equal(pointAt(L, -3).x, 0);
  assert.equal(pointAt(L, 7).y, 10);
});

test("sliceRoute keeps the corners inside the slice", () => {
  assert.deepEqual(sliceRoute(L, 0.25, 0.75), [
    [5, 0],
    [10, 0],
    [10, 5],
  ]);
  assert.deepEqual(sliceRoute(L, 0.1, 0.3), [
    [2, 0],
    [6, 0],
  ]);
});

test("sliceRoute never runs backwards", () => {
  const out = sliceRoute(L, 0.6, 0.2);
  assert.deepEqual(out[0], out[out.length - 1]);
});

test("travelKeyframes spans the whole route and fades at both ends", () => {
  const frames = travelKeyframes(L, 20);
  assert.equal(frames.length, 21);
  assert.equal(frames[0].offset, 0);
  assert.equal(frames[20].offset, 1);
  assert.equal(frames[0].opacity, 0);
  assert.equal(frames[20].opacity, 0);
  assert.equal(frames[10].opacity, 1);
  assert.equal(
    frames[10].transform,
    "translate(10.00px, 0.00px) rotate(0.0deg)",
  );
  assert.equal(
    frames[20].transform,
    "translate(10.00px, 10.00px) rotate(90.0deg)",
  );
});

test("allocateFlags fills every place, in route order", () => {
  const out = allocateFlags({ ok: 6, inspect: 3, hold: 3 }, 12);
  assert.equal(out.length, 12);
  assert.deepEqual(out, [
    ...Array(6).fill("ok"),
    ...Array(3).fill("inspect"),
    ...Array(3).fill("hold"),
  ]);
});

test("allocateFlags splits in proportion to the counts", () => {
  const out = allocateFlags({ ok: 100, inspect: 50, hold: 50 }, 12);
  assert.equal(out.filter((f) => f === "ok").length, 6);
  assert.equal(out.filter((f) => f === "inspect").length, 3);
  assert.equal(out.filter((f) => f === "hold").length, 3);
});

test("allocateFlags keeps a rare flag visible", () => {
  const out = allocateFlags({ ok: 300, inspect: 5, hold: 1 }, 12);
  assert.equal(out.length, 12);
  assert.equal(out.filter((f) => f === "hold").length, 1);
  assert.ok(out.includes("inspect"));
});

test("allocateFlags does not invent a flag that does not occur", () => {
  const out = allocateFlags({ ok: 40, inspect: 0, hold: 0 }, 12);
  assert.deepEqual(out, Array(12).fill("ok"));
});

test("allocateFlags returns nothing when there is nothing to show", () => {
  assert.deepEqual(allocateFlags({ ok: 0, inspect: 0, hold: 0 }, 12), []);
  assert.deepEqual(allocateFlags({ ok: 3, inspect: 0, hold: 0 }, 0), []);
});

test("scaleX puts 0 and 10 on the ends and clamps outside", () => {
  assert.equal(scaleX(0, 22, 236), 22);
  assert.equal(scaleX(10, 22, 236), 258);
  assert.equal(scaleX(5, 22, 236), 140);
  assert.equal(scaleX(-2, 22, 236), 22);
  assert.equal(scaleX(14, 22, 236), 258);
});
