import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// Field Ledger names that were aliases during the migration. They must be
// gone from every stylesheet, from inline styles, and from tokens.css itself.
const retired = [
  "paper",
  "surface",
  "surface-sunken",
  "ink-muted",
  "ink-faint",
  "rule",
  "rule-strong",
  "brand",
  "brand-hover",
  "brand-pressed",
  "brand-soft",
  "brand-ink",
  "sev-1",
  "sev-1-bg",
  "sev-2",
  "sev-2-bg",
  "sev-3",
  "sev-3-bg",
  "ok",
  "ok-bg",
  "danger",
  "danger-bg",
  "focus",
  "map-ground",
];
const pattern = new RegExp(`--(?:${retired.join("|")})(?![\\w-])`);

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.(css|ts|tsx|html)$/.test(name) ? [path] : [];
  });
}

test("no Field Ledger alias tokens remain in src", () => {
  const hits = [];
  for (const path of [...files("src"), "index.html"]) {
    readFileSync(path, "utf8")
      .split("\n")
      .forEach((line, i) => {
        if (pattern.test(line)) hits.push(`${path}:${i + 1}: ${line.trim()}`);
      });
  }
  assert.deepEqual(hits, []);
});
