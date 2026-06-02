import { test } from "node:test";
import assert from "node:assert/strict";
import {
  estimatePerkValue,
  estimatePerkValueAllBands,
  perkHasMonetaryEstimate,
  type StarBand,
  type PerkEstimate,
} from "../src/perk-value.js";
import type { PerkType } from "../src/types.js";

// ---------------------------------------------------------------------------
// estimatePerkValue — single perk × star band
// ---------------------------------------------------------------------------

test("early_check_in estimates match the documented example: $20/$40/$60", () => {
  assert.equal(estimatePerkValue("early_check_in", 3).estimatedUsd, 20);
  assert.equal(estimatePerkValue("early_check_in", 4).estimatedUsd, 40);
  assert.equal(estimatePerkValue("early_check_in", 5).estimatedUsd, 60);
});

test("late_check_out estimates match early_check_in (same tier as per table)", () => {
  assert.equal(estimatePerkValue("late_check_out", 3).estimatedUsd, 20);
  assert.equal(estimatePerkValue("late_check_out", 4).estimatedUsd, 40);
  assert.equal(estimatePerkValue("late_check_out", 5).estimatedUsd, 60);
});

test("free_breakfast estimates scale by star band", () => {
  const three = estimatePerkValue("free_breakfast", 3).estimatedUsd;
  const four  = estimatePerkValue("free_breakfast", 4).estimatedUsd;
  const five  = estimatePerkValue("free_breakfast", 5).estimatedUsd;
  assert.ok(three > 0, "3★ free_breakfast should have monetary value");
  assert.ok(four > three, "4★ should be higher than 3★");
  assert.ok(five > four, "5★ should be higher than 4★");
});

test("suite_upgrade is higher than room_upgrade for every band", () => {
  for (const band of [3, 4, 5] as StarBand[]) {
    assert.ok(
      estimatePerkValue("suite_upgrade", band).estimatedUsd >
      estimatePerkValue("room_upgrade", band).estimatedUsd,
      `suite_upgrade should exceed room_upgrade at ${band}★`,
    );
  }
});

test("intangible perks return 0 estimatedUsd for every band", () => {
  const intangibles: PerkType[] = ["guaranteed_availability", "priority_support"];
  for (const pt of intangibles) {
    for (const band of [3, 4, 5] as StarBand[]) {
      assert.equal(
        estimatePerkValue(pt, band).estimatedUsd,
        0,
        `${pt} at ${band}★ should be 0`,
      );
    }
  }
});

// ---------------------------------------------------------------------------
// isEstimate invariant — result must never look like a real price
// ---------------------------------------------------------------------------

test("every estimate has isEstimate: true", () => {
  const allTypes: PerkType[] = [
    "early_check_in", "late_check_out", "free_breakfast", "room_upgrade",
    "suite_upgrade", "lounge_access", "welcome_amenity", "free_wifi",
    "airport_transfer", "parking", "spa_credit", "guaranteed_availability",
    "points_bonus", "priority_support", "other",
  ];
  for (const pt of allTypes) {
    for (const band of [3, 4, 5] as StarBand[]) {
      const e = estimatePerkValue(pt, band);
      assert.equal(e.isEstimate, true, `${pt}@${band}★ must have isEstimate: true`);
    }
  }
});

test("PerkEstimate carries no price, discount, or currency-rate fields", () => {
  const e: PerkEstimate = estimatePerkValue("free_breakfast", 4);
  const priceKeys = ["price", "currency", "discount", "percentOff", "amountOff", "rate", "cost"];
  for (const key of priceKeys) {
    assert.equal(
      (e as Record<string, unknown>)[key],
      undefined,
      `PerkEstimate must not carry key '${key}'`,
    );
  }
});

// ---------------------------------------------------------------------------
// estimatePerkValueAllBands — convenience wrapper
// ---------------------------------------------------------------------------

test("estimatePerkValueAllBands returns an estimate for each of bands 3, 4, 5", () => {
  const bands = estimatePerkValueAllBands("lounge_access");
  assert.equal(Object.keys(bands).sort().join(","), "3,4,5");
  assert.equal(bands[3].starBand, 3);
  assert.equal(bands[4].starBand, 4);
  assert.equal(bands[5].starBand, 5);
  for (const b of [3, 4, 5] as const) {
    assert.equal(bands[b].isEstimate, true);
    assert.equal(bands[b].perkType, "lounge_access");
  }
});

test("estimatePerkValueAllBands lounge_access: 3★=0, 4★>0, 5★>0", () => {
  const { 3: b3, 4: b4, 5: b5 } = estimatePerkValueAllBands("lounge_access");
  assert.equal(b3.estimatedUsd, 0);
  assert.ok(b4.estimatedUsd > 0);
  assert.ok(b5.estimatedUsd >= b4.estimatedUsd);
});

// ---------------------------------------------------------------------------
// perkHasMonetaryEstimate
// ---------------------------------------------------------------------------

test("perkHasMonetaryEstimate: tangible perks return true", () => {
  const tangible: PerkType[] = [
    "early_check_in", "late_check_out", "free_breakfast", "room_upgrade",
    "suite_upgrade", "welcome_amenity", "free_wifi", "airport_transfer",
    "parking", "spa_credit", "points_bonus",
  ];
  for (const pt of tangible) {
    assert.ok(perkHasMonetaryEstimate(pt), `${pt} should have monetary estimate`);
  }
});

test("perkHasMonetaryEstimate: intangible perks return false", () => {
  assert.equal(perkHasMonetaryEstimate("guaranteed_availability"), false);
  assert.equal(perkHasMonetaryEstimate("priority_support"), false);
});

test("perkHasMonetaryEstimate: lounge_access returns true (non-zero at 4★/5★)", () => {
  assert.ok(perkHasMonetaryEstimate("lounge_access"));
});

// ---------------------------------------------------------------------------
// Coverage: all 15 PerkType values are present in the table
// ---------------------------------------------------------------------------

test("estimation table covers all canonical PerkType identifiers", () => {
  const allTypes: PerkType[] = [
    "early_check_in", "late_check_out", "free_breakfast", "room_upgrade",
    "suite_upgrade", "lounge_access", "welcome_amenity", "free_wifi",
    "airport_transfer", "parking", "spa_credit", "guaranteed_availability",
    "points_bonus", "priority_support", "other",
  ];
  for (const pt of allTypes) {
    // estimatePerkValue must not throw and must return a valid result
    const e = estimatePerkValue(pt, 4);
    assert.equal(typeof e.estimatedUsd, "number");
    assert.ok(e.estimatedUsd >= 0, `${pt} estimatedUsd must be non-negative`);
  }
});

test("estimates increase monotonically from 3★ to 5★ for all tangible perk types", () => {
  const tangible: PerkType[] = [
    "early_check_in", "late_check_out", "free_breakfast", "room_upgrade",
    "suite_upgrade", "welcome_amenity", "free_wifi", "airport_transfer",
    "parking", "spa_credit", "points_bonus", "other",
  ];
  for (const pt of tangible) {
    const v3 = estimatePerkValue(pt, 3).estimatedUsd;
    const v4 = estimatePerkValue(pt, 4).estimatedUsd;
    const v5 = estimatePerkValue(pt, 5).estimatedUsd;
    assert.ok(v4 >= v3, `${pt}: 4★ (${v4}) should be >= 3★ (${v3})`);
    assert.ok(v5 >= v4, `${pt}: 5★ (${v5}) should be >= 4★ (${v4})`);
  }
});

// ---------------------------------------------------------------------------
// Exact value verification for all 15 perk types at all 3 star bands
// (documents the canonical estimation table; guards against accidental drift)
// ---------------------------------------------------------------------------

test("exact values: free_breakfast — 3★=$15, 4★=$25, 5★=$50", () => {
  assert.equal(estimatePerkValue("free_breakfast", 3).estimatedUsd, 15);
  assert.equal(estimatePerkValue("free_breakfast", 4).estimatedUsd, 25);
  assert.equal(estimatePerkValue("free_breakfast", 5).estimatedUsd, 50);
});

test("exact values: room_upgrade — 3★=$30, 4★=$60, 5★=$120", () => {
  assert.equal(estimatePerkValue("room_upgrade", 3).estimatedUsd, 30);
  assert.equal(estimatePerkValue("room_upgrade", 4).estimatedUsd, 60);
  assert.equal(estimatePerkValue("room_upgrade", 5).estimatedUsd, 120);
});

test("exact values: suite_upgrade — 3★=$80, 4★=$150, 5★=$300", () => {
  assert.equal(estimatePerkValue("suite_upgrade", 3).estimatedUsd, 80);
  assert.equal(estimatePerkValue("suite_upgrade", 4).estimatedUsd, 150);
  assert.equal(estimatePerkValue("suite_upgrade", 5).estimatedUsd, 300);
});

test("exact values: lounge_access — 3★=$0, 4★=$30, 5★=$60", () => {
  assert.equal(estimatePerkValue("lounge_access", 3).estimatedUsd, 0);
  assert.equal(estimatePerkValue("lounge_access", 4).estimatedUsd, 30);
  assert.equal(estimatePerkValue("lounge_access", 5).estimatedUsd, 60);
});

test("exact values: welcome_amenity — 3★=$10, 4★=$20, 5★=$40", () => {
  assert.equal(estimatePerkValue("welcome_amenity", 3).estimatedUsd, 10);
  assert.equal(estimatePerkValue("welcome_amenity", 4).estimatedUsd, 20);
  assert.equal(estimatePerkValue("welcome_amenity", 5).estimatedUsd, 40);
});

test("exact values: free_wifi — 3★=$5, 4★=$10, 5★=$15", () => {
  assert.equal(estimatePerkValue("free_wifi", 3).estimatedUsd, 5);
  assert.equal(estimatePerkValue("free_wifi", 4).estimatedUsd, 10);
  assert.equal(estimatePerkValue("free_wifi", 5).estimatedUsd, 15);
});

test("exact values: airport_transfer — 3★=$20, 4★=$40, 5★=$80", () => {
  assert.equal(estimatePerkValue("airport_transfer", 3).estimatedUsd, 20);
  assert.equal(estimatePerkValue("airport_transfer", 4).estimatedUsd, 40);
  assert.equal(estimatePerkValue("airport_transfer", 5).estimatedUsd, 80);
});

test("exact values: parking — 3★=$10, 4★=$20, 5★=$40", () => {
  assert.equal(estimatePerkValue("parking", 3).estimatedUsd, 10);
  assert.equal(estimatePerkValue("parking", 4).estimatedUsd, 20);
  assert.equal(estimatePerkValue("parking", 5).estimatedUsd, 40);
});

test("exact values: spa_credit — 3★=$20, 4★=$50, 5★=$100", () => {
  assert.equal(estimatePerkValue("spa_credit", 3).estimatedUsd, 20);
  assert.equal(estimatePerkValue("spa_credit", 4).estimatedUsd, 50);
  assert.equal(estimatePerkValue("spa_credit", 5).estimatedUsd, 100);
});

test("exact values: points_bonus — 3★=$5, 4★=$10, 5★=$20", () => {
  assert.equal(estimatePerkValue("points_bonus", 3).estimatedUsd, 5);
  assert.equal(estimatePerkValue("points_bonus", 4).estimatedUsd, 10);
  assert.equal(estimatePerkValue("points_bonus", 5).estimatedUsd, 20);
});

test("exact values: other — 3★=$10, 4★=$20, 5★=$40", () => {
  assert.equal(estimatePerkValue("other", 3).estimatedUsd, 10);
  assert.equal(estimatePerkValue("other", 4).estimatedUsd, 20);
  assert.equal(estimatePerkValue("other", 5).estimatedUsd, 40);
});

test("exact values: guaranteed_availability and priority_support are 0 at all bands", () => {
  for (const band of [3, 4, 5] as StarBand[]) {
    assert.equal(estimatePerkValue("guaranteed_availability", band).estimatedUsd, 0);
    assert.equal(estimatePerkValue("priority_support", band).estimatedUsd, 0);
  }
});

test("suite_upgrade has the highest estimate at every star band among all perk types", () => {
  const allTypes: PerkType[] = [
    "early_check_in", "late_check_out", "free_breakfast", "room_upgrade",
    "lounge_access", "welcome_amenity", "free_wifi", "airport_transfer",
    "parking", "spa_credit", "guaranteed_availability", "points_bonus",
    "priority_support", "other",
  ];
  for (const band of [3, 4, 5] as StarBand[]) {
    const suiteValue = estimatePerkValue("suite_upgrade", band).estimatedUsd;
    for (const pt of allTypes) {
      assert.ok(
        suiteValue >= estimatePerkValue(pt, band).estimatedUsd,
        `suite_upgrade (${suiteValue}) should be >= ${pt} at ${band}★`,
      );
    }
  }
});
