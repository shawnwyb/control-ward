import test from "node:test";
import assert from "node:assert/strict";
import { rankSites, topHazards } from "../../src/lib/sites.ts";

const site = (name, riskNow) => ({ siteId: name, name, riskNow });

test("rankSites orders by risk desc, ties by name, nulls last", () => {
  const ranked = rankSites([
    site("C", 5),
    site("N", null),
    site("B", 8.6),
    site("A", 8.6),
  ]);
  assert.deepEqual(
    ranked.map((s) => s.name),
    ["A", "B", "C", "N"],
  );
});

test("rankSites does not mutate its input and keeps several nulls ordered by name", () => {
  const input = [site("Z", null), site("Y", null), site("X", 1)];
  const ranked = rankSites(input);
  assert.deepEqual(
    ranked.map((s) => s.name),
    ["X", "Y", "Z"],
  );
  assert.equal(input[0].name, "Z");
});

test("topHazards returns the highest non-zero subscores first", () => {
  assert.deepEqual(topHazards({ heat: 9, soil: 7, flood: 0 }), [
    "heat",
    "soil",
  ]);
  assert.deepEqual(topHazards({ heat: 9, soil: 7, flood: 8 }, 3), [
    "heat",
    "flood",
    "soil",
  ]);
  assert.deepEqual(topHazards({ heat: 0 }), []);
  assert.deepEqual(topHazards({}), []);
});

import {
  initialOverviewState,
  nextOverviewState,
} from "../../src/lib/sites.ts";

test("nextOverviewState: a failed first fetch is loaded with an error, not stuck loading", () => {
  const next = nextOverviewState(initialOverviewState, {
    ok: false,
    message: "boom",
  });
  assert.equal(next.loaded, true);
  assert.equal(next.error, "boom");
  assert.deepEqual(next.sites, []);
});

test("nextOverviewState: success clears the error; later failure keeps the last list", () => {
  const list = [site("A", 1)];
  const ok = nextOverviewState(
    { sites: [], loaded: true, error: "old" },
    { ok: true, sites: list },
  );
  assert.deepEqual(ok, { sites: list, loaded: true, error: null });
  const failed = nextOverviewState(ok, { ok: false, message: "x" });
  assert.equal(failed.sites, list);
  assert.equal(failed.error, "x");
});

import { siteSummaryFromRow, sitePinLabel } from "../../src/lib/sites.ts";

test("siteSummaryFromRow keeps missing coordinates as null", () => {
  const summary = siteSummaryFromRow({
    site_id: "s1",
    name: "A",
    lat: null,
    lon: null,
    risk_now: null,
    lightning: { status: "stop_work", last_strike_at: "x" },
  });
  assert.equal(summary.latitude, null);
  assert.equal(summary.longitude, null);
  assert.equal(summary.lightning.status, "stop_work");
  assert.equal(summary.activeAlerts, 0);
  assert.equal(siteSummaryFromRow({ site_id: null }), null);
  const placed = siteSummaryFromRow({ site_id: "s2", lat: 0, lon: 12.5 });
  assert.equal(placed.latitude, 0);
  assert.equal(placed.longitude, 12.5);
});

test("sitePinLabel names the site and its index, or says there is no score", () => {
  assert.equal(
    sitePinLabel({ name: "North", riskNow: 5.2 }),
    "North, hazard index 5.2",
  );
  assert.equal(sitePinLabel({ name: "N", riskNow: 7 }), "N, hazard index 7.0");
  assert.equal(
    sitePinLabel({ name: "E", riskNow: null }),
    "E, hazard index no score",
  );
});
