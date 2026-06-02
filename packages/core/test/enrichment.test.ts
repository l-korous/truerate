import { test } from "node:test";
import assert from "node:assert/strict";
import { EnrichmentEngine } from "../src/enrichment.js";
import { BookingProvider } from "../src/providers/booking.js";
import { getProgram, instantiateBenefits } from "../src/programs.js";
import type { Membership } from "../src/types.js";

const baseQuery = {
  location: "Prague",
  checkIn: "2026-07-10",
  checkOut: "2026-07-12", // 2 nights
  adults: 2,
  rooms: 1,
  currency: "EUR",
  limit: 8,
};

function membership(programId: string, tier?: string): Membership {
  const program = getProgram(programId)!;
  return {
    id: `m-${programId}`,
    label: tier ? `${program.name} - ${tier}` : program.name,
    programId,
    tier,
    attributes: {},
    benefits: instantiateBenefits(program, tier),
    addedAt: new Date().toISOString(),
    status: "active",
  };
}

function customDiscount(percent: number): Membership {
  return {
    id: "m-custom",
    label: "Hotel PECR",
    attributes: {},
    benefits: [
      {
        id: "b-custom",
        scope: "property",
        match: { domains: ["pecr.cz"], propertyNames: ["Hotel PECR"] },
        value: { kind: "percentDiscount", percentOff: percent, conditions: "direct booking" },
        source: "user-declared",
      },
    ],
    addedAt: new Date().toISOString(),
    status: "active",
  };
}

test("runs in mock mode without provider credentials", () => {
  assert.equal(new EnrichmentEngine().mode, "mock");
});

test("no memberships -> no matches, no perks", async () => {
  const r = await new EnrichmentEngine([new BookingProvider()]).enrich(baseQuery, []);
  assert.ok(r.properties.length > 0);
  for (const p of r.properties) {
    assert.equal(p.matches.length, 0);
    assert.equal(p.perks.length, 0);
  }
  // no price fields on the result
  assert.ok(!("totalSavings" in r), "no totalSavings field");
  assert.ok(!("savingsAmount" in r.properties[0]!), "no savingsAmount field");
  assert.ok(!("bestOffer" in r.properties[0]!), "no bestOffer field");
});

test("Genius Level 3 produces 20% discount match on booking.com properties", async () => {
  const r = await new EnrichmentEngine([new BookingProvider()]).enrich(baseQuery, [
    membership("booking_genius", "Level 3"),
  ]);
  assert.ok(r.programsApplied.includes("booking_genius"));
  const p = r.properties[0]!;
  assert.ok(p.matches.length > 0, "expected matches");
  const geniusMatch = p.matches.find((m) => m.benefit.programId === "booking_genius");
  assert.ok(geniusMatch, "expected a Genius match");
  assert.equal(geniusMatch!.benefit.value.percentOff, 0.2, "Level 3 = 20%");
});

test("Marriott Platinum adds perks with no discount match", async () => {
  const r = await new EnrichmentEngine([new BookingProvider()]).enrich(baseQuery, [
    membership("marriott_bonvoy", "Platinum"),
  ]);
  const marriott = r.properties.find((p) => p.brand === "Marriott")!;
  assert.ok(marriott, "expected a Marriott property in the mock set");
  const discountMatches = marriott.matches.filter(
    (m) => m.benefit.value.kind === "percentDiscount" || m.benefit.value.kind === "fixedDiscount",
  );
  assert.equal(discountMatches.length, 0, "Marriott Platinum has no price discount");
  assert.ok(marriott.perks.some((x) => /breakfast/i.test(x)));
});

test("stacking: Genius discount AND Marriott perks on the same property", async () => {
  const r = await new EnrichmentEngine([new BookingProvider()]).enrich(baseQuery, [
    membership("booking_genius", "Level 2"),
    membership("marriott_bonvoy", "Gold"),
  ]);
  const marriott = r.properties.find((p) => p.brand === "Marriott")!;
  assert.ok(
    marriott.matches.some((m) => m.benefit.programId === "booking_genius"),
    "Genius match should apply",
  );
  assert.ok(marriott.perks.some((x) => /upgrade|check-?out/i.test(x)), "Marriott Gold perk should apply");
});

test("higher Genius tier carries higher discount percentage", async () => {
  const e = new EnrichmentEngine([new BookingProvider()]);
  const l1 = await e.enrich(baseQuery, [membership("booking_genius", "Level 1")]);
  const l3 = await e.enrich(baseQuery, [membership("booking_genius", "Level 3")]);
  const l1Pct = l1.properties[0]?.matches.find((m) => m.benefit.programId === "booking_genius")?.benefit.value.percentOff ?? 0;
  const l3Pct = l3.properties[0]?.matches.find((m) => m.benefit.programId === "booking_genius")?.benefit.value.percentOff ?? 0;
  assert.ok(l3Pct > l1Pct, `Level 3 pct ${l3Pct} should exceed Level 1 pct ${l1Pct}`);
});

test("a failing provider does not sink the search", async () => {
  const broken = { id: "x", domain: "x.com", isMock: true, async search() { throw new Error("boom"); } };
  const r = await new EnrichmentEngine([broken as any]).enrich(baseQuery, []);
  assert.equal(r.properties.length, 0);
});

test("matchPage: domain-scoped custom discount produces a matched benefit", () => {
  const engine = new EnrichmentEngine([new BookingProvider()]);
  const res = engine.matchPage(
    { domain: "pecr.cz", property: { name: "Hotel PECR" } },
    [customDiscount(0.15)],
  );
  assert.equal(res.matches.length, 1);
  assert.equal(res.matches[0]!.benefit.value.percentOff, 0.15);
  // no price fields on the result
  assert.ok(!("indicativeOffer" in res), "no indicativeOffer field");
  assert.ok(!("publicOffer" in res), "no publicOffer on PageMatchResult");
});

test("matchPage: perks surface even with no property context", () => {
  const engine = new EnrichmentEngine([new BookingProvider()]);
  const res = engine.matchPage(
    { domain: "hilton.com", property: { name: "DoubleTree Riverside", brand: "Hilton" } },
    [membership("hilton_honors", "Gold")],
  );
  assert.ok(res.perks.some((x) => /breakfast/i.test(x)));
  assert.ok(!("indicativeOffer" in res), "no indicativeOffer field");
});

// --- perkEstimates (issue #139) ---

test("matchPage: perkEstimates present and typed isEstimate:true", () => {
  const engine = new EnrichmentEngine([new BookingProvider()]);
  const res = engine.matchPage(
    { domain: "booking.com" },
    [membership("booking_genius", "Level 3")],
  );
  assert.ok(Array.isArray(res.perkEstimates), "perkEstimates is an array");
  assert.ok(res.perkEstimates.length > 0, "Genius Level 3 has structured perks");
  for (const e of res.perkEstimates) {
    assert.equal(e.isEstimate, true, "isEstimate must be true");
    assert.ok(typeof e.estimatedUsd[3] === "number", "3★ estimate is a number");
    assert.ok(typeof e.estimatedUsd[4] === "number", "4★ estimate is a number");
    assert.ok(typeof e.estimatedUsd[5] === "number", "5★ estimate is a number");
    // must never contain any 'price' keys
    assert.ok(!("price" in e), "no price field");
    assert.ok(!("finalPrice" in e), "no finalPrice field");
  }
});

test("matchPage: perkEstimates include free_breakfast for Genius Level 3", () => {
  const engine = new EnrichmentEngine([new BookingProvider()]);
  const res = engine.matchPage(
    { domain: "booking.com" },
    [membership("booking_genius", "Level 3")],
  );
  const breakfast = res.perkEstimates.find((e) => e.perkType === "free_breakfast");
  assert.ok(breakfast, "free_breakfast estimate should be present for Genius L3");
  // free_breakfast table: 3★=$15, 4★=$25, 5★=$50
  assert.equal(breakfast!.estimatedUsd[3], 15);
  assert.equal(breakfast!.estimatedUsd[4], 25);
  assert.equal(breakfast!.estimatedUsd[5], 50);
  assert.equal(breakfast!.membershipLabel, "Booking.com Genius - Level 3");
});

test("matchPage: perkEstimates include room_upgrade for Genius Level 3", () => {
  const engine = new EnrichmentEngine([new BookingProvider()]);
  const res = engine.matchPage(
    { domain: "booking.com" },
    [membership("booking_genius", "Level 3")],
  );
  const upgrade = res.perkEstimates.find((e) => e.perkType === "room_upgrade");
  assert.ok(upgrade, "room_upgrade estimate should be present for Genius L3");
  // room_upgrade table: 3★=$30, 4★=$60, 5★=$120
  assert.equal(upgrade!.estimatedUsd[3], 30);
  assert.equal(upgrade!.estimatedUsd[4], 60);
  assert.equal(upgrade!.estimatedUsd[5], 120);
});

test("matchPage: perkEstimates excludes zero-value perks (priority_support = 0)", () => {
  const engine = new EnrichmentEngine([new BookingProvider()]);
  const res = engine.matchPage(
    { domain: "booking.com" },
    [membership("booking_genius", "Level 3")],
  );
  // priority_support has 0 value at all bands — should be excluded
  const support = res.perkEstimates.find((e) => e.perkType === "priority_support");
  assert.equal(support, undefined, "priority_support has no monetary estimate and should not appear");
});

test("matchPage: perkEstimates present for Marriott Platinum (structuredPerks migrated)", () => {
  const engine = new EnrichmentEngine([new BookingProvider()]);
  // Marriott Platinum now has structuredPerks (migrated from free-text in #161)
  const res = engine.matchPage(
    { domain: "marriott.com", property: { name: "Marriott", brand: "Marriott" } },
    [membership("marriott_bonvoy", "Platinum")],
  );
  assert.ok(res.perkEstimates.length > 0, "Marriott Platinum has structuredPerks -> perkEstimates should be non-empty");
  assert.ok(res.perkEstimates.some((e) => e.perkType === "free_breakfast"), "Platinum should surface free_breakfast estimate");
});

test("matchPage: perkEstimates empty for custom discount with no structuredPerks", () => {
  const engine = new EnrichmentEngine([new BookingProvider()]);
  const res = engine.matchPage(
    { domain: "pecr.cz", property: { name: "Hotel PECR" } },
    [customDiscount(0.15)],
  );
  assert.equal(res.perkEstimates.length, 0);
});

test("matchPage: Genius Level 2 also has perkEstimates (structured perks defined)", () => {
  const engine = new EnrichmentEngine([new BookingProvider()]);
  const res = engine.matchPage(
    { domain: "booking.com" },
    [membership("booking_genius", "Level 2")],
  );
  assert.ok(res.perkEstimates.length > 0, "Level 2 has structuredPerks too");
});

test("matchPage: Genius Level 1 has no perkEstimates (no structuredPerks)", () => {
  const engine = new EnrichmentEngine([new BookingProvider()]);
  const res = engine.matchPage(
    { domain: "booking.com" },
    [membership("booking_genius", "Level 1")],
  );
  // Level 1 only has a percentDiscount benefit, no structuredPerks
  assert.equal(res.perkEstimates.length, 0);
});
