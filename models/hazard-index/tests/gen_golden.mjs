// Golden values from the live TypeScript, for tests/test_parity.py. Node 24 runs the .ts files
// directly because heat.ts and time.ts have no imports and no enums (type stripping only).
// Run: node models/hazard-index/tests/gen_golden.mjs > golden.json
import { heatIndexF, wbgtF, wetBulbC } from "../../../supabase/functions/_shared/heat.ts";
import { addDays, localDate, overnightWindow, zonedToUtc } from "../../../supabase/functions/_shared/time.ts";

const temps = [-4, 14, 32, 50, 68, 77, 79.9, 80, 83, 86, 87, 87.1, 90, 95, 100, 105, 112, 112.1, 115, 120];
const rhs = [0, 3, 5, 10, 12.9, 13, 20, 40, 60, 85, 85.1, 90, 99, 100];
const winds = [-1, 0, 2.5, 10, 30];
const suns = [-5, 0, 300, 850, 1100];

const heat = [];
for (const t of temps)
  for (const rh of rhs) {
    const row = { t, rh, hi: heatIndexF(t, rh), wb: wetBulbC((t - 32) * 5 / 9, Math.min(Math.max(rh, 5), 99)), wbgt: [] };
    for (const w of winds) for (const s of suns) row.wbgt.push([w, s, wbgtF(t, rh, w, s)]);
    heat.push(row);
  }

const zones = ["America/New_York", "America/Chicago", "America/Denver", "America/Phoenix",
  "America/Los_Angeles", "America/Detroit", "America/Indiana/Indianapolis"];
// DST changes 2015-2026 plus ordinary days and a year end.
const days = ["2015-03-08", "2015-11-01", "2020-03-08", "2020-11-01", "2024-03-10", "2024-11-03",
  "2025-03-09", "2025-11-02", "2026-03-08", "2026-11-01", "2024-07-04", "2025-12-31", "2026-10-17"];
const zoned = [], local = [], overnight = [];
for (const tz of zones)
  for (const d of days) {
    for (let h = 0; h < 24; h++) zoned.push([d, h, tz, zonedToUtc(d, h, tz)]);
    const start = Date.parse(`${addDays(d, -1)}T00:00:00Z`);
    for (let i = 0; i < 72; i++) {
      const ms = start + i * 3600_000 + (i % 3) * 1_200_000; // on the hour and 20/40 minutes past
      local.push([ms, tz, localDate(ms, tz)]);
      const w = overnightWindow(ms, tz);
      overnight.push([ms, tz, w.start, w.end]);
    }
  }
process.stdout.write(JSON.stringify({ heat, zoned, local, overnight, addDays: [["2026-12-31", 1, addDays("2026-12-31", 1)], ["2024-03-01", -1, addDays("2024-03-01", -1)]] }));
