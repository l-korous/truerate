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
