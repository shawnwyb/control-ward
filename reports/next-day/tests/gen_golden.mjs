// Golden values from the live TypeScript, for tests/test_parity.py. Node 24 runs the .ts files directly
// (type stripping only). Run: node reports/next-day/tests/gen_golden.mjs > golden.json
import { hourlyPlan, ringPoints, workWindow } from "../../../supabase/functions/_shared/briefing.ts";

// Deterministic pseudo-random numbers, so the inputs are reproducible and travel inside the output.
let seed = 12345;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);

function location(startUtc, hours, hot) {
  const time = [], h = { temperature_2m: [], relative_humidity_2m: [], wind_speed_10m: [], wind_gusts_10m: [],
    shortwave_radiation: [], precipitation: [], precipitation_probability: [] };
  const t0 = Date.parse(startUtc);
  for (let i = 0; i < hours; i++) {
    const d = new Date(t0 + i * 3600000);
    time.push(d.toISOString().slice(0, 16));
    const day = Math.sin(((d.getUTCHours() - 8) / 24) * 2 * Math.PI);
    const nul = (v) => (rnd() < 0.04 ? null : v);
    h.temperature_2m.push(nul(Math.round((hot ? 88 : 68) + 14 * day + rnd() * 6)));
    h.relative_humidity_2m.push(nul(Math.round(35 + 50 * rnd())));
    h.wind_speed_10m.push(nul(+(rnd() * 18).toFixed(1)));
    h.wind_gusts_10m.push(nul(+(5 + 38 * rnd() ** 3).toFixed(1)));
    h.shortwave_radiation.push(nul(Math.max(0, Math.round(900 * day + rnd() * 80))));
    h.precipitation.push(nul(rnd() < 0.05 ? +(rnd() * 3).toFixed(1) : 0));
    h.precipitation_probability.push(nul(Math.round(100 * rnd() ** 8)));
  }
  return { hourly: { time, ...h } };
}

const cases = [
  { tz: "America/New_York", date: "2026-10-19", start: "2026-10-18T00:00", hot: false },
  { tz: "America/New_York", date: "2026-11-01", start: "2026-10-31T00:00", hot: true },   // clocks go back
  { tz: "America/Chicago", date: "2026-03-08", start: "2026-03-07T00:00", hot: true },    // clocks go forward
  { tz: "America/Phoenix", date: "2026-07-15", start: "2026-07-14T00:00", hot: true },
  { tz: "America/Los_Angeles", date: "2026-08-02", start: "2026-08-01T00:00", hot: false },
].map((c) => {
  const locations = [0, 1, 2].map((k) => location(c.start + ":00Z", 72, c.hot && k !== 2));
  const hours = hourlyPlan(locations, c.tz, c.date);
  return { ...c, locations, hours, window: workWindow(hours) };
});

const ring = [[25.4356, -80.3308], [47.9575, -118.9773], [89.9, 10], [-89.9, 10]].map(([lat, lon]) => ({
  lat, lon, points: ringPoints(lat, lon),
}));
console.log(JSON.stringify({ cases, ring }));
