// Node runs the .ts directly (type stripping). Run: node --test tests/nextday/routesList.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  flaggedRoutes,
  milesText,
  routeLabel,
  totalFlaggedFeet,
} from "../../src/features/nextday/routesList.ts";

const piece = (osm_id, length_ft, truck, excavator, extra = {}) => ({
  properties: {
    osm_id,
    highway: "service",
    name: null,
    length_ft,
    r: { road_truck: truck, excavator },
    ...extra,
  },
});

const features = [
  piece(1, 300, [2, 6.5, 9.2], [1, 4.0, 5.0]),
  piece(1, 310, [2, 6.5, 11.0], [0, 2.0, 1.0]),
  piece(2, 900, [1, 4.0, 5.5], [0, 2.0, 2.0], {
    highway: "track",
    name: "Poinsettia Road",
  }),
  piece(3, 400, [0, 2.0, 1.0], [0, 2.0, 1.0]), // ok for both: never listed
  piece(4, 250, [2, 6.5, 8.5], undefined), // no result for the excavator
];

test("pieces of one way are added together and the worst result wins", () => {
  const r = flaggedRoutes(features, "road_truck");
  assert.deepEqual(
    r.map((x) => x.osmId),
    [1, 4, 2],
  ); // hold first (longest first), then inspect
  assert.equal(r[0].flaggedFeet, 610);
  assert.equal(r[0].pieces, 2);
  assert.equal(r[0].worstRutIn, 11.0);
  assert.equal(r[0].worstFlag, 2);
  assert.equal(r[2].worstFlag, 1);
});

test("the equipment class changes which routes are flagged", () => {
  const r = flaggedRoutes(features, "excavator");
  assert.deepEqual(
    r.map((x) => x.osmId),
    [1],
  );
  assert.equal(r[0].flaggedFeet, 300); // only the first piece is flagged for this class
  assert.deepEqual(flaggedRoutes(features, "crawler_crane"), []);
});

test("labels name the road or say what kind of unnamed road it is", () => {
  const r = flaggedRoutes(features, "road_truck");
  assert.equal(routeLabel(r[0]), "Unnamed service road");
  assert.equal(routeLabel(r[2]), "Poinsettia Road");
  assert.equal(
    routeLabel({ ...r[0], highway: "tertiary" }),
    "Unnamed tertiary",
  );
});

test("length helpers", () => {
  assert.equal(milesText(2640), "0.50 mi");
  assert.equal(milesText(5280 * 12), "12.0 mi");
  assert.equal(
    totalFlaggedFeet(flaggedRoutes(features, "road_truck")),
    610 + 250 + 900,
  );
  assert.deepEqual(flaggedRoutes([], "road_truck"), []);
});
