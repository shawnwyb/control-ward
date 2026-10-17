import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  clampWindow,
  hourlyPlan,
  parseGemini,
  ringPoints,
  workWindow,
} from "../../supabase/functions/_shared/briefing.ts";
import {
  isGone,
  parseSubscription,
  pushPayload,
} from "../../supabase/functions/_shared/push.ts";

// One Open-Meteo-shaped location for 2026-06-10 in UTC, with per-hour overrides.
function location(overrides = {}) {
  const time = [];
  const h = {
    temperature_2m: [],
    relative_humidity_2m: [],
    wind_speed_10m: [],
    wind_gusts_10m: [],
    shortwave_radiation: [],
    precipitation: [],
    precipitation_probability: [],
  };
  for (let i = 0; i < 24; i++) {
    time.push(`2026-06-10T${String(i).padStart(2, "0")}:00`);
    h.temperature_2m.push(70);
    h.relative_humidity_2m.push(40);
    h.wind_speed_10m.push(5);
    h.wind_gusts_10m.push(10);
    h.shortwave_radiation.push(0);
    h.precipitation.push(0);
    h.precipitation_probability.push(0);
  }
  for (const [hour, values] of Object.entries(overrides))
    for (const [key, value] of Object.entries(values))
      h[key][Number(hour)] = value;
  return { hourly: { time, ...h } };
}

describe("ringPoints", () => {
  test("centre plus a ring about 20 km away", () => {
    const pts = ringPoints(29.65, -82.32);
    assert.equal(pts.length, 7);
    assert.deepEqual(pts[0], { latitude: 29.65, longitude: -82.32 });
    for (const p of pts.slice(1)) {
      const dy = (p.latitude - 29.65) * 111.32;
      const dx =
        (p.longitude + 82.32) * 111.32 * Math.cos((29.65 * Math.PI) / 180);
      assert.ok(Math.abs(Math.hypot(dx, dy) - 20) < 0.5);
    }
  });
});

describe("hourlyPlan and workWindow", () => {
  test("a calm day gives the whole working day", () => {
    const hours = hourlyPlan([location()], "UTC", "2026-06-10");
    assert.ok(hours.every((h) => h.safe));
    assert.deepEqual(workWindow(hours), { start: "06:00", end: "19:00" });
  });

  test("worst point in the ring wins", () => {
    const stormy = location({ 13: { precipitation_probability: 90 } });
    const hours = hourlyPlan([location(), stormy], "UTC", "2026-06-10");
    assert.equal(hours[13].safe, false);
    assert.deepEqual(hours[13].blocked_by, ["storms"]);
  });

  test("picks the longest safe run and ignores a one-hour gap", () => {
    const hours = hourlyPlan(
      [location({ 9: { wind_gusts_10m: 45 }, 10: { wind_gusts_10m: 45 } })],
      "UTC",
      "2026-06-10",
    );
    assert.deepEqual(workWindow(hours), { start: "11:00", end: "19:00" });
  });

  test("returns null when no two-hour window exists", () => {
    const o = {};
    for (let h = 6; h < 19; h++) o[h] = { precipitation: 3 };
    const hours = hourlyPlan([location(o)], "UTC", "2026-06-10");
    assert.equal(workWindow(hours), null);
  });

  test("missing forecast hours are not treated as safe", () => {
    const hours = hourlyPlan([], "UTC", "2026-06-10");
    assert.ok(hours.every((h) => !h.safe));
  });
});

describe("parseGemini and clampWindow", () => {
  test("extracts JSON from fenced text", () => {
    const parsed = parseGemini(
      'Here you go:\n```json\n{"work_window":{"start":"07:00","end":"15:00"},"summary":"Go early.","reasons":["School buses at 7:30"],"context":{"traffic":"Heavy at 8.","school":"In session.","wildlife":"Snakes active."}}\n```',
    );
    assert.deepEqual(parsed.work_window, { start: "07:00", end: "15:00" });
    assert.equal(parsed.context.school, "In session.");
  });

  test("rejects answers without a summary or valid JSON", () => {
    assert.equal(parseGemini("no json here"), null);
    assert.equal(parseGemini('{"work_window":null}'), null);
    assert.equal(parseGemini("{broken"), null);
  });

  test("drops malformed windows", () => {
    const parsed = parseGemini(
      '{"work_window":{"start":"9am","end":"5pm"},"summary":"x"}',
    );
    assert.equal(parsed.work_window, null);
  });

  test("clamp never widens the safe window", () => {
    const safe = { start: "08:00", end: "14:00" };
    assert.deepEqual(clampWindow({ start: "06:00", end: "18:00" }, safe), safe);
    assert.deepEqual(clampWindow({ start: "09:00", end: "12:00" }, safe), {
      start: "09:00",
      end: "12:00",
    });
    assert.equal(clampWindow({ start: "15:00", end: "17:00" }, safe), null);
    assert.equal(clampWindow({ start: "09:00", end: "12:00" }, null), null);
  });
});

describe("push helpers", () => {
  test("parses a valid subscription and rejects others", () => {
    const good = JSON.stringify({
      endpoint: "https://push.example/abc",
      keys: { p256dh: "k", auth: "a" },
    });
    assert.equal(parseSubscription(good).endpoint, "https://push.example/abc");
    assert.equal(parseSubscription("not json"), null);
    assert.equal(
      parseSubscription(
        JSON.stringify({
          endpoint: "http://insecure",
          keys: { p256dh: "k", auth: "a" },
        }),
      ),
      null,
    );
    assert.equal(
      parseSubscription(JSON.stringify({ endpoint: "https://x" })),
      null,
    );
  });

  test("marks stop-work alerts urgent", () => {
    const p = JSON.parse(
      pushPayload({
        id: "1",
        site_id: "s",
        kind: "alert",
        title: "STOP WORK · Plant",
        body: "b",
      }),
    );
    assert.equal(p.urgent, true);
    assert.equal(
      JSON.parse(
        pushPayload({
          id: "1",
          site_id: "s",
          kind: "manual",
          title: "Hi",
          body: "b",
        }),
      ).urgent,
      false,
    );
  });

  test("each manual push gets its own tag; alerts share one per site and re-alert", () => {
    const tag = (row) => JSON.parse(pushPayload(row));
    const a = tag({
      id: "1",
      site_id: "s",
      kind: "manual",
      title: "t",
      body: "b",
    });
    const b = tag({
      id: "2",
      site_id: "s",
      kind: "manual",
      title: "t",
      body: "b",
    });
    assert.notEqual(a.tag, b.tag);
    assert.equal(a.renotify, false);
    const x = tag({
      id: "3",
      site_id: "s",
      kind: "alert",
      title: "t",
      body: "b",
    });
    const y = tag({
      id: "4",
      site_id: "s",
      kind: "alert",
      title: "t",
      body: "b",
    });
    assert.equal(x.tag, y.tag);
    assert.equal(x.renotify, true);
  });

  test("404 and 410 mean the subscription is gone", () => {
    assert.ok(isGone(404) && isGone(410));
    assert.ok(!isGone(500) && !isGone(undefined));
  });
});
