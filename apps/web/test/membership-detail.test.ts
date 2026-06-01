import { test } from "node:test";
import assert from "node:assert/strict";
import type { Benefit, BenefitValue } from "../lib/api";

// benefitLines extracted for unit testing (mirrors Dashboard.tsx logic)
function benefitLines(benefits: Benefit[]): string[] {
  const out: string[] = [];
  for (const b of benefits) {
    const v = b.value;
    if (v.kind === "percentDiscount" && v.percentOff) out.push(`${Math.round(v.percentOff * 100)}% off`);
    else if (v.kind === "fixedDiscount" && v.amountOff) out.push(`${v.amountOff} off`);
    else if (v.kind === "pointsEarn") out.push("Earns points/miles");
    for (const p of v.perks ?? []) out.push(p);
  }
  return [...new Set(out)];
}

// benefitSummary extracted for unit testing (mirrors MembershipDetail.tsx logic)
function benefitSummary(v: BenefitValue): string {
  if (v.kind === "percentDiscount" && v.percentOff != null) return `${Math.round(v.percentOff * 100)}% off`;
  if (v.kind === "fixedDiscount" && v.amountOff != null) return `${v.amountOff} off`;
  if (v.kind === "pointsEarn") return "Earns points / miles";
  if (v.kind === "perk" && v.perks?.length) return v.perks.join(", ");
  return v.kind;
}

function makeBenefit(value: BenefitValue): Benefit {
  return { id: "b1", scope: "property", match: {}, value, source: "catalog" };
}

test("benefitLines: percentDiscount renders as integer %", () => {
  const lines = benefitLines([makeBenefit({ kind: "percentDiscount", percentOff: 0.15 })]);
  assert.deepEqual(lines, ["15% off"]);
});

test("benefitLines: pointsEarn renders label", () => {
  assert.deepEqual(benefitLines([makeBenefit({ kind: "pointsEarn" })]), ["Earns points/miles"]);
});

test("benefitLines: perks are included individually", () => {
  const lines = benefitLines([makeBenefit({ kind: "perk", perks: ["Free breakfast", "Late checkout"] })]);
  assert.deepEqual(lines, ["Free breakfast", "Late checkout"]);
});

test("benefitLines: deduplicates identical entries", () => {
  const lines = benefitLines([
    makeBenefit({ kind: "percentDiscount", percentOff: 0.1 }),
    makeBenefit({ kind: "percentDiscount", percentOff: 0.1 }),
  ]);
  assert.deepEqual(lines, ["10% off"]);
});

test("benefitLines: empty array for no benefits", () => {
  assert.deepEqual(benefitLines([]), []);
});

test("benefitSummary: percentDiscount rounds correctly", () => {
  assert.equal(benefitSummary({ kind: "percentDiscount", percentOff: 0.2 }), "20% off");
});

test("benefitSummary: fixedDiscount shows amount", () => {
  assert.equal(benefitSummary({ kind: "fixedDiscount", amountOff: 50 }), "50 off");
});

test("benefitSummary: perk joins perks with comma", () => {
  assert.equal(
    benefitSummary({ kind: "perk", perks: ["Free breakfast", "Late checkout"] }),
    "Free breakfast, Late checkout",
  );
});

test("benefitSummary: pointsEarn renders label", () => {
  assert.equal(benefitSummary({ kind: "pointsEarn" }), "Earns points / miles");
});

test("benefitSummary: unknown perk with no perks falls back to kind", () => {
  assert.equal(benefitSummary({ kind: "perk" }), "perk");
});

test("no price values are constructed in benefitLines or benefitSummary", () => {
  // Verifies that we never produce a computed price (hotel cost after discount).
  // percentOff and amountOff come from the catalog benefit definition — they are
  // discount descriptors, not derived room prices.
  const lines = benefitLines([
    makeBenefit({ kind: "percentDiscount", percentOff: 0.15 }),
    makeBenefit({ kind: "fixedDiscount", amountOff: 20 }),
  ]);
  // Must not contain any price-like pattern such as "$120" (the application of a
  // discount to a base price is forbidden by product rule #1).
  for (const line of lines) {
    assert.ok(!/\$\d/.test(line), `unexpected price pattern in: ${line}`);
  }
});
