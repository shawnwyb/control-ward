import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  wbgtF,
  heatIndexF,
  wetBulbC,
} from "../../supabase/functions/_shared/heat.ts";
import {
  addDays,
  localDate,
  overnightWindow,
  zonedToUtc,
} from "../../supabase/functions/_shared/time.ts";
import {
  buildReadings,
  openMeteoUrl,
  parseLocations,
} from "../../supabase/functions/_shared/openmeteo.ts";
import { summarizeAlerts } from "../../supabase/functions/_shared/nws.ts";
import {
  parseNwps,
  parseUsgs,
} from "../../supabase/functions/_shared/gauges.ts";
import {
  nearestFires,
  parseFires,
} from "../../supabase/functions/_shared/nifc.ts";
import { haversineMiles } from "../../supabase/functions/_shared/geo.ts";

describe("heat", () => {
  test("Stull wet bulb matches the paper's example (20 C, 50% RH is about 13.7 C)", () => {
    assert.ok(Math.abs(wetBulbC(20, 50) - 13.7) < 0.3);
  });
  test("heat index follows the NWS chart (90 F at 70% is about 106 F)", () => {
    assert.ok(Math.abs(heatIndexF(90, 70) - 105.9) < 2);
    assert.ok(heatIndexF(70, 40) < 80);
  });
  test("WBGT rises with sun, falls with wind, and stays below air temperature when humid shade", () => {
    const sunny = wbgtF(95, 60, 5, 850);
    assert.ok(sunny > 88 && sunny < 98, `sunny ${sunny}`);
    assert.ok(wbgtF(95, 60, 5, 0) < sunny);
    assert.ok(wbgtF(95, 60, 15, 850) < sunny);
    assert.ok(wbgtF(70, 50, 5, 0) < 70);
  });
});

describe("time", () => {
  test("zoned conversion handles DST (Eastern, 18:00 on 17 Oct is EDT = 22:00Z; 18:00 on 10 Nov is EST = 23:00Z)", () => {
    assert.equal(
      new Date(zonedToUtc("2026-10-17", 18, "America/New_York")).toISOString(),
      "2026-10-17T22:00:00.000Z",
    );
    assert.equal(
      new Date(zonedToUtc("2026-11-10", 18, "America/New_York")).toISOString(),
      "2026-11-10T23:00:00.000Z",
    );
  });
  test("local date and day math", () => {
    assert.equal(
      localDate(Date.parse("2026-10-18T02:00:00Z"), "America/New_York"),
      "2026-10-17",
    );
    assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  });
  test("overnight window: after 18:00 starts tonight, before 18:00 uses last night ending 06:00", () => {
    const evening = overnightWindow(
      Date.parse("2026-10-17T23:30:00Z"),
      "America/New_York",
    ); // 19:30 EDT
    assert.equal(
      new Date(evening.start).toISOString(),
      "2026-10-17T22:00:00.000Z",
    );
    const noon = overnightWindow(
      Date.parse("2026-10-17T16:00:00Z"),
      "America/New_York",
    ); // 12:00 EDT
    assert.equal(
      new Date(noon.start).toISOString(),
      "2026-10-16T22:00:00.000Z",
    );
    assert.equal(new Date(noon.end).toISOString(), "2026-10-17T10:00:00.000Z");
    const night = overnightWindow(
      Date.parse("2026-10-17T07:00:00Z"),
      "America/New_York",
    ); // 03:00 EDT, in progress
    assert.equal(night.end, Date.parse("2026-10-17T07:00:00Z"));
  });
});

describe("open-meteo", () => {
  const site = {
    id: "s1",
    latitude: 29.65,
    longitude: -82.32,
    timezone: "America/New_York",
    usgs_gauge_id: null,
  };
  function location() {
    const time = [],
      rec = {
        temperature_2m: [],
        relative_humidity_2m: [],
        wind_speed_10m: [],
        wind_gusts_10m: [],
        shortwave_radiation: [],
        precipitation: [],
        precipitation_probability: [],
        soil_moisture_0_to_1cm: [],
      };
    const start = Date.parse("2026-10-15T00:00:00Z");
    for (let i = 0; i < 120; i++) {
      time.push(new Date(start + i * 3600_000).toISOString().slice(0, 16));
      rec.temperature_2m.push(92);
      rec.relative_humidity_2m.push(60);
      rec.wind_speed_10m.push(5);
      rec.wind_gusts_10m.push(i === 84 ? 45 : 12);
      rec.shortwave_radiation.push(700);
      rec.precipitation.push(i >= 52 && i <= 56 ? 6 : 0);
      rec.precipitation_probability.push(20);
      rec.soil_moisture_0_to_1cm.push(0.42);
    }
    return { hourly: { time, ...rec } };
  }
  const now = Date.parse("2026-10-17T16:30:00Z");
  test("url batches every site in one request", () => {
    const url = new URL(
      openMeteoUrl([site, { ...site, latitude: 30, longitude: -90 }]),
    );
    assert.equal(url.searchParams.get("latitude"), "29.6500,30.0000");
    assert.equal(url.searchParams.get("timezone"), "UTC");
  });
  test("builds live, overnight and daily forecast rows with fixed units", () => {
    const rows = buildReadings(site, location(), now);
    const live = (hz, unit) =>
      rows.find((r) => r.hazard === hz && r.unit === unit && !r.forecast_for);
    assert.ok(live("heat", "wbgt_f").value > 85);
    assert.equal(live("soil", "soil_moisture_frac").value, 0.42);
    assert.equal(live("weather", "precip_prob_pct").value, 20);
    assert.equal(live("flood", "precip_mm_overnight").value, 30); // hours 52..56 sit inside the overnight window
    assert.equal(live("flood", "precip_mm_24h").value, 30);
    assert.equal(
      live("heat", "wbgt_f").observed_at,
      "2026-10-17T16:00:00.000Z",
    );
    const forecast = rows.filter((r) => r.forecast_for);
    const tomorrowGust = forecast.find(
      (r) =>
        r.unit === "wind_gust_mph" && r.forecast_for.startsWith("2026-10-18"),
    );
    assert.equal(tomorrowGust.value, 45);
    assert.equal(forecast.filter((r) => r.unit === "wbgt_f").length, 2);
  });
  test("handles a single-location response and missing hours", () => {
    assert.equal(parseLocations(location()).length, 1);
    assert.equal(parseLocations([location(), location()]).length, 2);
    assert.deepEqual(
      buildReadings(site, { hourly: { time: ["2030-01-01T00:00"] } }, now),
      [],
    );
  });
});

describe("alerts, gauges and fires", () => {
  test("NWS severity and flood warnings", () => {
    const body = {
      features: [
        {
          properties: {
            severity: "Severe",
            event: "Severe Thunderstorm Warning",
            status: "Actual",
          },
        },
        {
          properties: {
            severity: "Moderate",
            event: "Flash Flood Warning",
            status: "Actual",
          },
        },
        {
          properties: {
            severity: "Extreme",
            event: "Tornado Warning",
            status: "Test",
          },
        },
      ],
    };
    assert.deepEqual(summarizeAlerts(body), { severity: 3, floodWarning: 1 });
    assert.deepEqual(summarizeAlerts({}), { severity: 0, floodWarning: 0 });
  });
  test("NWPS ignores undefined stages and sentinel values", () => {
    assert.deepEqual(
      parseNwps({
        flood: { categories: { minor: { stage: -9999 } } },
        status: {
          observed: {
            primary: 3.21,
            primaryUnit: "ft",
            floodCategory: "not_defined",
          },
        },
      }),
      { stage: 3.21, floodStage: null, inFlood: false },
    );
    assert.deepEqual(
      parseNwps({
        flood: { categories: { minor: { stage: 18 } } },
        status: {
          observed: {
            primary: 19.5,
            primaryUnit: "ft",
            floodCategory: "minor",
          },
        },
      }),
      { stage: 19.5, floodStage: 18, inFlood: true },
    );
    assert.equal(
      parseNwps({ status: { observed: { primary: 900, primaryUnit: "kcfs" } } })
        .stage,
      null,
    );
  });
  test("USGS instantaneous values", () => {
    const body = {
      value: {
        timeSeries: [
          {
            sourceInfo: { siteCode: [{ value: "07374525" }] },
            values: [{ value: [{ value: "3.10" }, { value: "3.21" }] }],
          },
        ],
      },
    };
    assert.equal(parseUsgs(body).get("07374525"), 3.21);
  });
  test("fires: skip contained or tiny incidents, find nearest and count within 25 mi", () => {
    const fires = parseFires({
      features: [
        {
          attributes: { IncidentSize: 500, PercentContained: 10 },
          geometry: { x: -82.0, y: 29.7 },
        },
        {
          attributes: { IncidentSize: 5, PercentContained: 0 },
          geometry: { x: -82.31, y: 29.66 },
        },
        {
          attributes: { IncidentSize: 900, PercentContained: 100 },
          geometry: { x: -82.31, y: 29.66 },
        },
      ],
    });
    assert.equal(fires.length, 1);
    const r = nearestFires({ latitude: 29.65, longitude: -82.32 }, fires);
    assert.ok(
      Math.abs(r.nearest - haversineMiles(29.65, -82.32, 29.7, -82.0)) < 1e-9,
    );
    assert.equal(r.within, 1);
    assert.deepEqual(nearestFires({ latitude: 0, longitude: 0 }, []), {
      nearest: null,
      within: 0,
    });
  });
});

import {
  bucketIso,
  chunk,
  pool,
} from "../../supabase/functions/_shared/util.ts";
describe("util", () => {
  test("chunk, bucket and pool", async () => {
    assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
    assert.equal(
      bucketIso(Date.parse("2026-10-17T16:37:12Z"), 15),
      "2026-10-17T16:30:00.000Z",
    );
    let active = 0,
      peak = 0;
    const out = await pool([1, 2, 3, 4, 5, 6], 2, async (n) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      if (n === 3) throw new Error("boom");
      return n * 2;
    });
    assert.deepEqual(out, [2, 4, null, 8, 10, 12]);
    assert.ok(peak <= 2);
  });
});

import fs from "node:fs";
import * as hdf5 from "jsfive";
import {
  extractStrikes,
  listingPrefixes,
  parseListing,
  recentKeys,
} from "../../supabase/functions/_shared/glm.ts";
import { boundingBox } from "../../supabase/functions/_shared/geo.ts";
describe("GOES GLM", () => {
  const buf = fs.readFileSync(
    new URL("../fixtures/glm-sample.nc", import.meta.url),
  );
  const file = new hdf5.File(
    buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
  );
  const world = { south: -90, north: 90, west: -180, east: 180 };
  const start = Date.parse("2026-10-17T17:20:00Z");
  test("extracts good-quality flashes inside the 20 second file window", () => {
    const all = extractStrikes(file, world);
    assert.ok(all.length > 50 && all.length < 308, `kept ${all.length}`);
    for (const s of all) {
      const t = Date.parse(s.struck_at);
      assert.ok(t >= start && t <= start + 20_000, s.struck_at);
      assert.equal(s.source, "goes-glm");
    }
  });
  test("filters to the site bounding box", () => {
    const conus = extractStrikes(file, {
      south: 24,
      north: 50,
      west: -125,
      east: -66,
    });
    assert.ok(conus.length < extractStrikes(file, world).length);
    for (const s of conus)
      assert.ok(s.lat >= 24 && s.lat <= 50 && s.lon >= -125 && s.lon <= -66);
    assert.deepEqual(
      boundingBox(
        [
          { latitude: 30, longitude: -90 },
          { latitude: 40, longitude: -80 },
        ],
        1,
      ),
      { south: 29, north: 41, west: -91, east: -79 },
    );
  });
  test("lists hour folders and picks only fresh files", () => {
    const now = Date.parse("2026-10-17T18:01:00Z");
    assert.deepEqual(listingPrefixes(now, 150_000), [
      "GLM-L2-LCFA/2026/290/18/",
      "GLM-L2-LCFA/2026/290/17/",
    ]);
    const xml =
      "<Contents><Key>a/1.nc</Key><LastModified>2026-10-17T18:00:40.000Z</LastModified></Contents>" +
      "<Contents><Key>a/0.nc</Key><LastModified>2026-10-17T17:50:00.000Z</LastModified></Contents>";
    assert.deepEqual(recentKeys(parseListing(xml), now, 150_000), ["a/1.nc"]);
  });
});
