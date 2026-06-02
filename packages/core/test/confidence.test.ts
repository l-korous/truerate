import { test } from "node:test";
import assert from "node:assert/strict";
import { computeConfidence } from "../src/confidence.js";
import { matchBenefits } from "../src/match.js";
import { PROGRAMS, getProgram, instantiateBenefits } from "../src/programs.js";
import type { Membership } from "../src/types.js";

// Fixed reference date for deterministic tests: 2026-06-01
const NOW = new Date("2026-06-01T00:00:00Z");

// Helper: build a fake membership from a catalog program+tier.
function fakeMembership(programId: string, tier: string): Membership {
  const prog = getProgram(programId)!;
  return {
    id: `ms-${programId}`,
    label: prog.name,
    programId,
    tier,
    attributes: {},
    benefits: instantiateBenefits(prog, tier),
    addedAt: "2026-01-01",
    status: "active",
  };
}

// ---------------------------------------------------------------------------
// computeConfidence unit tests
// ---------------------------------------------------------------------------

test("high confidence: asOf within first half of TTL", () => {
  // hotel TTL = 6 months; asOf 2 months ago → age < 3 months → high
  const result = computeConfidence("2026-04", "hotel", "https://example.com", NOW);
  assert.equal(result.level, "high");
  assert.equal(result.score, 1.0);
  assert.equal(result.isExpired, false);
  assert.equal(result.ageMonths, 2);
});

test("medium confidence: asOf past half-TTL but within TTL", () => {
  // hotel TTL = 6 months; asOf 4 months ago → age between 3 and 6 → medium
  const result = computeConfidence("2026-02", "hotel", "https://example.com", NOW);
  assert.equal(result.level, "medium");
  assert.ok(result.score > 0.5 && result.score < 1.0, `expected 0.5 < score < 1.0, got ${result.score}`);
  assert.equal(result.isExpired, false);
});

test("low confidence: asOf past TTL but within 2×TTL", () => {
  // hotel TTL = 6 months; asOf 8 months ago → age between 6 and 12 → low
  const result = computeConfidence("2025-10", "hotel", "https://example.com", NOW);
  assert.equal(result.level, "low");
  assert.ok(result.score > 0.1 && result.score <= 0.5, `expected score in (0.1, 0.5], got ${result.score}`);
  assert.equal(result.isExpired, true); // past 1×TTL
});

test("stale confidence: asOf past 2×TTL", () => {
  // hotel TTL = 6 months; asOf 13 months ago → age ≥ 12 → stale
  const result = computeConfidence("2025-05", "hotel", "https://example.com", NOW);
  assert.equal(result.level, "stale");
  assert.equal(result.score, 0.1);
  assert.equal(result.isExpired, true);
});

test("missing asOf → stale with isExpired", () => {
  const result = computeConfidence(undefined, "hotel", undefined, NOW);
  assert.equal(result.level, "stale");
  assert.equal(result.score, 0.1);
  assert.equal(result.isExpired, true);
  assert.equal(result.ageMonths, Infinity);
});

test("missing sourceUrl reduces score by ~10%", () => {
  // Same asOf, one with sourceUrl and one without
  const withUrl = computeConfidence("2026-04", "hotel", "https://example.com", NOW);
  const noUrl = computeConfidence("2026-04", "hotel", undefined, NOW);
  assert.equal(withUrl.level, "high");
  assert.equal(noUrl.level, "high");
  assert.ok(noUrl.score < withUrl.score, "missing sourceUrl should reduce score");
  assert.equal(noUrl.score, 0.9); // 1.0 * 0.9
});

test("subscription TTL is shorter (3 months)", () => {
  // subscription TTL = 3 months; asOf 2 months ago → past half-TTL (1.5m) → medium
  const result = computeConfidence("2026-04", "subscription", "https://example.com", NOW);
  assert.equal(result.level, "medium");
});

test("airline TTL is longer (12 months) — same age stays high", () => {
  // airline TTL = 12 months; asOf 4 months ago → age < 6 months (half-TTL) → high
  const result = computeConfidence("2026-02", "airline", "https://example.com", NOW);
  assert.equal(result.level, "high");
});

test("expiresAt is correct ISO date string", () => {
  // hotel TTL = 6 months; asOf 2026-04 → expires 2026-10-01
  const result = computeConfidence("2026-04", "hotel", "https://example.com", NOW);
  assert.equal(result.expiresAt, "2026-10-01");
});

// ---------------------------------------------------------------------------
// matchBenefits with confidence
// ---------------------------------------------------------------------------

test("matchBenefits without programs map omits confidence field", () => {
  const ms = fakeMembership("booking_genius", "Level 3");
  const results = matchBenefits([ms], { domain: "booking.com" });
  assert.ok(results.length > 0);
  for (const r of results) {
    assert.equal(r.confidence, undefined, "confidence should be absent without programs map");
  }
});

test("matchBenefits with programs map attaches confidence", () => {
  const ms = fakeMembership("booking_genius", "Level 3");
  const prog = getProgram("booking_genius")!;
  const programs = new Map([[prog.id, prog]]);
  const results = matchBenefits([ms], { domain: "booking.com" }, { programs, now: NOW });
  assert.ok(results.length > 0);
  for (const r of results) {
    assert.ok(r.confidence, "confidence should be present when programs map is provided");
    assert.ok(["high", "medium", "low", "stale"].includes(r.confidence!.level));
    assert.ok(r.confidence!.score > 0 && r.confidence!.score <= 1.0);
  }
});

test("matchBenefits: benefit with no programId gets no confidence even with programs map", () => {
  const ms: Membership = {
    id: "ms-custom",
    label: "Custom perk",
    attributes: {},
    benefits: [{
      id: "b-custom",
      scope: "domain",
      match: { domains: ["example.com"] },
      value: { kind: "perk", perks: ["Free wifi"] },
      source: "user-declared",
      // programId absent
    }],
    addedAt: "2026-01-01",
    status: "active",
  };
  const prog = getProgram("booking_genius")!;
  const programs = new Map([[prog.id, prog]]);
  const results = matchBenefits([ms], { domain: "example.com" }, { programs, now: NOW });
  assert.equal(results.length, 1);
  assert.equal(results[0].confidence, undefined);
});

test("all catalog programs have asOf and sourceUrl (confidence data present)", () => {
  const missing = PROGRAMS.filter((p) => !p.asOf || !p.sourceUrl);
  assert.deepEqual(
    missing.map((p) => p.id),
    [],
    `Programs missing asOf or sourceUrl: ${missing.map((p) => p.id).join(", ")}`,
  );
});
