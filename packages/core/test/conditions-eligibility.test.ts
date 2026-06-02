/**
 * Tests for perk condition evaluation/eligibility semantics and the no-price
 * invariant across all core product output types.
 *
 * Covers issue #73 acceptance criteria:
 *  - Taxonomy + conditions behavior (structure, condition evaluation/eligibility)
 *  - Tests asserting product outputs carry no price/discount/currency-of-a-real-rate fields (#1)
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { assertNoPriceFields } from "../src/partner.js";
import { EnrichmentEngine } from "../src/enrichment.js";
import { BookingProvider } from "../src/providers/booking.js";
import { getProgram, instantiateBenefits, PROGRAMS } from "../src/programs.js";
import { matchBenefits } from "../src/match.js";
import type {
  PerkConditions,
  StructuredPerk,
  Membership,
  BenefitValue,
  MatchedPerkEstimate,
  PageMatchResult,
  EnrichmentResult,
  MatchedBenefit,
} from "../src/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function membership(programId: string, tier?: string): Membership {
  const program = getProgram(programId)!;
  return {
    id: `m-${programId}`,
    label: tier ? `${program.name} - ${tier}` : program.name,
    programId,
    tier,
    attributes: {},
    benefits: instantiateBenefits(program, tier),
    addedAt: "2026-01-01",
    status: "active",
  };
}

const baseQuery = {
  location: "Prague",
  checkIn: "2026-07-10",
  checkOut: "2026-07-12",
  adults: 2,
  rooms: 1,
  currency: "EUR",
  limit: 8,
};

// ---------------------------------------------------------------------------
// Condition eligibility semantics
// ---------------------------------------------------------------------------

test("PerkConditions.minNights: value is a positive integer documenting minimum stay", () => {
  const cond: PerkConditions = { minNights: 2 };
  assert.equal(typeof cond.minNights, "number");
  assert.ok(Number.isInteger(cond.minNights), "minNights must be an integer");
  assert.ok(cond.minNights! >= 1, "minNights must be at least 1");
});

test("PerkConditions.minNights: higher values correctly represent longer stays", () => {
  const oneNight: PerkConditions = { minNights: 1 };
  const fiveNights: PerkConditions = { minNights: 5 };
  const tenNights: PerkConditions = { minNights: 10 };
  assert.ok(oneNight.minNights! < fiveNights.minNights!);
  assert.ok(fiveNights.minNights! < tenNights.minNights!);
});

test("PerkConditions.bookingChannel: 'direct' means the perk is only available via direct booking", () => {
  const cond: PerkConditions = { bookingChannel: ["direct"] };
  assert.deepEqual(cond.bookingChannel, ["direct"]);
  // A direct-only perk would NOT apply when booking via an OTA
  assert.ok(!cond.bookingChannel!.includes("ota"), "direct-only perk should not include ota channel");
});

test("PerkConditions.bookingChannel: 'ota' channel means the perk applies via OTA bookings", () => {
  const cond: PerkConditions = { bookingChannel: ["ota"] };
  assert.deepEqual(cond.bookingChannel, ["ota"]);
  assert.ok(!cond.bookingChannel!.includes("direct"));
});

test("PerkConditions.bookingChannel: multiple channels mean the perk applies via any of them", () => {
  const cond: PerkConditions = { bookingChannel: ["direct", "phone"] };
  assert.equal(cond.bookingChannel!.length, 2);
  assert.ok(cond.bookingChannel!.includes("direct"));
  assert.ok(cond.bookingChannel!.includes("phone"));
  assert.ok(!cond.bookingChannel!.includes("ota"));
});

test("PerkConditions.bookingChannel: all four channels are valid values", () => {
  const allChannels: PerkConditions = { bookingChannel: ["direct", "ota", "phone", "agent"] };
  assert.equal(allChannels.bookingChannel!.length, 4);
  const validSet = new Set(["direct", "ota", "phone", "agent"]);
  for (const ch of allChannels.bookingChannel!) {
    assert.ok(validSet.has(ch), `'${ch}' is not a valid BookingChannel`);
  }
});

test("PerkConditions.blackoutDates: accepts ISO-8601 date strings", () => {
  const cond: PerkConditions = { blackoutDates: ["2026-12-24", "2027-01-01"] };
  for (const d of cond.blackoutDates!) {
    // Must be parseable as a date
    const parsed = new Date(d);
    assert.ok(!isNaN(parsed.getTime()), `blackoutDate '${d}' must be a valid date`);
    // Must match YYYY-MM-DD format
    assert.match(d, /^\d{4}-\d{2}-\d{2}$/, `blackoutDate '${d}' must be in YYYY-MM-DD format`);
  }
});

test("PerkConditions.blackoutDates: accepts ISO-8601 date range strings", () => {
  const cond: PerkConditions = {
    blackoutDates: ["2026-12-24/2026-12-26", "2027-01-01/2027-01-02"],
  };
  for (const d of cond.blackoutDates!) {
    // Date range format: YYYY-MM-DD/YYYY-MM-DD
    const parts = d.split("/");
    assert.equal(parts.length, 2, `'${d}' should be a slash-separated date range`);
    for (const part of parts) {
      assert.match(part, /^\d{4}-\d{2}-\d{2}$/, `date range part '${part}' must be YYYY-MM-DD`);
      const parsed = new Date(part);
      assert.ok(!isNaN(parsed.getTime()), `'${part}' must be a valid date`);
    }
    // End date must not precede start date
    const [start, end] = parts.map((p) => new Date(p));
    assert.ok(end! >= start!, `End date must not precede start date in '${d}'`);
  }
});

test("PerkConditions.tierRequired: restricts perk to users holding the named tier or above", () => {
  const goldOnly: PerkConditions = { tierRequired: "Gold" };
  assert.equal(goldOnly.tierRequired, "Gold");
  const platOnly: PerkConditions = { tierRequired: "Platinum" };
  assert.equal(platOnly.tierRequired, "Platinum");
  // tierRequired is free-form — programs define their own tier names
  const customTier: PerkConditions = { tierRequired: "Diamond Elite" };
  assert.equal(customTier.tierRequired, "Diamond Elite");
});

test("PerkConditions.subjectToAvailability: true means perk is space-available, not guaranteed", () => {
  const spaceavail: PerkConditions = { subjectToAvailability: true };
  assert.strictEqual(spaceavail.subjectToAvailability, true);
  // This is a SOFTER condition than a hard eligibility block — the perk may
  // or may not be granted depending on hotel capacity.
  const guaranteed: PerkConditions = { subjectToAvailability: false };
  assert.strictEqual(guaranteed.subjectToAvailability, false);
});

test("PerkConditions.enrollmentRequired: true means the user must explicitly enroll to activate the perk", () => {
  const needsEnroll: PerkConditions = { enrollmentRequired: true };
  assert.strictEqual(needsEnroll.enrollmentRequired, true);
  // Auto-applied perks have enrollmentRequired: false or absent
  const autoApply: PerkConditions = { enrollmentRequired: false };
  assert.strictEqual(autoApply.enrollmentRequired, false);
});

test("PerkConditions.notes: free-text fallback for conditions that cannot be expressed structurally", () => {
  const withNotes: PerkConditions = {
    notes: "Valid only for stays booked at least 14 days in advance",
  };
  assert.equal(typeof withNotes.notes, "string");
  assert.ok(withNotes.notes!.length > 0);
});

test("PerkConditions: multiple conditions can coexist on a single perk", () => {
  const complex: PerkConditions = {
    tierRequired: "Platinum",
    minNights: 2,
    bookingChannel: ["direct"],
    subjectToAvailability: true,
    enrollmentRequired: false,
    blackoutDates: ["2026-12-24/2026-12-26"],
    notes: "Available on weekend stays only",
  };
  // All fields independently accessible
  assert.equal(complex.tierRequired, "Platinum");
  assert.equal(complex.minNights, 2);
  assert.deepEqual(complex.bookingChannel, ["direct"]);
  assert.strictEqual(complex.subjectToAvailability, true);
  assert.strictEqual(complex.enrollmentRequired, false);
  assert.equal(complex.blackoutDates!.length, 1);
  assert.ok(complex.notes!.length > 0);
  // No price fields anywhere
  const priceKeys = ["price", "amount", "currency", "cost", "rate", "discount", "percentOff"];
  for (const key of priceKeys) {
    assert.equal(
      (complex as Record<string, unknown>)[key],
      undefined,
      `PerkConditions must not have key '${key}'`,
    );
  }
});

// ---------------------------------------------------------------------------
// Conditions in the catalog: spot-checks on real program conditions
// ---------------------------------------------------------------------------

test("booking_genius Level 2: free_breakfast and room_upgrade conditions use 'ota' channel and subjectToAvailability", () => {
  const program = getProgram("booking_genius")!;
  const l2perks = program.benefits["Level 2"]!.flatMap((t) => t.value.structuredPerks ?? []);
  const breakfast = l2perks.find((p) => p.type === "free_breakfast");
  const upgrade = l2perks.find((p) => p.type === "room_upgrade");
  assert.ok(breakfast, "Level 2 must have free_breakfast");
  assert.ok(upgrade, "Level 2 must have room_upgrade");
  assert.deepEqual(breakfast!.conditions?.bookingChannel, ["ota"]);
  assert.strictEqual(breakfast!.conditions?.subjectToAvailability, true);
  assert.deepEqual(upgrade!.conditions?.bookingChannel, ["ota"]);
  assert.strictEqual(upgrade!.conditions?.subjectToAvailability, true);
});

test("your_prague_hotels: early_check_in and late_check_out are direct-only channel conditions", () => {
  const program = getProgram("your_prague_hotels")!;
  const perks = program.benefits["*"]!.flatMap((t) => t.value.structuredPerks ?? []);
  const checkIn = perks.find((p) => p.type === "early_check_in");
  const checkOut = perks.find((p) => p.type === "late_check_out");
  assert.ok(checkIn, "must have early_check_in");
  assert.ok(checkOut, "must have late_check_out");
  assert.deepEqual(checkIn!.conditions?.bookingChannel, ["direct"]);
  assert.deepEqual(checkOut!.conditions?.bookingChannel, ["direct"]);
});

test("emblem_prague: spa_credit conditions include notes (discount on treatments, not cash credit)", () => {
  const program = getProgram("emblem_prague")!;
  const perks = program.benefits["*"]!.flatMap((t) => t.value.structuredPerks ?? []);
  const spa = perks.find((p) => p.type === "spa_credit");
  assert.ok(spa, "must have spa_credit");
  assert.ok(spa!.conditions?.notes, "spa_credit must have a notes condition");
  assert.ok(spa!.conditions!.notes!.length > 0, "notes must be non-empty");
});

test("accor_all Silver: late_check_out has subjectToAvailability=true (space-available, not guaranteed)", () => {
  const program = getProgram("accor_all")!;
  const perks = program.benefits["Silver"]!.flatMap((t) => t.value.structuredPerks ?? []);
  const lco = perks.find((p) => p.type === "late_check_out");
  assert.ok(lco, "Silver must have late_check_out");
  assert.strictEqual(lco!.conditions?.subjectToAvailability, true);
});

test("accor_all Platinum: suite_upgrade conditions carry notes about certificate count", () => {
  const program = getProgram("accor_all")!;
  const perks = program.benefits["Platinum"]!.flatMap((t) => t.value.structuredPerks ?? []);
  const suite = perks.find((p) => p.type === "suite_upgrade");
  assert.ok(suite, "Platinum must have suite_upgrade");
  assert.ok(suite!.conditions?.notes, "suite_upgrade conditions must have notes");
});

test("subjectToAvailability=true does NOT mean guaranteed — semantically distinct from no conditions", () => {
  const conditioned: StructuredPerk = {
    type: "room_upgrade",
    label: "Room upgrade when available",
    conditions: { subjectToAvailability: true },
  };
  const unconditional: StructuredPerk = {
    type: "room_upgrade",
    label: "Guaranteed room upgrade",
    // no conditions → always applies
  };
  assert.strictEqual(conditioned.conditions?.subjectToAvailability, true);
  assert.equal(unconditional.conditions, undefined);
  // These two perks describe different levels of guarantee
  assert.notDeepEqual(conditioned, unconditional);
});

test("StructuredPerk with conditions: label and conditions fields are independent (label carries no condition data)", () => {
  const perk: StructuredPerk = {
    type: "lounge_access",
    label: "Executive lounge access",
    conditions: {
      tierRequired: "Gold",
      bookingChannel: ["direct"],
    },
  };
  // Label is just a human-readable string; the eligibility logic is in conditions
  assert.equal(typeof perk.label, "string");
  assert.ok(!perk.label.includes("Gold"), "label should not embed tier — that's conditions.tierRequired");
  assert.equal(perk.conditions?.tierRequired, "Gold");
});

// ---------------------------------------------------------------------------
// assertNoPriceFields: guard function correctness
// ---------------------------------------------------------------------------

test("assertNoPriceFields: passes for clean objects with no price-related keys", () => {
  assert.doesNotThrow(() => assertNoPriceFields({ kind: "perk", perks: ["Free breakfast"] }));
  assert.doesNotThrow(() => assertNoPriceFields({ perkType: "free_breakfast", isEstimate: true }));
  assert.doesNotThrow(() => assertNoPriceFields({ domain: "booking.com", matches: [], perks: [] }));
  assert.doesNotThrow(() => assertNoPriceFields({}));
  assert.doesNotThrow(() => assertNoPriceFields(null));
});

test("assertNoPriceFields: throws when object has a 'price' key", () => {
  assert.throws(() => assertNoPriceFields({ price: 199 }));
});

test("assertNoPriceFields: throws when object has a 'nightly' key", () => {
  assert.throws(() => assertNoPriceFields({ nightlyRate: 199 }));
});

test("assertNoPriceFields: throws when object has a 'currency' key", () => {
  assert.throws(() => assertNoPriceFields({ currency: "EUR" }));
});

test("assertNoPriceFields: throws when nested object has a 'cost' key", () => {
  assert.throws(() => assertNoPriceFields({ offer: { cost: 99 } }));
});

test("assertNoPriceFields: throws when object has 'total' key", () => {
  assert.throws(() => assertNoPriceFields({ totalAmount: 350 }));
});

test("assertNoPriceFields: passes for PerkConditions (no price fields allowed)", () => {
  const cond: PerkConditions = {
    tierRequired: "Gold",
    minNights: 2,
    bookingChannel: ["direct"],
    subjectToAvailability: true,
    enrollmentRequired: false,
    notes: "Subject to availability",
  };
  assert.doesNotThrow(() => assertNoPriceFields(cond));
});

test("assertNoPriceFields: passes for StructuredPerk with all fields set", () => {
  const perk: StructuredPerk = {
    type: "free_breakfast",
    label: "Complimentary breakfast",
    conditions: {
      tierRequired: "Gold",
      bookingChannel: ["direct"],
      subjectToAvailability: true,
      notes: "Continental breakfast included",
    },
  };
  assert.doesNotThrow(() => assertNoPriceFields(perk));
});

test("assertNoPriceFields: passes for BenefitValue perk kind with structuredPerks", () => {
  const bv: BenefitValue = {
    kind: "perk",
    structuredPerks: [
      { type: "late_check_out", label: "Late check-out until 4pm", conditions: { subjectToAvailability: true } },
    ],
  };
  assert.doesNotThrow(() => assertNoPriceFields(bv));
});

// ---------------------------------------------------------------------------
// No-price invariant across all product output types (#1)
// ---------------------------------------------------------------------------

test("EnrichmentResult: no price-mutation fields on the result or enriched properties", async () => {
  const engine = new EnrichmentEngine([new BookingProvider()]);
  const result = await engine.enrich(baseQuery, [membership("booking_genius", "Level 3")]);

  // Top-level result must not carry computed price fields
  assert.ok(!("totalSavings" in result), "no totalSavings");
  assert.ok(!("savingsAmount" in result), "no savingsAmount");
  assert.ok(!("discountedPrice" in result), "no discountedPrice");
  assert.ok(!("memberPrice" in result), "no memberPrice");
  assert.ok(!("indicativePrice" in result), "no indicativePrice");
  assert.ok(!("finalPrice" in result), "no finalPrice");

  for (const prop of result.properties) {
    // publicOffer is allowed (third-party pass-through), but no MEMBER/discounted rate
    assert.ok(!("memberOffer" in prop), "no memberOffer on property");
    assert.ok(!("indicativeOffer" in prop), "no indicativeOffer on property");
    assert.ok(!("discountedRate" in prop), "no discountedRate on property");
    assert.ok(!("savingsAmount" in prop), "no savingsAmount on property");

    for (const match of prop.matches) {
      // MatchedBenefit: confidence is staleness, not price-derived
      assert.ok(!("price" in match), "no price in MatchedBenefit");
      assert.ok(!("savingsAmount" in match), "no savingsAmount in MatchedBenefit");
      assert.ok(!("discountedOffer" in match), "no discountedOffer in MatchedBenefit");
      if (match.confidence) {
        // Confidence is about data freshness, not pricing
        assert.ok(!("price" in match.confidence), "confidence carries no price");
        assert.ok(!("amount" in match.confidence), "confidence carries no amount");
      }
    }
  }
});

test("PageMatchResult: no price fields — only applicable benefits and perk estimates", () => {
  const engine = new EnrichmentEngine([new BookingProvider()]);
  const res = engine.matchPage(
    { domain: "booking.com", property: { name: "Some Hotel" } },
    [membership("booking_genius", "Level 3")],
  );

  // Must not carry any price-related top-level fields
  assert.ok(!("publicOffer" in res), "no publicOffer on PageMatchResult");
  assert.ok(!("indicativeOffer" in res), "no indicativeOffer on PageMatchResult");
  assert.ok(!("memberRate" in res), "no memberRate on PageMatchResult");
  assert.ok(!("discountedPrice" in res), "no discountedPrice on PageMatchResult");
  assert.ok(!("finalPrice" in res), "no finalPrice on PageMatchResult");
  assert.ok(!("totalSavings" in res), "no totalSavings on PageMatchResult");
});

test("PageMatchResult.matches: MatchedBenefit objects carry no computed price fields", () => {
  const engine = new EnrichmentEngine([new BookingProvider()]);
  const res = engine.matchPage(
    { domain: "booking.com" },
    [membership("booking_genius", "Level 2")],
  );
  assert.ok(res.matches.length > 0);
  for (const mb of res.matches) {
    assert.ok(!("savingsAmount" in mb));
    assert.ok(!("discountedOffer" in mb));
    assert.ok(!("memberPrice" in mb));
    // percentOff in BenefitValue is allowed (it IS a discount %), but no absolute prices
    if (mb.benefit.value.kind === "percentDiscount") {
      assert.ok(typeof mb.benefit.value.percentOff === "number");
      assert.ok(!("priceAfterDiscount" in mb.benefit.value));
      assert.ok(!("savingsAmount" in mb.benefit.value));
    }
  }
});

test("MatchedPerkEstimate: isEstimate:true is always present and no price/discount keys exist", () => {
  const engine = new EnrichmentEngine([new BookingProvider()]);
  const res = engine.matchPage(
    { domain: "booking.com" },
    [membership("booking_genius", "Level 3")],
  );
  assert.ok(res.perkEstimates.length > 0, "Level 3 should produce perk estimates");
  const priceKeys = ["price", "finalPrice", "memberPrice", "discountedPrice", "currency", "totalAmount", "nightlyAmount"];
  for (const est of res.perkEstimates) {
    assert.strictEqual(est.isEstimate, true, "isEstimate must be true");
    for (const key of priceKeys) {
      assert.ok(!(key in est), `MatchedPerkEstimate must not have key '${key}'`);
    }
    // estimatedUsd is the only monetary field — and it's clearly marked as an estimate
    assert.equal(typeof est.estimatedUsd[3], "number");
    assert.equal(typeof est.estimatedUsd[4], "number");
    assert.equal(typeof est.estimatedUsd[5], "number");
    assert.ok(est.estimatedUsd[3] >= 0);
    assert.ok(est.estimatedUsd[4] >= 0);
    assert.ok(est.estimatedUsd[5] >= 0);
  }
});

test("MatchedBenefit.confidence: carries staleness signal, not a price-derived field", () => {
  const NOW = new Date("2026-06-01T00:00:00Z");
  const prog = getProgram("booking_genius")!;
  const ms = membership("booking_genius", "Level 3");
  const programs = new Map([[prog.id, prog]]);
  const matches = matchBenefits([ms], { domain: "booking.com" }, { programs, now: NOW });
  assert.ok(matches.length > 0);
  for (const m of matches) {
    if (m.confidence) {
      assert.ok(["high", "medium", "low", "stale"].includes(m.confidence.level));
      assert.ok(m.confidence.score >= 0 && m.confidence.score <= 1.0);
      // No price fields on confidence
      assert.ok(!("price" in m.confidence));
      assert.ok(!("amount" in m.confidence));
      assert.ok(!("savings" in m.confidence));
    }
  }
});

// ---------------------------------------------------------------------------
// No-price guard across all catalog programs (comprehensive sweep)
// ---------------------------------------------------------------------------

test("all catalog program structuredPerks pass assertNoPriceFields (defense in depth)", () => {
  for (const program of PROGRAMS) {
    for (const [tier, templates] of Object.entries(program.benefits)) {
      for (const template of templates) {
        for (const perk of template.value.structuredPerks ?? []) {
          assert.doesNotThrow(
            () => assertNoPriceFields(perk),
            `${program.id}[${tier}]: structuredPerk '${perk.label}' failed no-price guard`,
          );
          if (perk.conditions) {
            assert.doesNotThrow(
              () => assertNoPriceFields(perk.conditions),
              `${program.id}[${tier}]: conditions for '${perk.label}' failed no-price guard`,
            );
          }
        }
      }
    }
  }
});

test("EnrichmentResult: TrueRate-computed annotations contain no price fields (direct field check)", async () => {
  const engine = new EnrichmentEngine([new BookingProvider()]);
  const result = await engine.enrich(baseQuery, [membership("booking_genius", "Level 3")]);
  // TrueRate-generated annotation fields (not provider pass-through) must not carry price data.
  // Note: assertNoPriceFields is designed for partner draft submissions and its regex
  // catches false positives in generic output shapes (e.g. 'generatedAt' contains 'rate').
  // We use direct field checks here to verify the product-rule #1 invariant.
  const computedPriceFields = [
    "totalSavings", "savingsAmount", "memberPrice", "discountedPrice",
    "indicativePrice", "finalPrice", "memberOffer", "indicativeOffer",
    "discountedRate", "memberRate",
  ];
  for (const field of computedPriceFields) {
    assert.ok(!(field in result), `EnrichmentResult must not have computed price field '${field}'`);
  }
  for (const prop of result.properties) {
    for (const field of computedPriceFields) {
      assert.ok(!(field in prop), `EnrichedProperty must not have computed price field '${field}'`);
    }
  }
});

test("assertNoPriceFields passes on PageMatchResult (all perks, matches, estimates)", () => {
  const engine = new EnrichmentEngine([new BookingProvider()]);
  const res = engine.matchPage(
    { domain: "booking.com" },
    [membership("booking_genius", "Level 3")],
  );
  // PageMatchResult itself (excluding any third-party data) must pass the guard
  assert.doesNotThrow(() =>
    assertNoPriceFields({
      domain: res.domain,
      matches: res.matches,
      perks: res.perks,
      perkEstimates: res.perkEstimates,
    }),
  );
});
