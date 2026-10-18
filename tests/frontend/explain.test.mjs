import test from "node:test";
import assert from "node:assert/strict";
import {
  explainHazard,
  explainIndex,
  latestReading,
  scoreDiffers,
} from "../../src/lib/explain.ts";

const NOW = Date.parse("2026-10-18T12:00:00Z");
const ago = (h) => new Date(NOW - h * 3600_000).toISOString();
const r = (hazard, unit, value, hours = 0.5, forecast_for = "-infinity") => ({
  hazard,
  unit,
  value,
  observed_at: ago(hours),
  forecast_for,
});
const ex = (kind, readings, site = {}, extra = {}) =>
  explainHazard(kind, readings, site, { now: NOW, ...extra });

test("heat: WBGT tiers and boundaries", () => {
  const score = (w) => ex("heat", [r("heat", "wbgt_f", w)]).score;
  assert.deepEqual(
    [81.9, 82, 84.9, 85, 87.9, 88, 89.9, 90].map(score),
    [0, 3, 3, 5, 5, 7.5, 7.5, 10],
  );
});

test("heat: heat index tiers and the max of both", () => {
  const hi = (v) => ex("heat", [r("heat", "heat_index_f", v)]).score;
  assert.deepEqual(
    [89.9, 90, 102.9, 103, 124.9, 125].map(hi),
    [0, 3, 3, 6, 6, 9],
  );
  const both = ex("heat", [
    r("heat", "wbgt_f", 86),
    r("heat", "heat_index_f", 104),
  ]);
  assert.equal(both.score, 6);
  assert.equal(both.headline, "Heat index 104°F");
});

test("heat: explanation text", () => {
  const e = ex("heat", [
    r("heat", "wbgt_f", 86),
    r("heat", "heat_index_f", 98),
  ]);
  assert.equal(e.score, 5);
  assert.equal(e.headline, "Heat index 98°F");
  assert.equal(e.reading, "WBGT 86°F · heat index 98°F");
  assert.equal(e.rule, "WBGT 85–88°F → 5.0 · scheduled rest breaks");
  assert.equal(e.next, "Rises to 7.5 at WBGT 88°F");
  assert.match(ex("heat", [r("heat", "wbgt_f", 95)]).next, /highest/);
});

test("heat: uses the newest reading and ignores stale and forecast rows", () => {
  const rows = [
    r("heat", "wbgt_f", 92, 4), // older than 3 hours
    r("heat", "wbgt_f", 83, 2),
    r("heat", "wbgt_f", 86, 1),
    r("heat", "wbgt_f", 95, 0.1, "2026-10-19T15:00:00Z"), // forecast
  ];
  assert.equal(latestReading(rows, "heat", "wbgt_f", NOW), 86);
  assert.equal(ex("heat", rows).score, 5);
});

test("flood: rain tiers and boundaries", () => {
  const rain = (mm) => ex("flood", [r("flood", "precip_mm_24h", mm)]).score;
  assert.deepEqual(
    [9.9, 10, 24.9, 25, 49.9, 50, 99.9, 100].map(rain),
    [0, 2, 2, 4, 4, 6, 6, 9],
  );
});

test("flood: rain windows (overnight 18 h, 24 h rain 6 h) and the larger wins", () => {
  const rows = [
    r("flood", "precip_mm_overnight", 30, 17),
    r("flood", "precip_mm_24h", 60, 7), // too old
  ];
  assert.equal(ex("flood", rows).score, 4);
  rows[1] = r("flood", "precip_mm_24h", 60, 5);
  assert.equal(ex("flood", rows).score, 6);
});

test("flood: gauge, flood stage and warning", () => {
  const g = (stage) =>
    ex("flood", [
      r("flood", "gauge_stage_ft", stage),
      r("flood", "gauge_flood_stage_ft", 10, 48),
    ]).score;
  assert.deepEqual([7.9, 8, 9.9, 10].map(g), [0, 6, 6, 9]);
  assert.equal(ex("flood", [r("flood", "nws_flood_warning", 1)]).score, 8);
  assert.equal(ex("flood", [r("flood", "nws_flood_warning", 0)]).score, 0);
  // flood stage of 0 is ignored
  assert.equal(
    ex("flood", [
      r("flood", "gauge_stage_ft", 5),
      r("flood", "gauge_flood_stage_ft", 0),
    ]).score,
    0,
  );
});

test("flood: FEMA zone and river multipliers", () => {
  const rows = [r("flood", "precip_mm_24h", 31)];
  const e = ex("flood", rows, {
    fema_flood_zone: "AE",
    river_distance_m: 3000,
  });
  assert.equal(e.score, 6.2); // 4 * 1.3 * 1.2 = 6.24
  assert.match(e.rule, /×1\.3 FEMA zone AE/);
  assert.match(e.rule, /×1\.2 river 3 km away/);
  assert.match(e.reading, /31 mm \(1\.22 in\)/);
  assert.equal(ex("flood", rows, { fema_flood_zone: "X" }).score, 4);
  assert.equal(ex("flood", rows, { river_distance_m: 5000 }).score, 4.8);
  assert.equal(ex("flood", rows, { river_distance_m: 25000 }).score, 4);
  const far = ex("flood", rows, { river_distance_m: 30000 });
  assert.equal(far.score, 3.2);
  assert.match(far.rule, /×0\.8 river 30 km away/);
  for (const z of ["A", "AH", "AO", "AR", "A99", "V", "VE"])
    assert.equal(ex("flood", rows, { fema_flood_zone: z }).score, 5.2);
});

test("flood: multipliers never raise a zero score, and the total is capped at 10", () => {
  const dry = ex("flood", [r("flood", "precip_mm_24h", 2)], {
    fema_flood_zone: "VE",
    river_distance_m: 100,
  });
  assert.equal(dry.score, 0);
  const wet = ex("flood", [r("flood", "precip_mm_24h", 120)], {
    fema_flood_zone: "VE",
    river_distance_m: 100,
  });
  assert.equal(wet.score, 10);
  assert.match(wet.rule, /capped at 10/);
});

test("flood: next step accounts for multipliers", () => {
  const e = ex("flood", [r("flood", "precip_mm_24h", 12)], {
    fema_flood_zone: "AE",
  });
  assert.equal(e.score, 2.6);
  assert.match(e.next, /^Rises to 5\.2 at rain 25 mm/);
});

test("wildfire: distance tiers and boundaries", () => {
  const f = (mi) =>
    ex("wildfire", [r("wildfire", "nearest_fire_mi", mi)]).score;
  assert.deepEqual(
    [4.9, 5, 9.9, 10, 24.9, 25, 49.9, 50, 99.9, 100].map(f),
    [10, 8, 8, 6, 6, 3, 3, 1, 1, 0],
  );
  const e = ex("wildfire", [
    r("wildfire", "nearest_fire_mi", 18.4),
    r("wildfire", "fires_within_25mi", 2),
  ]);
  assert.equal(e.headline, "Nearest fire 18.4 mi");
  assert.equal(e.next, "Rises to 8.0 within 10 mi");
  assert.equal(e.reading, "Nearest fire 18.4 mi · 2 within 25 mi");
});

test("soil: moisture tiers and boundaries", () => {
  const s = (v) => ex("soil", [r("soil", "soil_moisture_frac", v, 5)]).score;
  assert.deepEqual([0.29, 0.3, 0.35, 0.4, 0.45].map(s), [0, 2, 4, 6, 8]);
  assert.equal(ex("soil", [r("soil", "soil_moisture_frac", 7)]).noData, false);
  assert.equal(
    ex("soil", [r("soil", "soil_moisture_frac", 0.5, 7)]).noData,
    true,
  );
  const e = ex("soil", [r("soil", "soil_moisture_frac", 0.37)]);
  assert.equal(e.headline, "Soil moisture 37%");
  assert.equal(e.next, "Rises to 6.0 at 40%");
});

test("weather: severity and gust tiers", () => {
  const g = (v) => ex("weather", [r("weather", "wind_gust_mph", v)]).score;
  assert.deepEqual([29.9, 30, 39.9, 40, 57.9, 58].map(g), [0, 3, 3, 6, 6, 9]);
  const sev = (v) =>
    ex("weather", [r("weather", "nws_alert_severity", v)]).score;
  assert.deepEqual([0, 1, 2, 3, 4, 5].map(sev), [0, 2, 4, 6, 8, 8]);
  const both = ex("weather", [
    r("weather", "nws_alert_severity", 1),
    r("weather", "wind_gust_mph", 45),
  ]);
  assert.equal(both.score, 6);
  assert.equal(both.headline, "Gusts 45 mph");
});

test("lightning: stop-work, recent strike, clear", () => {
  const l = (status, minsAgo, m) => ({
    lightning: {
      status,
      lastStrikeAt:
        minsAgo === null ? null : new Date(NOW - minsAgo * 60000).toISOString(),
      lastStrikeDistanceM: m,
    },
  });
  assert.equal(ex("lightning", [], {}, l("stop_work", 6, 9000)).score, 10);
  assert.equal(ex("lightning", [], {}, l("clear", 30, 20000)).score, 4);
  assert.equal(ex("lightning", [], {}, l("clear", 61, 20000)).score, 0);
  assert.equal(ex("lightning", [], {}, l("clear", 30, 50000)).score, 0);
  assert.equal(ex("lightning", [], {}, l("clear", null, null)).score, 0);
});

test("wildlife reads the crew score", () => {
  assert.equal(
    ex("wildlife", [], {}, { wildlifeScore: 2.04, wildlifeReports: 1 }).score,
    2,
  );
  assert.equal(ex("wildlife", [], {}).score, 0);
});

test("missing readings read as No recent reading with score 0", () => {
  for (const k of ["heat", "flood", "wildfire", "soil", "weather"]) {
    const e = ex(k, []);
    assert.equal(e.score, 0);
    assert.equal(e.headline, "No recent reading");
    assert.equal(e.noData, true);
  }
});

test("scoreDiffers ignores rounding only", () => {
  assert.equal(scoreDiffers(5, 5.04), false);
  assert.equal(scoreDiffers(5, 6), true);
});

test("explainIndex", () => {
  const heat = { name: "Heat", score: 5 };
  assert.equal(
    explainIndex(5.2, heat, 0.2),
    "5.2 = Heat 5.0 (worst hazard) + 0.2 from open crew reports",
  );
  assert.equal(explainIndex(5, heat, 0), "5.0 = Heat 5.0 (worst hazard)");
  assert.equal(
    explainIndex(6.2, heat, 0.2),
    "6.2 = ML hazard index 6.0 + 0.2 from open crew reports",
  );
  assert.equal(
    explainIndex(10, { name: "Lightning", score: 10 }, 1.5),
    "10.0 = Lightning 10.0 (worst hazard) + 1.5 from open crew reports, capped at 10",
  );
  assert.equal(
    explainIndex(5.2, { name: "Lightning", score: 10 }, 0),
    "5.2 · Lightning is now 10.0, index not yet updated",
  );
  assert.equal(explainIndex(0, null, 0), "0.0 = no active hazards");
  assert.equal(explainIndex(null, null, 0), "No index yet");
});
