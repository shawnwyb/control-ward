import test from "node:test";
import assert from "node:assert/strict";
import { allowedPage, homeFor, parseRoute } from "../../src/lib/route.ts";

test("parseRoute reads the hash and falls back to landing", () => {
  assert.equal(parseRoute("#/alerts"), "alerts");
  assert.equal(parseRoute("#/sign-in"), "sign-in");
  assert.equal(parseRoute(""), "landing");
  assert.equal(parseRoute("#/"), "landing");
  assert.equal(parseRoute("#/nope"), "landing");
});

test("homeFor sends each role to its first page", () => {
  assert.equal(homeFor("supervisor"), "sites");
  assert.equal(homeFor("crew"), "site");
});

test("allowedPage keeps role-only pages away from the wrong role", () => {
  assert.equal(allowedPage("crew", "crew"), "site");
  assert.equal(allowedPage("sites", "crew"), "site");
  assert.equal(allowedPage("site", "supervisor"), "sites");
  assert.equal(allowedPage("alerts", "crew"), "alerts");
  assert.equal(allowedPage("reports", "supervisor"), "reports");
  assert.equal(allowedPage("crew", "supervisor"), "crew");
});
