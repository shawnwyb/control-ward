// Node runs the .ts directly (type stripping). Run: node --test tests/nextday/briefing.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  airSummary,
  clock,
  gaugeArc,
  hazardPills,
  highWaterWindows,
  leveeLine,
  localClock,
  mudShare,
  needleAngle,
  pointAlong,
  polylineSlice,
  riverLine,
  tideSummary,
  verdictBullets,
  wildlifeChips,
} from "../../src/features/nextday/briefing.ts";
import {
  flaggedRoutes,
  maxPredictedRut,
} from "../../src/features/nextday/routesList.ts";

const report = (eia) =>
  JSON.parse(readFileSync(`public/reports/${eia}/latest.json`, "utf8"));

test("clock helpers match the app's own formats", () => {
  assert.equal(clock("06:00"), "6:00 AM");
  assert.equal(clock("19:00"), "7:00 PM");
  assert.equal(clock("00:30"), "12:30 AM");
  assert.equal(localClock("2026-10-19T05:32"), "5:32 AM");
  assert.equal(localClock("2026-10-19T12:36"), "12:36 PM");
});

test("verdict bullets are short, worst first, and never more than three", () => {
  const r = report("621");
  const bullets = verdictBullets(r);
  assert.ok(bullets.length >= 1 && bullets.length <= 3);
  for (const b of bullets) {
    assert.ok(b.text.split(/\s+/).length <= 8, `too long: ${b.text}`);
    assert.ok(!/[\u{1F300}-\u{1FAFF}☀-➿]/u.test(b.text), "no emoji");
  }
  const codes = r.verdict.reasons.map((x) => x.code);
  if (codes.includes("mud"))
    assert.ok(
      bullets.some((b) => b.text.startsWith("Heavy equipment: hold until")),
    );
  if (codes.includes("tide")) {
    const tide = bullets.find((b) => b.text.startsWith("Low ground"));
    assert.ok(tide?.detail?.includes(" to "));
  }
});

test("verdict bullets drop repeats and fall back to the report's own sentence", () => {
  const r = report("621");
  const odd = {
    ...r,
    verdict: {
      ...r.verdict,
      reasons: [
        { level: "limits", code: "mud", text: "x" },
        { level: "limits", code: "mud", text: "y" },
        { level: "limits", code: "something_new", text: "A new rule applies." },
        { level: "limits", code: "no_window", text: "z" },
        { level: "limits", code: "tide", text: "w" },
      ],
    },
  };
  const bullets = verdictBullets(odd);
  assert.equal(bullets.length, 3);
  assert.equal(bullets[1].text, "A new rule applies.");
});

test("a weather stop names the hours and the causes", () => {
  const r = report("621");
  const stop = {
    ...r,
    weather: {
      ...r.weather,
      blocked_runs: [{ start: "18:00", end: "19:00", reasons: ["rain"] }],
    },
    verdict: {
      ...r.verdict,
      reasons: [{ level: "limits", code: "blocked_hours", text: "x" }],
    },
  };
  assert.deepEqual(verdictBullets(stop), [
    { text: "Weather stops work: rain", detail: "6:00 PM to 7:00 PM" },
  ]);
});

test("high-water windows keep only the report day", () => {
  const r = report("621");
  const w = highWaterWindows(r.flood.tide, r.meta.for_date);
  assert.deepEqual(w, ["4:32 AM to 6:32 AM", "5:10 PM to 7:10 PM"]);
  assert.deepEqual(highWaterWindows(r.flood.tide, "2000-01-01"), []);
  assert.deepEqual(
    highWaterWindows({ status: "not_applicable" }, r.meta.for_date),
    [],
  );
});

test("tide summary lists the highs on the report day", () => {
  const r = report("621");
  const t = tideSummary(r.flood.tide, r.meta.for_date);
  assert.deepEqual(t.highs, [
    { time: "5:32 AM", ft: 1.82 },
    { time: "6:10 PM", ft: 1.85 },
  ]);
  assert.equal(tideSummary({ status: "not_applicable" }, "2026-10-19"), null);
});

test("hazard pills mark the top driver, and the gauge geometry matches the presentation art", () => {
  const r = report("621");
  const pills = hazardPills(r.hazard_index);
  assert.deepEqual(
    pills.map((p) => p.key),
    ["heat", "storm", "flood", "fire"],
  );
  assert.equal(pills.find((p) => p.top).key, r.hazard_index.top_driver);
  assert.equal(pills.find((p) => p.key === "storm").percent, "2.9%");
  assert.deepEqual(hazardPills({ status: "missing" }), []);

  assert.equal(needleAngle(0), -90);
  assert.equal(needleAngle(10), 90);
  assert.equal(needleAngle(6.5), 27);
  assert.equal(needleAngle(99), 90); // clamped
  // docs/presentation-plan/presentation.html draws these arcs with coordinates rounded down, so compare within 0.1.
  const near = (path, expected) => {
    const got = path.match(/-?\d+\.?\d*/g).map(Number);
    got.forEach((v, i) =>
      assert.ok(Math.abs(v - expected[i]) <= 0.1, `${path} vs ${expected}`),
    );
  };
  near(
    gaugeArc(200, 210, 160, 0, 3),
    [40, 210, 160, 160, 0, 0, 1, 105.9, 80.6],
  );
  near(
    gaugeArc(200, 210, 160, 3, 7.5),
    [105.9, 80.6, 160, 160, 0, 0, 1, 313.1, 96.9],
  );
  near(
    gaugeArc(200, 210, 160, 7.5, 10),
    [313.1, 96.9, 160, 160, 0, 0, 1, 360, 210],
  );
});

test("mud share keeps the report's own totals and splits the flagged part by flag", () => {
  const eq = { route_ft: 1000, flagged_route_ft: 600, worst_flag: "hold" };
  const piece = (len, flag) => ({
    properties: { length_ft: len, r: { road_truck: [flag, 5, null] } },
  });
  // Before the route file loads, the flagged part takes the worst flag.
  assert.deepEqual(mudShare(eq, null, "road_truck"), {
    okFt: 400,
    inspectFt: 0,
    holdFt: 600,
    totalFt: 1000,
  });
  // Pieces only set the inspect-to-hold proportion: 300 hold, 100 inspect -> 75 % of 600 is hold.
  const s = mudShare(
    eq,
    [piece(300, 2), piece(100, 1), piece(900, 0)],
    "road_truck",
  );
  assert.deepEqual(s, {
    okFt: 400,
    inspectFt: 150,
    holdFt: 450,
    totalFt: 1000,
  });
  assert.equal(s.okFt + s.inspectFt + s.holdFt, s.totalFt);
  assert.equal(mudShare({ ...eq, route_ft: 0 }, null, "road_truck"), null);
  // Nothing flagged: all ok.
  assert.deepEqual(
    mudShare(
      { route_ft: 500, flagged_route_ft: 0, worst_flag: "ok" },
      [],
      "road_truck",
    ),
    { okFt: 500, inspectFt: 0, holdFt: 0, totalFt: 500 },
  );
});

test("max predicted rut ignores routes with no rut value", () => {
  const f = (osm_id, rut) => ({
    properties: { osm_id, length_ft: 100, r: { road_truck: [2, 6.5, rut] } },
  });
  assert.equal(
    maxPredictedRut(
      flaggedRoutes([f(1, null), f(2, 4.9), f(3, 1.3)], "road_truck"),
    ),
    4.9,
  );
  assert.equal(
    maxPredictedRut(flaggedRoutes([f(1, null)], "road_truck")),
    null,
  );
  assert.equal(maxPredictedRut([]), null);
});

test("air summary shows the hourly row only from the sensitive-groups band", () => {
  const r = report("621");
  const a = airSummary(r.air);
  assert.equal(a.hourlyRow, false);
  assert.ok(a.low <= a.peak);
  assert.match(a.fires, /wildfire/);
  const bad = airSummary({
    ...r.air,
    peak: {
      ...r.air.peak,
      us_aqi: 101,
      band: { min: 101, name: "Unhealthy for sensitive groups", meaning: "" },
    },
  });
  assert.equal(bad.hourlyRow, true);
  assert.equal(airSummary({ status: "missing" }), null);
});

test("wildlife chips drop groups with no recent sightings", () => {
  const chips = wildlifeChips({
    groups: [
      { id: "a", label: "American alligator", recent: 5 },
      { id: "b", label: "Snakes", recent: 0 },
    ],
  });
  assert.deepEqual(chips, [{ label: "American alligator", recent: 5 }]);
  assert.deepEqual(wildlifeChips(undefined), []);
});

test("river and levee lines say what the gauge shows, or why there is none", () => {
  const tidal = report("621");
  assert.equal(
    riverLine(tidal.flood.river),
    "River: No NWS river forecast point within 25 km of the site.",
  );
  assert.equal(
    leveeLine(tidal.flood.levees),
    "Nearest levee: L-31 East (2.04 km, FEMA: Non-Accredited Levee System).",
  );
  const inland = report("6022");
  assert.match(
    riverLine(inland.flood.river),
    /^River: Mazon River near Coal City, now 1\.54 ft, below flood stage, steady/,
  );
  assert.equal(
    leveeLine({ status: "missing", reason: "no data" }),
    "Levees: no data",
  );
  assert.match(
    leveeLine({
      status: "ok",
      inside_leveed_area: true,
      systems: [{ id: "7", name: "North Levee", inside: true, nearest_km: 0 }],
    }),
    /^The site is inside a mapped leveed area \(North Levee\)\.$/,
  );
});

test("polyline slices follow the line and join end to end", () => {
  const line = [
    [0, 0],
    [10, 0],
    [10, 10],
  ];
  assert.deepEqual(pointAlong(line, 0), [0, 0]);
  assert.deepEqual(pointAlong(line, 0.5), [10, 0]);
  assert.deepEqual(pointAlong(line, 1), [10, 10]);
  assert.deepEqual(polylineSlice(line, 0.25, 0.75), [
    [5, 0],
    [10, 0],
    [10, 5],
  ]);
  assert.deepEqual(polylineSlice(line, 0, 1), [
    [0, 0],
    [10, 0],
    [10, 10],
  ]);
  assert.deepEqual(polylineSlice(line, 0.5, 0.5), [[10, 0]]); // empty slice: a single point
});
