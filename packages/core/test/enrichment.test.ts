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

function customGenius(percent: number): Membership {
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

test("no memberships -> zero savings, no perks, best offer is public", async () => {
  const r = await new EnrichmentEngine([new BookingProvider()]).enrich(baseQuery, []);
  assert.ok(r.properties.length > 0);
  assert.equal(r.totalSavings, 0);
  for (const p of r.properties) {
    assert.equal(p.savingsAmount, 0);
    assert.equal(p.bestOffer.source, "public");
    assert.equal(p.perks.length, 0);
  }
});

test("Genius Level 3 applies ~20% across booking.com properties (indicative)", async () => {
  const r = await new EnrichmentEngine([new BookingProvider()]).enrich(baseQuery, [
    membership("booking_genius", "Level 3"),
  ]);
  assert.ok(r.totalSavings > 0);
  assert.ok(r.programsApplied.includes("booking_genius"));
  const p = r.properties[0]!;
  const ratio = p.bestOffer.totalAmount / p.publicOffer.totalAmount;
  assert.ok(Math.abs(ratio - 0.8) < 0.01, `expected ~0.80, got ${ratio}`);
  assert.equal(p.indicative, true, "declared/curated discount should be indicative");
});

test("Marriott Platinum adds perks with NO price change (perks without discount)", async () => {
  const r = await new EnrichmentEngine([new BookingProvider()]).enrich(baseQuery, [
    membership("marriott_bonvoy", "Platinum"),
  ]);
  // Marriott-branded mock properties should carry the breakfast perk (Platinum+,
  // not Gold), with zero price change.
  const marriott = r.properties.find((p) => p.brand === "Marriott")!;
  assert.ok(marriott, "expected a Marriott property in the mock set");
  assert.equal(marriott.savingsAmount, 0);
  assert.ok(marriott.perks.some((x) => /breakfast/i.test(x)));
});

test("stacking: Genius discount AND Marriott perks on the same property", async () => {
  const r = await new EnrichmentEngine([new BookingProvider()]).enrich(baseQuery, [
    membership("booking_genius", "Level 2"),
    membership("marriott_bonvoy", "Gold"),
  ]);
  const marriott = r.properties.find((p) => p.brand === "Marriott")!;
  assert.ok(marriott.savingsAmount > 0, "Genius discount should apply");
  assert.ok(marriott.perks.some((x) => /upgrade|check-?out/i.test(x)), "Marriott Gold perk should apply");
});

test("higher Genius tier saves more", async () => {
  const e = new EnrichmentEngine([new BookingProvider()]);
  const l1 = await e.enrich(baseQuery, [membership("booking_genius", "Level 1")]);
  const l3 = await e.enrich(baseQuery, [membership("booking_genius", "Level 3")]);
  assert.ok(l3.totalSavings > l1.totalSavings);
});

test("a failing provider does not sink the search", async () => {
  const broken = { id: "x", domain: "x.com", isMock: true, async search() { throw new Error("boom"); } };
  const r = await new EnrichmentEngine([broken as any]).enrich(baseQuery, []);
  assert.equal(r.properties.length, 0);
});

test("matchPage: domain-scoped custom discount yields an indicative estimate", () => {
  const engine = new EnrichmentEngine([new BookingProvider()]);
  const res = engine.matchPage(
    { domain: "pecr.cz", property: { name: "Hotel PECR", publicNightly: 2000, publicTotal: 4000, currency: "CZK" } },
    [customGenius(0.15)],
  );
  assert.equal(res.matches.length, 1);
  assert.ok(res.indicativeOffer, "expected an indicative offer");
  assert.equal(res.indicativeOffer!.nightlyAmount, 1700); // 2000 * 0.85
  assert.equal(res.indicativeOffer!.indicative, true);
});

test("matchPage: perks surface even with no price on the page", () => {
  const engine = new EnrichmentEngine([new BookingProvider()]);
  const res = engine.matchPage(
    { domain: "hilton.com", property: { name: "DoubleTree Riverside", brand: "Hilton" } },
    [membership("hilton_honors", "Gold")],
  );
  assert.ok(res.perks.some((x) => /breakfast/i.test(x)));
  assert.equal(res.indicativeOffer, undefined);
});
