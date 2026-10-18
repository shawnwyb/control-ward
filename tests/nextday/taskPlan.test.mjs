// Node runs the .ts directly (type stripping). Run: node --test tests/nextday/taskPlan.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  blockedHours,
  combine,
  limitFor,
  longestWindow,
} from "../../src/features/nextday/taskPlan.ts";

const row = (hour, over = {}) => ({
  hour,
  safe: true,
  blocked_by: [],
  hi: 85,
  wbgt: 80,
  gust: 10,
  pop: 10,
  mm: 0,
  cape: 300,
  uv: 5,
  temp: 80,
  feels: 85,
  rh: 60,
  have_data: true,
  band: "caution",
  aqi: 40,
  tide_near_high: false,
  ...over,
});
const day = (over = {}) =>
  Array.from({ length: 24 }, (_, h) => row(h, over[h] ?? {}));
const profile = {
  id: "t",
  label: "T",
  description: "",
  blockers: [
    {
      id: "gust",
      kind: "hour",
      factor: "gust",
      limit: 40,
      label: "Wind gusts",
      unit: "mph",
      source: "x",
      needs_confirmation: false,
    },
    {
      id: "tide",
      kind: "hour",
      factor: "tide_near_high",
      limit: 1,
      label: "Near high tide",
      source: "x",
      needs_confirmation: true,
      only_if: "tide_shading",
    },
    {
      id: "mud",
      kind: "site",
      flag: "mud",
      values: ["hold"],
      label: "Routes at hold",
      source: "x",
      needs_confirmation: true,
    },
  ],
};
const flags = { mud: null, river: null, tide_shading: false };

test("a clear day has one long window and no reasons", () => {
  const r = blockedHours(profile, day(), flags);
  assert.deepEqual(longestWindow(r), { start: 6, end: 19 });
  assert.ok(r.every((x) => !x.blocked && x.reasons.length === 0));
});

test("an hour at the limit is blocked and says why", () => {
  const r = blockedHours(
    profile,
    day({ 12: { gust: 40 }, 13: { gust: 55.4 } }),
    flags,
  );
  assert.equal(r[12].blocked, true);
  assert.match(r[13].reasons[0], /Wind gusts 55.4 mph \(limit 40\)/);
  assert.deepEqual(longestWindow(r), { start: 6, end: 12 });
});

test("a changed limit applies; the tide blocker only applies where tide shading exists", () => {
  const hours = day({ 9: { tide_near_high: true }, 11: { gust: 30 } });
  assert.equal(blockedHours(profile, hours, flags)[9].blocked, false);
  assert.equal(
    blockedHours(profile, hours, { ...flags, tide_shading: true })[9].blocked,
    true,
  );
  assert.equal(
    blockedHours(profile, hours, flags, { "t.gust": 25 })[11].blocked,
    true,
  );
  assert.equal(limitFor(profile, profile.blockers[0], { "t.gust": 25 }), 25);
  assert.equal(limitFor(profile, profile.blockers[0], {}), 40);
});

test("a site-wide flag blocks every hour, and an hour with no forecast is blocked", () => {
  const r = blockedHours(
    profile,
    day({ 10: { have_data: false, gust: null } }),
    { ...flags, mud: "hold" },
  );
  assert.ok(r.every((x) => x.blocked));
  assert.ok(r[10].reasons.includes("No forecast for this hour"));
  assert.equal(longestWindow(r), null);
});

test("combine blocks an hour if any task is blocked", () => {
  const a = blockedHours(profile, day({ 8: { gust: 50 } }), flags);
  const b = blockedHours(profile, day({ 14: { gust: 50 } }), flags);
  const both = combine([a, b]);
  assert.ok(both[8].blocked && both[14].blocked && !both[11].blocked);
  assert.deepEqual(longestWindow(both), { start: 9, end: 14 });
});

test("window matches the generator's rule: needs two hours, ends at 19", () => {
  const r = blockedHours(
    profile,
    day({
      6: { gust: 50 },
      8: { gust: 50 },
      10: { gust: 50 },
      12: { gust: 50 },
      14: { gust: 50 },
      16: { gust: 50 },
      18: { gust: 50 },
    }),
    flags,
  );
  assert.equal(longestWindow(r), null);
});

test("the shipped task profiles load and reference only known factors", () => {
  const { profiles } = JSON.parse(
    readFileSync(
      new URL(
        "../../reports/next-day/nextday/data/task_profiles.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const known = new Set([
    "wbgt",
    "hi",
    "gust",
    "pop",
    "mm",
    "cape",
    "aqi",
    "tide_near_high",
  ]);
  for (const p of profiles)
    for (const b of p.blockers)
      if (b.kind === "hour") assert.ok(known.has(b.factor), `${p.id}/${b.id}`);
  const hours = day({ 13: { gust: 45 } });
  for (const p of profiles)
    assert.doesNotThrow(() => blockedHours(p, hours, flags));
});
