import { test } from "node:test";
import assert from "node:assert/strict";
import { computeStalenessLevel } from "../lib/catalog-confidence.js";

// Fixed "now" date for deterministic tests: 2026-06-01
const NOW = new Date(Date.UTC(2026, 5, 1)); // June 2026

test("computeStalenessLevel returns 'stale' when asOf is undefined", () => {
  assert.strictEqual(computeStalenessLevel(undefined, "hotel", NOW), "stale");
});

test("computeStalenessLevel returns 'stale' when asOf is malformed", () => {
  assert.strictEqual(computeStalenessLevel("not-a-date", "hotel", NOW), "stale");
});

test("computeStalenessLevel returns 'high' for a very recent hotel entry", () => {
  // Hotel TTL = 6 months; < 3 months old → high
  assert.strictEqual(computeStalenessLevel("2026-04", "hotel", NOW), "high");
});

test("computeStalenessLevel returns 'medium' for a 4-month-old hotel entry", () => {
  // Hotel TTL = 6 months; 4 months old → between 3 (0.5×TTL) and 6 (1×TTL) → medium
  assert.strictEqual(computeStalenessLevel("2026-02", "hotel", NOW), "medium");
});

test("computeStalenessLevel returns 'low' for an 8-month-old hotel entry", () => {
  // Hotel TTL = 6 months; 8 months old → between 6 (1×TTL) and 12 (2×TTL) → low
  assert.strictEqual(computeStalenessLevel("2025-10", "hotel", NOW), "low");
});

test("computeStalenessLevel returns 'stale' for a 14-month-old hotel entry", () => {
  // Hotel TTL = 6 months; 14 months > 2×TTL → stale
  assert.strictEqual(computeStalenessLevel("2025-04", "hotel", NOW), "stale");
});

test("computeStalenessLevel respects subscription TTL of 3 months", () => {
  // Subscription TTL = 3 months; 1 month old < 1.5 months (0.5×3) → high
  assert.strictEqual(computeStalenessLevel("2026-05", "subscription", NOW), "high");
  // 2 months old: 1.5 <= 2 < 3 → medium
  assert.strictEqual(computeStalenessLevel("2026-04", "subscription", NOW), "medium");
  // 4 months old > 1×TTL (3) but < 2×TTL (6) → low
  assert.strictEqual(computeStalenessLevel("2026-02", "subscription", NOW), "low");
  // 7 months old > 2×TTL → stale
  assert.strictEqual(computeStalenessLevel("2025-11", "subscription", NOW), "stale");
});

test("computeStalenessLevel respects airline TTL of 12 months", () => {
  // Airline TTL = 12 months; 5 months old < 6 months (0.5×12) → high
  assert.strictEqual(computeStalenessLevel("2026-01", "airline", NOW), "high");
  // 15 months old > 12 but < 24 → low
  assert.strictEqual(computeStalenessLevel("2025-03", "airline", NOW), "low");
});

test("computeStalenessLevel uses default TTL of 6 months for unknown category", () => {
  // unknown category defaults to 6 months; 4 months old → medium
  assert.strictEqual(computeStalenessLevel("2026-02", "unknown_category", NOW), "medium");
});

test("computeStalenessLevel never returns a price-related result", () => {
  const result = computeStalenessLevel("2025-01", "hotel", NOW);
  const priceRelated = ["price", "amount", "nightly", "total"];
  for (const word of priceRelated) {
    assert.ok(!result.includes(word), `result should not contain "${word}"`);
  }
});
