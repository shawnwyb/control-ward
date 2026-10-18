import test from "node:test";
import assert from "node:assert/strict";
import { riskTone } from "../../src/lib/risk.ts";

test("riskTone follows the riskLevel bands", () => {
  assert.equal(riskTone(8.6), "high");
  assert.equal(riskTone(7), "high");
  assert.equal(riskTone(4), "elevated");
  assert.equal(riskTone(3.9), "low");
  assert.equal(riskTone(null), "none");
});
