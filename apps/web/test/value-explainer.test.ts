import { test } from "node:test";
import assert from "node:assert/strict";
import { computeValueRollup } from "../components/ValueExplainer";
import type { PublicMembership, PerkEstimates } from "../lib/api";

function makeMembership(overrides: Partial<PublicMembership> & { id: string }): PublicMembership {
  return {
    label: "Test",
    programId: undefined,
    tier: undefined,
    attributes: {},
    hasCredential: false,
    status: "active",
    benefits: [],
    ...overrides,
  };
}

const ESTIMATES: PerkEstimates = {
  free_breakfast: {
    3: { perkType: "free_breakfast", starBand: 3, estimatedUsd: 15, isEstimate: true },
    4: { perkType: "free_breakfast", starBand: 4, estimatedUsd: 25, isEstimate: true },
    5: { perkType: "free_breakfast", starBand: 5, estimatedUsd: 50, isEstimate: true },
  },
  room_upgrade: {
    3: { perkType: "room_upgrade", starBand: 3, estimatedUsd: 30, isEstimate: true },
    4: { perkType: "room_upgrade", starBand: 4, estimatedUsd: 60, isEstimate: true },
    5: { perkType: "room_upgrade", starBand: 5, estimatedUsd: 120, isEstimate: true },
  },
  guaranteed_availability: {
    3: { perkType: "guaranteed_availability", starBand: 3, estimatedUsd: 0, isEstimate: true },
    4: { perkType: "guaranteed_availability", starBand: 4, estimatedUsd: 0, isEstimate: true },
    5: { perkType: "guaranteed_availability", starBand: 5, estimatedUsd: 0, isEstimate: true },
  },
};

function makeStructuredPerkMembership(id: string, label: string, perkTypes: string[]): PublicMembership {
  return makeMembership({
    id,
    label,
    benefits: [
      {
        id: `${id}-b1`,
        scope: "domain",
        match: {},
        source: "catalog",
        value: {
          kind: "perk",
          structuredPerks: perkTypes.map((t) => ({ type: t, label: t.replace(/_/g, " ") })),
        },
      },
    ],
  });
}

// ── computeValueRollup ───────────────────────────────────────────────────────

test("computeValueRollup: single membership single perk", () => {
  const m = makeStructuredPerkMembership("m1", "Marriott", ["free_breakfast"]);
  const rollup = computeValueRollup([m], ESTIMATES);

  assert.equal(rollup.grand3, 15);
  assert.equal(rollup.grand4, 25);
  assert.equal(rollup.grand5, 50);
  assert.equal(rollup.byMembership.length, 1);
  assert.equal(rollup.byMembership[0].membershipLabel, "Marriott");
  assert.equal(rollup.byMembership[0].total5, 50);
});

test("computeValueRollup: sums multiple perks within one membership", () => {
  const m = makeStructuredPerkMembership("m1", "Hilton", ["free_breakfast", "room_upgrade"]);
  const rollup = computeValueRollup([m], ESTIMATES);

  assert.equal(rollup.grand3, 15 + 30);
  assert.equal(rollup.grand4, 25 + 60);
  assert.equal(rollup.grand5, 50 + 120);
});

test("computeValueRollup: sums across multiple memberships", () => {
  const m1 = makeStructuredPerkMembership("m1", "A", ["free_breakfast"]);
  const m2 = makeStructuredPerkMembership("m2", "B", ["room_upgrade"]);
  const rollup = computeValueRollup([m1, m2], ESTIMATES);

  assert.equal(rollup.grand3, 15 + 30);
  assert.equal(rollup.grand5, 50 + 120);
  assert.equal(rollup.byMembership.length, 2);
});

test("computeValueRollup: zero-value perks excluded from topPerks", () => {
  const m = makeStructuredPerkMembership("m1", "Intangible", ["guaranteed_availability"]);
  const rollup = computeValueRollup([m], ESTIMATES);

  assert.equal(rollup.topPerks.length, 0);
  // Grand totals are 0 but membership row is still created.
  assert.equal(rollup.grand5, 0);
});

test("computeValueRollup: topPerks capped at 5 and sorted by value desc", () => {
  const perkTypes = [
    "free_breakfast",
    "room_upgrade",
    "free_breakfast",
    "room_upgrade",
    "free_breakfast",
    "room_upgrade",
  ];
  const m = makeStructuredPerkMembership("m1", "Big", perkTypes);
  const rollup = computeValueRollup([m], ESTIMATES);

  assert.equal(rollup.topPerks.length, 5);
  // room_upgrade has higher 5★ value than free_breakfast — should come first.
  assert.equal(rollup.topPerks[0].est5, 120);
});

test("computeValueRollup: free-text perks (no perkType) are excluded from estimates", () => {
  const m = makeMembership({
    id: "m1",
    label: "Custom",
    benefits: [
      {
        id: "b1",
        scope: "property",
        match: {},
        source: "user-declared",
        value: { kind: "perk", perks: ["Late checkout", "Welcome drink"] },
      },
    ],
  });
  const rollup = computeValueRollup([m], ESTIMATES);

  assert.equal(rollup.grand3, 0);
  assert.equal(rollup.grand5, 0);
  assert.equal(rollup.topPerks.length, 0);
});

test("computeValueRollup: empty memberships returns zero rollup", () => {
  const rollup = computeValueRollup([], ESTIMATES);

  assert.equal(rollup.grand3, 0);
  assert.equal(rollup.grand4, 0);
  assert.equal(rollup.grand5, 0);
  assert.equal(rollup.byMembership.length, 0);
  assert.equal(rollup.topPerks.length, 0);
});

test("computeValueRollup: skips non-perk benefits (percentDiscount, etc.)", () => {
  const m = makeMembership({
    id: "m1",
    label: "Discount membership",
    benefits: [
      {
        id: "b1",
        scope: "domain",
        match: {},
        source: "catalog",
        value: { kind: "percentDiscount", percentOff: 0.1 },
      },
    ],
  });
  const rollup = computeValueRollup([m], ESTIMATES);

  assert.equal(rollup.grand3, 0);
  assert.equal(rollup.byMembership.length, 0);
});

// ── No-price invariant ───────────────────────────────────────────────────────

test("computeValueRollup: all values carry isEstimate semantics — never computed as a price", () => {
  const m = makeStructuredPerkMembership("m1", "Marriott", ["free_breakfast", "room_upgrade"]);
  const rollup = computeValueRollup([m], ESTIMATES);

  // Totals are sums of estimates, not derived from any price.
  // They must never exceed reasonable estimate ranges.
  assert.ok(rollup.grand5 < 10_000, "rollup total suspiciously large — check price-handling bug");
  // topPerks must not carry price data (no 'price' field).
  for (const perk of rollup.topPerks) {
    assert.ok(!("price" in perk), "perk object must not have a 'price' field");
    assert.ok(!("finalPrice" in perk), "perk object must not have a 'finalPrice' field");
    assert.ok(!("memberPrice" in perk), "perk object must not have a 'memberPrice' field");
  }
});
