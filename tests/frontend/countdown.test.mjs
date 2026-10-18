import test from "node:test";
import assert from "node:assert/strict";
import { allClearRemaining, formatCountdown } from "../../src/lib/countdown.ts";

const now = Date.parse("2026-10-17T15:00:00Z");
const ago = (ms) => new Date(now - ms).toISOString();

test("a strike 7m46s ago leaves 22:14", () => {
  const left = allClearRemaining(ago((7 * 60 + 46) * 1000), now);
  assert.equal(formatCountdown(left), "22:14");
});

test("a strike older than 30 minutes has no countdown", () => {
  assert.equal(allClearRemaining(ago(31 * 60 * 1000), now), null);
  assert.equal(allClearRemaining(ago(30 * 60 * 1000), now), null);
});

test("no strike, or an unreadable time, has no countdown", () => {
  assert.equal(allClearRemaining(null, now), null);
  assert.equal(allClearRemaining("not a date", now), null);
});

test("never negative, and a strike in the future caps at 30:00", () => {
  const left = allClearRemaining(ago(-5 * 60 * 1000), now);
  assert.equal(left, 30 * 60 * 1000);
  assert.equal(formatCountdown(-5), "00:00");
});
