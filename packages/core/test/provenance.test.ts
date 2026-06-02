/**
 * Tests for issue #72: provenance + confidence labeling for perks/conditions/estimates.
 *
 * Acceptance criteria verified:
 *  - Each perk/condition/estimate carries provenance and confidence label
 *  - Labels exposed via core types/outputs for channel consumption
 *  - Estimates remain clearly marked as estimates
 *  - No price/discount data introduced
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { EnrichmentEngine } from "../src/enrichment.js";
import { estimatePerkValue, estimatePerkValueAllBands } from "../src/perk-value.js";
import { getProgram, instantiateBenefits } from "../src/programs.js";
import type {
  Benefit,
  BenefitMatch,
  Membership,
  MatchedPerkEstimate,
  StructuredPerk,
  TermConfidence,
  TermProvenance,
} from "../src/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function catalogMembership(programId: string, tier?: string): Membership {
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

const match: BenefitMatch = { domains: ["example.com"] };

function userDeclaredMembership(): Membership {
  const benefit: Benefit = {
    id: "b-custom",
    scope: "domain",
    match,
    source: "user-declared",
    value: {
      kind: "perk",
      structuredPerks: [
        { type: "early_check_in", label: "Early check-in" },
        { type: "free_breakfast", label: "Free breakfast" },
      ],
    },
  };
  return {
    id: "m-custom",
    label: "Custom Hotel",
    attributes: {},
    benefits: [benefit],
    addedAt: "2026-01-01",
    status: "active",
  };
}

// ---------------------------------------------------------------------------
// TermProvenance type values
// ---------------------------------------------------------------------------

test("TermProvenance allows catalog, user-declared, and default-estimate values", () => {
  const catalog: TermProvenance = "catalog";
  const userDeclared: TermProvenance = "user-declared";
  const defaultEstimate: TermProvenance = "default-estimate";
  assert.equal(catalog, "catalog");
  assert.equal(userDeclared, "user-declared");
  assert.equal(defaultEstimate, "default-estimate");
});

// ---------------------------------------------------------------------------
// TermConfidence type values
// ---------------------------------------------------------------------------

test("TermConfidence allows verified, declared, and estimated values", () => {
  const verified: TermConfidence = "verified";
  const declared: TermConfidence = "declared";
  const estimated: TermConfidence = "estimated";
  assert.equal(verified, "verified");
  assert.equal(declared, "declared");
  assert.equal(estimated, "estimated");
});

// ---------------------------------------------------------------------------
// StructuredPerk carries optional provenance + confidence
// ---------------------------------------------------------------------------

test("StructuredPerk accepts provenance and confidence fields", () => {
  const perk: StructuredPerk = {
    type: "free_breakfast",
    label: "Complimentary breakfast",
    provenance: "catalog",
    confidence: "verified",
  };
  assert.equal(perk.provenance, "catalog");
  assert.equal(perk.confidence, "verified");
});

test("StructuredPerk is valid without provenance/confidence (optional fields)", () => {
  const perk: StructuredPerk = {
    type: "late_check_out",
    label: "Late check-out until 4pm",
  };
  assert.equal(perk.provenance, undefined);
  assert.equal(perk.confidence, undefined);
});

test("StructuredPerk user-declared provenance with declared confidence", () => {
  const perk: StructuredPerk = {
    type: "room_upgrade",
    label: "Room upgrade when available",
    provenance: "user-declared",
    confidence: "declared",
  };
  assert.equal(perk.provenance, "user-declared");
  assert.equal(perk.confidence, "declared");
});

test("StructuredPerk provenance and confidence carry no price-like keys", () => {
  const perk: StructuredPerk = {
    type: "spa_credit",
    label: "Spa credit",
    provenance: "catalog",
    confidence: "verified",
  };
  const priceKeys = ["price", "amount", "currency", "cost", "rate", "discount"];
  for (const key of priceKeys) {
    assert.equal((perk as Record<string, unknown>)[key], undefined, `StructuredPerk must not have key '${key}'`);
  }
});

// ---------------------------------------------------------------------------
// PerkEstimate carries estimateProvenance + estimateConfidence
// ---------------------------------------------------------------------------

test("PerkEstimate carries estimateProvenance: default-estimate", () => {
  const e = estimatePerkValue("free_breakfast", 4);
  assert.equal(e.estimateProvenance, "default-estimate");
});

test("PerkEstimate carries estimateConfidence: estimated", () => {
  const e = estimatePerkValue("room_upgrade", 5);
  assert.equal(e.estimateConfidence, "estimated");
});

test("PerkEstimate estimateProvenance and estimateConfidence are always set for all perk types", () => {
  const allBands = estimatePerkValueAllBands("early_check_in");
  for (const band of [3, 4, 5] as const) {
    assert.equal(allBands[band].estimateProvenance, "default-estimate");
    assert.equal(allBands[band].estimateConfidence, "estimated");
  }
});

test("estimatePerkValue: all bands always carry default-estimate provenance", () => {
  const types = ["free_breakfast", "room_upgrade", "lounge_access", "guaranteed_availability"] as const;
  for (const pt of types) {
    for (const band of [3, 4, 5] as const) {
      const e = estimatePerkValue(pt, band);
      assert.equal(e.estimateProvenance, "default-estimate", `${pt}@${band}★ estimateProvenance`);
      assert.equal(e.estimateConfidence, "estimated", `${pt}@${band}★ estimateConfidence`);
    }
  }
});

test("PerkEstimate provenance/confidence fields are not price-related keys", () => {
  const e = estimatePerkValue("free_breakfast", 4);
  const priceKeys = ["price", "currency", "discount", "percentOff", "amountOff", "rate", "cost"];
  for (const key of priceKeys) {
    assert.equal((e as Record<string, unknown>)[key], undefined, `PerkEstimate must not carry '${key}'`);
  }
});

// ---------------------------------------------------------------------------
// MatchedPerkEstimate from catalog membership carries expected labels
// ---------------------------------------------------------------------------

test("matchPage: catalog benefit produces termProvenance=catalog and termConfidence=verified", () => {
  const engine = new EnrichmentEngine();
  const ms = catalogMembership("booking_genius", "Level 3");
  const result = engine.matchPage({ domain: "booking.com" }, [ms]);

  assert.ok(result.perkEstimates.length > 0, "Level 3 should produce perk estimates");
  for (const est of result.perkEstimates) {
    assert.equal(est.termProvenance, "catalog", `${est.perkType} termProvenance`);
    assert.equal(est.termConfidence, "verified", `${est.perkType} termConfidence`);
  }
});

test("matchPage: catalog benefit always has estimateProvenance=default-estimate", () => {
  const engine = new EnrichmentEngine();
  const ms = catalogMembership("booking_genius", "Level 3");
  const result = engine.matchPage({ domain: "booking.com" }, [ms]);

  for (const est of result.perkEstimates) {
    assert.equal(est.estimateProvenance, "default-estimate", `${est.perkType} estimateProvenance`);
    assert.equal(est.estimateConfidence, "estimated", `${est.perkType} estimateConfidence`);
  }
});

test("matchPage: user-declared benefit produces termProvenance=user-declared and termConfidence=declared", () => {
  const engine = new EnrichmentEngine();
  const ms = userDeclaredMembership();
  const result = engine.matchPage({ domain: "example.com" }, [ms]);

  // free_breakfast is tangible so should appear in perkEstimates
  const breakfast = result.perkEstimates.find((e) => e.perkType === "free_breakfast");
  assert.ok(breakfast, "free_breakfast should appear in perkEstimates for user-declared membership");
  assert.equal(breakfast!.termProvenance, "user-declared");
  assert.equal(breakfast!.termConfidence, "declared");
  // estimate labels remain the same regardless of term source
  assert.equal(breakfast!.estimateProvenance, "default-estimate");
  assert.equal(breakfast!.estimateConfidence, "estimated");
});

test("matchPage: MatchedPerkEstimate carries all four required provenance/confidence labels", () => {
  const engine = new EnrichmentEngine();
  const ms = catalogMembership("booking_genius", "Level 3");
  const result = engine.matchPage({ domain: "booking.com" }, [ms]);

  for (const est of result.perkEstimates) {
    assert.ok("termProvenance" in est, "termProvenance must be present");
    assert.ok("termConfidence" in est, "termConfidence must be present");
    assert.ok("estimateProvenance" in est, "estimateProvenance must be present");
    assert.ok("estimateConfidence" in est, "estimateConfidence must be present");
  }
});

// ---------------------------------------------------------------------------
// StructuredPerk.provenance overrides the benefit-source-derived default
// ---------------------------------------------------------------------------

test("matchPage: StructuredPerk.provenance overrides benefit source derivation", () => {
  const engine = new EnrichmentEngine();
  // Craft a catalog-source benefit whose perk explicitly marks as user-declared
  const benefit: Benefit = {
    id: "b-override",
    scope: "domain",
    match,
    source: "catalog",
    value: {
      kind: "perk",
      structuredPerks: [
        {
          type: "free_breakfast",
          label: "Free breakfast",
          provenance: "user-declared",
          confidence: "declared",
        },
      ],
    },
  };
  const ms: Membership = {
    id: "m-override",
    label: "Override Hotel",
    attributes: {},
    benefits: [benefit],
    addedAt: "2026-01-01",
    status: "active",
  };
  const result = engine.matchPage({ domain: "example.com" }, [ms]);
  const est = result.perkEstimates.find((e) => e.perkType === "free_breakfast");
  assert.ok(est, "free_breakfast perk estimate must be present");
  assert.equal(est!.termProvenance, "user-declared", "perk-level provenance override should take effect");
  assert.equal(est!.termConfidence, "declared", "perk-level confidence override should take effect");
});

// ---------------------------------------------------------------------------
// No price fields on provenance/confidence labels
// ---------------------------------------------------------------------------

test("MatchedPerkEstimate provenance/confidence fields are not price-like", () => {
  const engine = new EnrichmentEngine();
  const ms = catalogMembership("booking_genius", "Level 3");
  const result = engine.matchPage({ domain: "booking.com" }, [ms]);
  const priceKeys = ["price", "finalPrice", "memberPrice", "discountedPrice", "currency", "totalAmount", "nightlyAmount"];
  for (const est of result.perkEstimates) {
    for (const key of priceKeys) {
      assert.ok(!(key in est), `MatchedPerkEstimate must not have key '${key}'`);
    }
  }
});

test("provenance and confidence values are strings, not numbers or price-derived computations", () => {
  const engine = new EnrichmentEngine();
  const ms = catalogMembership("booking_genius", "Level 3");
  const result = engine.matchPage({ domain: "booking.com" }, [ms]);
  for (const est of result.perkEstimates) {
    assert.equal(typeof est.termProvenance, "string");
    assert.equal(typeof est.termConfidence, "string");
    assert.equal(typeof est.estimateProvenance, "string");
    assert.equal(typeof est.estimateConfidence, "string");
    // Confirm none of these look like a price
    for (const val of [est.termProvenance, est.termConfidence, est.estimateProvenance, est.estimateConfidence]) {
      assert.ok(isNaN(Number(val)), `provenance/confidence value '${val}' must not be numeric`);
    }
  }
});

// ---------------------------------------------------------------------------
// Type completeness: MatchedPerkEstimate satisfies the full interface
// ---------------------------------------------------------------------------

test("manually constructed MatchedPerkEstimate type-checks with all required provenance/confidence fields", () => {
  const est: MatchedPerkEstimate = {
    perkType: "lounge_access",
    label: "Executive lounge access",
    estimatedUsd: { 3: 0, 4: 30, 5: 60 },
    membershipLabel: "Test Membership",
    isEstimate: true,
    termProvenance: "catalog",
    termConfidence: "verified",
    estimateProvenance: "default-estimate",
    estimateConfidence: "estimated",
  };
  assert.equal(est.termProvenance, "catalog");
  assert.equal(est.termConfidence, "verified");
  assert.equal(est.estimateProvenance, "default-estimate");
  assert.equal(est.estimateConfidence, "estimated");
  assert.strictEqual(est.isEstimate, true);
});

test("MatchedPerkEstimate with user-declared provenance is valid", () => {
  const est: MatchedPerkEstimate = {
    perkType: "parking",
    label: "Complimentary parking",
    estimatedUsd: { 3: 10, 4: 20, 5: 40 },
    membershipLabel: "Custom Hotel",
    isEstimate: true,
    termProvenance: "user-declared",
    termConfidence: "declared",
    estimateProvenance: "default-estimate",
    estimateConfidence: "estimated",
  };
  assert.equal(est.termProvenance, "user-declared");
  assert.equal(est.termConfidence, "declared");
});
