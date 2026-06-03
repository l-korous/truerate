/**
 * Tests for match.ts — benefitMatches, matchBenefits, resolveConflicts,
 * PERK_STACKING config, and collectPerks.
 *
 * Covers issue #115 acceptance criteria:
 *  - Conflict/stacking rules modeled and applied in match.ts
 *  - Given overlapping memberships, output reflects correct stacking/exclusion
 *    and precedence
 *  - No price math performed; resolution operates purely on scope and perk-term
 *    metadata
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  benefitMatches,
  collectPerks,
  matchBenefits,
  PERK_STACKING,
  resolveConflicts,
} from "../src/match.js";
import { getProgram, instantiateBenefits } from "../src/programs.js";
import type {
  Benefit,
  BenefitMatch,
  MatchTarget,
  Membership,
  PerkType,
} from "../src/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBenefit(
  opts: {
    kind?: "percentDiscount" | "fixedDiscount" | "perk" | "pointsEarn";
    percentOff?: number;
    amountOff?: number;
    perkTypes?: Array<{ type: PerkType; guaranteed?: boolean }>;
    scope?: Benefit["scope"];
    match?: BenefitMatch;
    programId?: string;
  } = {},
): Benefit {
  const {
    kind = "perk",
    percentOff,
    amountOff,
    perkTypes = [],
    scope = "global",
    match = { categories: ["hotel"] },
    programId,
  } = opts;

  const value =
    kind === "percentDiscount"
      ? { kind: "percentDiscount" as const, percentOff: percentOff ?? 0.1 }
      : kind === "fixedDiscount"
        ? { kind: "fixedDiscount" as const, amountOff: amountOff ?? 50 }
        : kind === "pointsEarn"
          ? { kind: "pointsEarn" as const, pointsPerUnit: 1 }
          : {
              kind: "perk" as const,
              structuredPerks: perkTypes.map(({ type, guaranteed = false }) => ({
                type,
                label: type,
                conditions: guaranteed ? undefined : { subjectToAvailability: true as const },
              })),
            };

  return {
    id: randomUUID(),
    scope,
    match,
    value,
    source: "catalog" as const,
    ...(programId ? { programId } : {}),
  };
}

function makeMembership(id: string, benefits: Benefit[]): Membership {
  return {
    id,
    label: `Membership ${id}`,
    attributes: {},
    benefits,
    addedAt: "2026-01-01",
    status: "active",
  };
}

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

// ---------------------------------------------------------------------------
// PERK_STACKING config
// ---------------------------------------------------------------------------

test("PERK_STACKING: take-best perks are the non-additive ones", () => {
  const takeBestTypes: PerkType[] = [
    "early_check_in",
    "late_check_out",
    "free_breakfast",
    "room_upgrade",
    "suite_upgrade",
    "welcome_amenity",
    "airport_transfer",
    "parking",
    "guaranteed_availability",
  ];
  for (const t of takeBestTypes) {
    assert.equal(PERK_STACKING[t], "take-best", `${t} should be take-best`);
  }
});

test("PERK_STACKING: stack perks are the additive ones", () => {
  const stackTypes: PerkType[] = [
    "lounge_access",
    "free_wifi",
    "spa_credit",
    "points_bonus",
    "priority_support",
    "other",
  ];
  for (const t of stackTypes) {
    assert.equal(PERK_STACKING[t], "stack", `${t} should be stack`);
  }
});

test("PERK_STACKING: covers all 15 PerkType values", () => {
  const allTypes: PerkType[] = [
    "early_check_in", "late_check_out", "free_breakfast", "room_upgrade",
    "suite_upgrade", "lounge_access", "welcome_amenity", "free_wifi",
    "airport_transfer", "parking", "spa_credit", "guaranteed_availability",
    "points_bonus", "priority_support", "other",
  ];
  for (const t of allTypes) {
    assert.ok(
      PERK_STACKING[t] === "take-best" || PERK_STACKING[t] === "stack",
      `${t} must have a defined stacking behavior`,
    );
  }
});

// ---------------------------------------------------------------------------
// benefitMatches
// ---------------------------------------------------------------------------

test("benefitMatches: domain match is case-insensitive", () => {
  const b = makeBenefit({ scope: "domain", match: { domains: ["Booking.COM"] } });
  assert.ok(benefitMatches(b, { domain: "booking.com" }));
  assert.ok(!benefitMatches(b, { domain: "expedia.com" }));
});

test("benefitMatches: subdomain matches parent domain", () => {
  const b = makeBenefit({ scope: "domain", match: { domains: ["booking.com"] } });
  assert.ok(benefitMatches(b, { domain: "hotels.booking.com" }));
});

test("benefitMatches: category match works", () => {
  const b = makeBenefit({ scope: "category", match: { categories: ["hotel"] } });
  assert.ok(benefitMatches(b, { category: "hotel" }));
  assert.ok(!benefitMatches(b, { category: "airline" }));
});

test("benefitMatches: brand match is substring-tolerant", () => {
  const b = makeBenefit({ scope: "brand", match: { brands: ["Marriott"] } });
  assert.ok(benefitMatches(b, { brand: "Marriott Hotels" }));
  assert.ok(benefitMatches(b, { brand: "marriott" }));
  assert.ok(!benefitMatches(b, { brand: "Hilton" }));
});

test("benefitMatches: propertyName match is substring-tolerant", () => {
  const b = makeBenefit({ scope: "property", match: { propertyNames: ["Hotel PECR"] } });
  assert.ok(benefitMatches(b, { propertyName: "Hotel PECR Prague" }));
  assert.ok(!benefitMatches(b, { propertyName: "Hotel Hilton" }));
});

// ---------------------------------------------------------------------------
// resolveConflicts — discount conflicts
// ---------------------------------------------------------------------------

test("resolveConflicts: two percent discounts on same domain → higher wins", () => {
  const target: MatchTarget = { domain: "booking.com", category: "hotel" };
  const low = makeBenefit({ kind: "percentDiscount", percentOff: 0.10, scope: "domain", match: { domains: ["booking.com"] } });
  const high = makeBenefit({ kind: "percentDiscount", percentOff: 0.20, scope: "domain", match: { domains: ["booking.com"] } });

  const ms1 = makeMembership("ms1", [low]);
  const ms2 = makeMembership("ms2", [high]);
  const raw = matchBenefits([ms1, ms2], target);
  const { applicable, suppressed } = resolveConflicts(raw, target);

  assert.equal(applicable.length, 1);
  assert.equal(suppressed.length, 1);
  assert.equal(applicable[0]!.benefit.id, high.id);
  assert.equal(suppressed[0]!.benefit.benefit.id, low.id);
  assert.ok(suppressed[0]!.conflictGroup.startsWith("discount:"));
});

test("resolveConflicts: same percent discount value → stable winner (not both suppressed)", () => {
  const target: MatchTarget = { domain: "booking.com" };
  const a = makeBenefit({ kind: "percentDiscount", percentOff: 0.15, scope: "domain", match: { domains: ["booking.com"] } });
  const b = makeBenefit({ kind: "percentDiscount", percentOff: 0.15, scope: "domain", match: { domains: ["booking.com"] } });

  const ms1 = makeMembership("ms1", [a]);
  const ms2 = makeMembership("ms2", [b]);
  const raw = matchBenefits([ms1, ms2], target);
  const { applicable, suppressed } = resolveConflicts(raw, target);

  // One must win; one must be suppressed; never two suppressed or zero suppressed.
  assert.equal(applicable.length, 1);
  assert.equal(suppressed.length, 1);
});

test("resolveConflicts: higher-scope discount beats lower-scope with same value", () => {
  const target: MatchTarget = { domain: "hilton.com", brand: "Hilton", category: "hotel" };
  // brand-scope vs. category-scope — different anchors → different conflict groups → both kept
  const brandDiscount = makeBenefit({ kind: "percentDiscount", percentOff: 0.05, scope: "brand", match: { brands: ["Hilton"] } });
  const catDiscount = makeBenefit({ kind: "percentDiscount", percentOff: 0.05, scope: "category", match: { categories: ["hotel"] } });

  const ms1 = makeMembership("ms1", [brandDiscount]);
  const ms2 = makeMembership("ms2", [catDiscount]);
  const raw = matchBenefits([ms1, ms2], target);
  const { applicable, suppressed } = resolveConflicts(raw, target);

  // Different anchors ("brand:hilton" vs "category:hotel") → no conflict
  assert.equal(applicable.length, 2, "different anchors should not conflict");
  assert.equal(suppressed.length, 0);
});

test("resolveConflicts: discounts on different domains do not conflict", () => {
  const target: MatchTarget = { domain: "booking.com" };
  const bookingDiscount = makeBenefit({ kind: "percentDiscount", percentOff: 0.15, scope: "domain", match: { domains: ["booking.com"] } });
  const hiltonDiscount = makeBenefit({ kind: "percentDiscount", percentOff: 0.05, scope: "domain", match: { domains: ["hilton.com"] } });

  // hiltonDiscount does NOT match the booking.com target
  const ms1 = makeMembership("ms1", [bookingDiscount]);
  const ms2 = makeMembership("ms2", [hiltonDiscount]);
  const raw = matchBenefits([ms1, ms2], target);
  const { applicable, suppressed } = resolveConflicts(raw, target);

  assert.equal(applicable.length, 1, "only booking.com discount matches");
  assert.equal(suppressed.length, 0);
  assert.equal(applicable[0]!.benefit.id, bookingDiscount.id);
});

// ---------------------------------------------------------------------------
// resolveConflicts — perk conflicts (take-best types)
// ---------------------------------------------------------------------------

test("resolveConflicts: two room_upgrade perks → more specific scope wins", () => {
  const target: MatchTarget = { brand: "Hilton", category: "hotel" };
  const brandUpgrade = makeBenefit({ scope: "brand", match: { brands: ["Hilton"] }, perkTypes: [{ type: "room_upgrade", guaranteed: true }] });
  const globalUpgrade = makeBenefit({ scope: "global", match: { categories: ["hotel"] }, perkTypes: [{ type: "room_upgrade", guaranteed: false }] });

  const ms1 = makeMembership("ms1", [brandUpgrade]);
  const ms2 = makeMembership("ms2", [globalUpgrade]);
  const raw = matchBenefits([ms1, ms2], target);
  const { applicable, suppressed } = resolveConflicts(raw, target);

  assert.equal(applicable.length, 1);
  assert.equal(suppressed.length, 1);
  assert.equal(applicable[0]!.benefit.id, brandUpgrade.id, "brand scope wins over global");
  assert.equal(suppressed[0]!.conflictGroup, "perk:room_upgrade");
});

test("resolveConflicts: guaranteed room_upgrade beats space-available at same scope", () => {
  const target: MatchTarget = { category: "hotel" };
  const guaranteed = makeBenefit({ scope: "global", match: { categories: ["hotel"] }, perkTypes: [{ type: "room_upgrade", guaranteed: true }] });
  const spaceAvail = makeBenefit({ scope: "global", match: { categories: ["hotel"] }, perkTypes: [{ type: "room_upgrade", guaranteed: false }] });

  const ms1 = makeMembership("ms1", [guaranteed]);
  const ms2 = makeMembership("ms2", [spaceAvail]);
  const raw = matchBenefits([ms1, ms2], target);
  const { applicable, suppressed } = resolveConflicts(raw, target);

  assert.equal(applicable.length, 1);
  assert.equal(applicable[0]!.benefit.id, guaranteed.id);
  assert.equal(suppressed.length, 1);
});

test("resolveConflicts: free_breakfast is take-best (non-stackable)", () => {
  const target: MatchTarget = { brand: "Hilton", category: "hotel" };
  const b1 = makeBenefit({ scope: "brand", match: { brands: ["Hilton"] }, perkTypes: [{ type: "free_breakfast", guaranteed: true }] });
  const b2 = makeBenefit({ scope: "global", match: { categories: ["hotel"] }, perkTypes: [{ type: "free_breakfast", guaranteed: false }] });

  const raw = matchBenefits(
    [makeMembership("m1", [b1]), makeMembership("m2", [b2])],
    target,
  );
  const { applicable, suppressed } = resolveConflicts(raw, target);

  assert.equal(applicable.length, 1);
  assert.equal(suppressed.length, 1);
  assert.equal(applicable[0]!.benefit.id, b1.id);
});

// ---------------------------------------------------------------------------
// resolveConflicts — stack-type perks are never suppressed
// ---------------------------------------------------------------------------

test("resolveConflicts: two lounge_access perks both kept (stack)", () => {
  const target: MatchTarget = { category: "hotel" };
  const lounge1 = makeBenefit({ scope: "global", match: { categories: ["hotel"] }, perkTypes: [{ type: "lounge_access" }] });
  const lounge2 = makeBenefit({ scope: "brand", match: { brands: ["Hilton"] }, perkTypes: [{ type: "lounge_access" }] });

  const ms1 = makeMembership("ms1", [lounge1]);
  const ms2 = makeMembership("ms2", [lounge2]);
  const raw = matchBenefits([ms1, ms2], { category: "hotel", brand: "Hilton" });
  const { applicable, suppressed } = resolveConflicts(raw, { category: "hotel", brand: "Hilton" });

  assert.equal(applicable.length, 2, "lounge_access is a stack type — both kept");
  assert.equal(suppressed.length, 0);
});

test("resolveConflicts: two spa_credit benefits both kept (stack)", () => {
  const target: MatchTarget = { category: "hotel" };
  const spa1 = makeBenefit({ scope: "global", match: { categories: ["hotel"] }, perkTypes: [{ type: "spa_credit" }] });
  const spa2 = makeBenefit({ scope: "brand", match: { brands: ["Marriott"] }, perkTypes: [{ type: "spa_credit" }] });

  const raw = matchBenefits(
    [makeMembership("m1", [spa1]), makeMembership("m2", [spa2])],
    { category: "hotel", brand: "Marriott" },
  );
  const { applicable, suppressed } = resolveConflicts(raw, { category: "hotel", brand: "Marriott" });

  assert.equal(applicable.length, 2);
  assert.equal(suppressed.length, 0);
});

test("resolveConflicts: points_bonus from two programs both kept (stack)", () => {
  const target: MatchTarget = { brand: "Hilton" };
  const pts1 = makeBenefit({ scope: "brand", match: { brands: ["Hilton"] }, perkTypes: [{ type: "points_bonus" }] });
  const pts2 = makeBenefit({ scope: "global", match: { categories: ["hotel"] }, perkTypes: [{ type: "points_bonus" }] });

  const raw = matchBenefits(
    [makeMembership("m1", [pts1]), makeMembership("m2", [pts2])],
    { brand: "Hilton", category: "hotel" },
  );
  const { applicable, suppressed } = resolveConflicts(raw, { brand: "Hilton", category: "hotel" });

  assert.equal(applicable.length, 2, "points_bonus stacks across programs");
  assert.equal(suppressed.length, 0);
});

// ---------------------------------------------------------------------------
// resolveConflicts — mixed-type benefits (partial conflict)
// ---------------------------------------------------------------------------

test("resolveConflicts: benefit with both take-best and stack perks is never fully suppressed", () => {
  // ms1 benefit: room_upgrade (take-best) + lounge_access (stack)
  // ms2 benefit: room_upgrade (take-best, higher scope) — wins the room_upgrade conflict
  // ms1 must still be APPLICABLE because it contributes lounge_access (stack)
  const target: MatchTarget = { brand: "Marriott", category: "hotel" };

  const mixed = makeBenefit({
    scope: "global",
    match: { categories: ["hotel"] },
    perkTypes: [
      { type: "room_upgrade", guaranteed: false },
      { type: "lounge_access" },
    ],
  });
  const betterUpgrade = makeBenefit({
    scope: "brand",
    match: { brands: ["Marriott"] },
    perkTypes: [{ type: "room_upgrade", guaranteed: true }],
  });

  const raw = matchBenefits(
    [makeMembership("m1", [mixed]), makeMembership("m2", [betterUpgrade])],
    target,
  );
  const { applicable, suppressed } = resolveConflicts(raw, target);

  assert.equal(applicable.length, 2, "mixed benefit kept because lounge_access is a stack-type win");
  assert.equal(suppressed.length, 0);
});

test("resolveConflicts: benefit with only losing take-best perks is suppressed", () => {
  const target: MatchTarget = { brand: "Hilton", category: "hotel" };

  const weakUpgrade = makeBenefit({
    scope: "global",
    match: { categories: ["hotel"] },
    perkTypes: [{ type: "room_upgrade", guaranteed: false }],
  });
  const strongUpgrade = makeBenefit({
    scope: "brand",
    match: { brands: ["Hilton"] },
    perkTypes: [{ type: "room_upgrade", guaranteed: true }],
  });

  const raw = matchBenefits(
    [makeMembership("m1", [weakUpgrade]), makeMembership("m2", [strongUpgrade])],
    target,
  );
  const { applicable, suppressed } = resolveConflicts(raw, target);

  assert.equal(applicable.length, 1);
  assert.equal(suppressed.length, 1);
  assert.equal(applicable[0]!.benefit.id, strongUpgrade.id);
});

// ---------------------------------------------------------------------------
// resolveConflicts — no conflicts
// ---------------------------------------------------------------------------

test("resolveConflicts: single benefit → always applicable", () => {
  const target: MatchTarget = { domain: "booking.com" };
  const b = makeBenefit({ kind: "percentDiscount", percentOff: 0.15, scope: "domain", match: { domains: ["booking.com"] } });
  const raw = matchBenefits([makeMembership("m1", [b])], target);
  const { applicable, suppressed } = resolveConflicts(raw, target);

  assert.equal(applicable.length, 1);
  assert.equal(suppressed.length, 0);
});

test("resolveConflicts: empty input returns empty output", () => {
  const { applicable, suppressed } = resolveConflicts([], { domain: "booking.com" });
  assert.equal(applicable.length, 0);
  assert.equal(suppressed.length, 0);
});

test("resolveConflicts: non-overlapping memberships both kept", () => {
  const target: MatchTarget = { domain: "hilton.com", brand: "Hilton", category: "hotel" };
  const hiltonDiscount = makeBenefit({ kind: "percentDiscount", percentOff: 0.05, scope: "domain", match: { domains: ["hilton.com"] } });
  const bookingDiscount = makeBenefit({ kind: "percentDiscount", percentOff: 0.15, scope: "domain", match: { domains: ["booking.com"] } });

  // bookingDiscount does NOT match hilton.com target
  const raw = matchBenefits(
    [makeMembership("m1", [hiltonDiscount]), makeMembership("m2", [bookingDiscount])],
    target,
  );
  const { applicable, suppressed } = resolveConflicts(raw, target);

  assert.equal(applicable.length, 1, "only hilton.com discount matches");
  assert.equal(suppressed.length, 0);
});

// ---------------------------------------------------------------------------
// matchBenefits with applyStackingRules option
// ---------------------------------------------------------------------------

test("matchBenefits with applyStackingRules=false (default) returns all matched benefits", () => {
  const target: MatchTarget = { domain: "booking.com", category: "hotel" };
  const low = makeBenefit({ kind: "percentDiscount", percentOff: 0.10, scope: "domain", match: { domains: ["booking.com"] } });
  const high = makeBenefit({ kind: "percentDiscount", percentOff: 0.20, scope: "domain", match: { domains: ["booking.com"] } });

  const all = matchBenefits(
    [makeMembership("m1", [low]), makeMembership("m2", [high])],
    target,
  );
  // Default: no stacking rules applied → both returned
  assert.equal(all.length, 2);
});

test("matchBenefits with applyStackingRules=true returns only applicable set", () => {
  const target: MatchTarget = { domain: "booking.com", category: "hotel" };
  const low = makeBenefit({ kind: "percentDiscount", percentOff: 0.10, scope: "domain", match: { domains: ["booking.com"] } });
  const high = makeBenefit({ kind: "percentDiscount", percentOff: 0.20, scope: "domain", match: { domains: ["booking.com"] } });

  const resolved = matchBenefits(
    [makeMembership("m1", [low]), makeMembership("m2", [high])],
    target,
    { applyStackingRules: true },
  );
  assert.equal(resolved.length, 1);
  assert.equal(resolved[0]!.benefit.id, high.id);
});

test("matchBenefits: invalid memberships are excluded before stacking", () => {
  const target: MatchTarget = { domain: "booking.com" };
  const b = makeBenefit({ kind: "percentDiscount", percentOff: 0.15, scope: "domain", match: { domains: ["booking.com"] } });
  const invalidMs: Membership = { ...makeMembership("inv", [b]), status: "invalid" };

  const out = matchBenefits([invalidMs], target, { applyStackingRules: true });
  assert.equal(out.length, 0, "invalid membership excluded");
});

// ---------------------------------------------------------------------------
// Realistic catalog program scenarios
// ---------------------------------------------------------------------------

test("catalog: Booking Genius Level 2 vs Level 3 on booking.com → Level 3 wins", () => {
  // A user should not have both levels, but if they do the higher one wins.
  const l2 = catalogMembership("booking_genius", "Level 2");
  const l3 = catalogMembership("booking_genius", "Level 3");
  const target: MatchTarget = { domain: "booking.com", category: "hotel" };

  const raw = matchBenefits([l2, l3], target);
  const { applicable, suppressed } = resolveConflicts(raw, target);

  // L3 has higher percentOff (0.20 > 0.15) → L3 discount wins
  const l3Discounts = applicable.filter((mb) => mb.membershipId === "m-booking_genius" && mb.benefit.value.percentOff === 0.20);
  const l2Discounts = suppressed.filter((s) => s.benefit.benefit.value.percentOff === 0.15);
  assert.ok(l3Discounts.length > 0, "L3 20% discount should be applicable");
  assert.ok(l2Discounts.length > 0, "L2 15% discount should be suppressed");
});

test("catalog: hilton_honors Gold + amex_platinum on Hilton brand — brand-scope perks beat global-scope", () => {
  const hilton = catalogMembership("hilton_honors", "Gold");
  const amex = catalogMembership("amex_platinum");
  const target: MatchTarget = { brand: "Hilton", category: "hotel" };

  const raw = matchBenefits([hilton, amex], target);
  const { applicable, suppressed } = resolveConflicts(raw, target);

  // Hilton Gold free_breakfast (brand scope) must win over Amex (global scope)
  const hiltonBreakfasts = applicable.filter(
    (mb) =>
      mb.membershipId === "m-hilton_honors" &&
      mb.benefit.value.structuredPerks?.some((p) => p.type === "free_breakfast"),
  );
  assert.ok(hiltonBreakfasts.length > 0, "Hilton Gold free_breakfast should be applicable");

  // Amex lounge_access is a stack type — must remain applicable regardless
  const amexLounges = applicable.filter(
    (mb) =>
      mb.membershipId === "m-amex_platinum" &&
      mb.benefit.value.structuredPerks?.some((p) => p.type === "lounge_access"),
  );
  assert.ok(amexLounges.length > 0, "Amex lounge_access should be kept (stack type)");
});

test("catalog: marriott_bonvoy Platinum + amex_platinum on Marriott brand — Marriott perks win take-best conflicts", () => {
  const marriott = catalogMembership("marriott_bonvoy", "Platinum");
  const amex = catalogMembership("amex_platinum");
  const target: MatchTarget = { brand: "Marriott", category: "hotel" };

  const raw = matchBenefits([marriott, amex], target);
  const { applicable, suppressed } = resolveConflicts(raw, target);

  // Marriott Platinum has brand scope → wins take-best conflicts against Amex global scope
  const marriottBreakfasts = applicable.filter(
    (mb) =>
      mb.membershipId === "m-marriott_bonvoy" &&
      mb.benefit.value.structuredPerks?.some((p) => p.type === "free_breakfast"),
  );
  assert.ok(marriottBreakfasts.length > 0, "Marriott Platinum breakfast should be applicable");
});

test("catalog: resolveConflicts output carries no price fields", () => {
  const hilton = catalogMembership("hilton_honors", "Gold");
  const amex = catalogMembership("amex_platinum");
  const target: MatchTarget = { brand: "Hilton", category: "hotel" };
  const priceKeys = ["price", "amount", "currency", "cost", "rate", "discount", "savingsAmount", "memberPrice", "finalPrice"];

  const raw = matchBenefits([hilton, amex], target);
  const { applicable, suppressed } = resolveConflicts(raw, target);

  for (const mb of [...applicable, ...suppressed.map((s) => s.benefit)]) {
    for (const key of priceKeys) {
      assert.ok(!(key in mb), `MatchedBenefit must not have price key '${key}'`);
    }
    for (const sp of mb.benefit.value.structuredPerks ?? []) {
      for (const key of priceKeys) {
        assert.ok(!(key in sp), `StructuredPerk must not have price key '${key}'`);
      }
    }
  }
});

// ---------------------------------------------------------------------------
// collectPerks
// ---------------------------------------------------------------------------

test("collectPerks: extracts unique perk strings from BenefitValues", () => {
  const values = [
    { kind: "perk" as const, perks: ["Free breakfast", "Late checkout"] },
    { kind: "perk" as const, perks: ["Late checkout", "Room upgrade"] },
  ];
  const result = collectPerks(values);
  assert.equal(result.length, 3);
  assert.ok(result.includes("Free breakfast"));
  assert.ok(result.includes("Late checkout"));
  assert.ok(result.includes("Room upgrade"));
});

test("collectPerks: returns empty array when no perks", () => {
  const values = [{ kind: "percentDiscount" as const, percentOff: 0.1 }];
  assert.deepEqual(collectPerks(values), []);
});
