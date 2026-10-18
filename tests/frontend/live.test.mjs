import test from "node:test";
import assert from "node:assert/strict";
import { requestGate, liveView } from "../../src/lib/live.ts";

test("requestGate drops an answer for a site that is no longer selected", () => {
  const gate = requestGate("north");
  const north = gate.start("north");
  gate.select("south");
  const south = gate.start("south");
  assert.equal(south(), true);
  assert.equal(north(), false); // late North answer after the switch
});

test("requestGate drops a superseded request for the same site", () => {
  const gate = requestGate("north");
  const first = gate.start("north");
  const second = gate.start("north");
  assert.equal(first(), false);
  assert.equal(second(), true);
});

test("requestGate: switching away and back still drops the old request", () => {
  const gate = requestGate("north");
  const old = gate.start("north");
  gate.select("south");
  gate.select("north");
  assert.equal(old(), false);
  assert.equal(gate.start("north")(), true);
});

test("liveView never shows another site's data", () => {
  const initial = { status: "clear" };
  const state = {
    siteId: "north",
    data: { status: "stop_work" },
    loaded: true,
    failed: false,
  };
  assert.deepEqual(liveView(state, "north", initial), state);
  assert.deepEqual(liveView(state, "south", initial), {
    siteId: "south",
    data: initial,
    loaded: false,
    failed: false,
  });
});
