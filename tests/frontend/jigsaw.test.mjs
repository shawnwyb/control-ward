import test from "node:test";
import assert from "node:assert/strict";
import { piecePath } from "../../src/features/landing/jigsaw.ts";

const xs = (d) =>
  [...d.matchAll(/(-?\d+(?:\.\d+)?),-?\d+(?:\.\d+)?/g)].map((m) =>
    Number(m[1]),
  );

test("piecePath starts at the top-left corner and closes", () => {
  for (let r = 0; r < 2; r++)
    for (let c = 0; c < 3; c++) {
      const d = piecePath(r, c, 150);
      assert.ok(d.startsWith(`M${c * 150},${r * 150}`));
      assert.ok(d.endsWith("Z"));
    }
  assert.ok(piecePath(0, 0, 150).startsWith("M0,0"));
});

test("outer border is flat: no curve on the top and left edges of (0,0)", () => {
  const d = piecePath(0, 0, 150);
  const [top, rest] = d.split("L150.0,54.0");
  assert.ok(!top.includes("C"));
  assert.ok(rest.includes("C"));
  const left = d.slice(d.lastIndexOf("L0.0,150.0"));
  assert.ok(!left.includes("C"));
});

test("right edge of (0,0) bulges out; left edge of (0,1) indents", () => {
  assert.ok(Math.max(...xs(piecePath(0, 0, 150))) > 150);
  // (0,1): its left knob goes inward (x > 150), never outward (x < 150).
  assert.ok(Math.min(...xs(piecePath(0, 1, 150))) >= 150);
});

test("neighbouring pieces share the same curve", () => {
  // (0,0) bottom bulges up into itself (y 120); (1,0) top bulges up into (0,0).
  assert.ok(piecePath(0, 0, 150).includes("75.0,120.0"));
  assert.ok(piecePath(1, 0, 150).includes("75.0,120.0"));
});
