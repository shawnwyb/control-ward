import test from "node:test";
import assert from "node:assert/strict";
import {
  compass,
  parseConditions,
  metersToMiles,
  ago,
  formatRain,
  conditionsUrl,
} from "../../src/lib/conditions.ts";

test("compass names 16 points and wraps", () => {
  assert.equal(compass(0), "N");
  assert.equal(compass(250), "WSW");
  assert.equal(compass(359), "N");
  assert.equal(compass(-90), "W");
  assert.equal(compass(90), "E");
});

const good = {
  current: {
    temperature_2m: 91.2,
    apparent_temperature: 104,
    precipitation: 0.12,
    wind_speed_10m: 12,
    wind_direction_10m: 250,
    wind_gusts_10m: 22,
  },
};

test("parseConditions reads a full answer", () => {
  assert.deepEqual(parseConditions(good), {
    tempF: 91.2,
    feelsLikeF: 104,
    rainIn: 0.12,
    windMph: 12,
    gustMph: 22,
    windDir: "WSW",
  });
});

test("parseConditions rejects missing or bad data", () => {
  assert.equal(parseConditions(null), null);
  assert.equal(parseConditions({}), null);
  assert.equal(
    parseConditions({ current: { ...good.current, precipitation: null } }),
    null,
  );
});

test("formatting helpers", () => {
  assert.equal(formatRain(0.12), "0.12 in/hr");
  assert.equal(metersToMiles(8046.72), "5.0");
  assert.equal(ago(0, 3 * 60000 + 5000), "3 min ago");
  assert.equal(ago(0, 1000), "just now");
  assert.match(conditionsUrl(1, 2), /temperature_unit=fahrenheit/);
});
