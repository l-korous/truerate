import { test } from "node:test";
import assert from "node:assert/strict";
import { buildServer, buildBenefitResult, formatBenefitResult, type McpBenefitResult } from "../src/server.js";

test("buildServer registers the hotel and membership tools", () => {
  const server = buildServer("user-1");
  const tools = (server as any)._registeredTools ?? (server as any).tools ?? {};
  const names = Object.keys(tools);
  assert.ok(names.includes("search_hotels"), `tools: ${names.join(",")}`);
  assert.ok(names.includes("get_membership_summary"));
});

const sample: McpBenefitResult = {
  context: { brand: "Marriott", location: "Vienna", stars: 4 },
  matches: [
    {
      membershipId: "m1",
      membershipLabel: "Booking.com Genius - Level 3",
      benefitId: "b1",
      discount: { percentOff: 0.2 },
      perks: ["Free breakfast"],
      structuredPerks: [{ type: "free_breakfast", label: "Free breakfast daily" }],
      conditions: undefined,
    },
  ],
  perkValueEstimates: [
    {
      perkType: "free_breakfast",
      label: "Free breakfast daily",
      estimatedUsd: { 3: 15, 4: 25, 5: 50 },
      isEstimate: true,
    },
  ],
  programsApplied: ["booking_genius"],
  generatedAt: new Date().toISOString(),
  stalenessWarnings: [],
};

test("formatBenefitResult surfaces context, discounts, perks and estimates — no prices", () => {
  const text = formatBenefitResult(sample);
  assert.match(text, /Marriott/);
  assert.match(text, /Booking\.com Genius - Level 3/);
  assert.match(text, /20% off/);
  assert.match(text, /Free breakfast/);
  assert.match(text, /\$25/);
  assert.match(text, /Prices are not returned/i);
  assert.doesNotMatch(text, /member.*price|indicative|savings|totalAmount|nightlyAmount/i);
});

test("formatBenefitResult handles no matches", () => {
  const text = formatBenefitResult({ ...sample, matches: [], perkValueEstimates: [] });
  assert.match(text, /No applicable benefits found/);
  assert.match(text, /Prices are not returned/i);
});

test("buildBenefitResult strips prices and includes perk estimates", () => {
  const matches = [
    {
      benefit: {
        id: "b1",
        scope: "category" as const,
        match: { categories: ["hotel" as const] },
        value: {
          kind: "percentDiscount" as const,
          percentOff: 0.1,
          conditions: "direct booking only",
          structuredPerks: [{ type: "free_wifi" as const, label: "Complimentary Wi-Fi" }],
        },
        source: "catalog" as const,
        programId: "booking_genius",
      },
      membershipId: "m1",
      membershipLabel: "Booking.com Genius - Level 1",
    },
  ];
  const result = buildBenefitResult(matches, { brand: "Any", stars: 5 });
  assert.strictEqual(result.matches.length, 1);
  assert.ok(result.matches[0]!.discount);
  assert.strictEqual(result.matches[0]!.discount!.percentOff, 0.1);
  assert.ok(!("publicOffer" in result), "publicOffer must not appear in MCP result");
  assert.ok(!("nightlyAmount" in result), "nightlyAmount must not appear in MCP result");
  assert.strictEqual(result.perkValueEstimates.length, 1);
  assert.strictEqual(result.perkValueEstimates[0]!.perkType, "free_wifi");
  assert.strictEqual(result.perkValueEstimates[0]!.isEstimate, true);
  assert.ok(result.perkValueEstimates[0]!.estimatedUsd[5] > 0);
});

// --- Staleness annotations ---

test("buildBenefitResult produces empty stalenessWarnings when no confidence data", () => {
  const matches = [
    {
      benefit: {
        id: "b1",
        scope: "category" as const,
        match: { categories: ["hotel" as const] },
        value: { kind: "perk" as const, perks: ["Free breakfast"] },
        source: "catalog" as const,
        programId: "some_program",
      },
      membershipId: "m1",
      membershipLabel: "Some Program",
      confidence: undefined,
    },
  ];
  const result = buildBenefitResult(matches, {});
  assert.deepStrictEqual(result.stalenessWarnings, []);
});

test("buildBenefitResult adds staleness warning for stale confidence", () => {
  const matches = [
    {
      benefit: {
        id: "b1",
        scope: "category" as const,
        match: { categories: ["hotel" as const] },
        value: { kind: "perk" as const, perks: ["Free breakfast"] },
        source: "catalog" as const,
        programId: "some_program",
      },
      membershipId: "m1",
      membershipLabel: "Stale Program",
      confidence: {
        level: "stale" as const,
        score: 0.1,
        ageMonths: 24,
        expiresAt: "2024-01-01",
        isExpired: true,
      },
    },
  ];
  const result = buildBenefitResult(matches, {});
  assert.strictEqual(result.matches[0]!.termsConfidenceLevel, "stale");
  assert.strictEqual(result.stalenessWarnings.length, 1);
  assert.match(result.stalenessWarnings[0]!, /Stale Program/);
  assert.match(result.stalenessWarnings[0]!, /outdated/i);
});

test("buildBenefitResult adds advisory warning for low confidence", () => {
  const matches = [
    {
      benefit: {
        id: "b1",
        scope: "category" as const,
        match: { categories: ["hotel" as const] },
        value: { kind: "perk" as const, perks: ["Parking"] },
        source: "catalog" as const,
        programId: "some_program",
      },
      membershipId: "m1",
      membershipLabel: "Low-Confidence Program",
      confidence: {
        level: "low" as const,
        score: 0.3,
        ageMonths: 8,
        expiresAt: "2026-06-01",
        isExpired: false,
      },
    },
  ];
  const result = buildBenefitResult(matches, {});
  assert.strictEqual(result.matches[0]!.termsConfidenceLevel, "low");
  assert.strictEqual(result.stalenessWarnings.length, 1);
  assert.match(result.stalenessWarnings[0]!, /Low-Confidence Program/);
  assert.match(result.stalenessWarnings[0]!, /changed/i);
});

test("formatBenefitResult includes staleness warning section when warnings exist", () => {
  const resultWithWarning: McpBenefitResult = {
    ...sample,
    stalenessWarnings: ["Terms for \"Old Program\" may be outdated."],
  };
  const text = formatBenefitResult(resultWithWarning);
  assert.match(text, /Terms freshness notes/i);
  assert.match(text, /Old Program/);
});

test("formatBenefitResult omits staleness section when no warnings", () => {
  const resultClean: McpBenefitResult = {
    ...sample,
    stalenessWarnings: [],
  };
  const text = formatBenefitResult(resultClean);
  assert.doesNotMatch(text, /Terms freshness notes/i);
});

test("buildBenefitResult never includes price fields in staleness warnings", () => {
  const matches = [
    {
      benefit: {
        id: "b1",
        scope: "category" as const,
        match: { categories: ["hotel" as const] },
        value: { kind: "perk" as const, perks: ["Lounge access"] },
        source: "catalog" as const,
        programId: "some_program",
      },
      membershipId: "m1",
      membershipLabel: "Stale Program",
      confidence: {
        level: "stale" as const,
        score: 0.1,
        ageMonths: 30,
        expiresAt: "2023-01-01",
        isExpired: true,
      },
    },
  ];
  const result = buildBenefitResult(matches, {});
  const warning = result.stalenessWarnings[0] ?? "";
  assert.doesNotMatch(warning, /price|amount|nightly|total|member.*rate/i);
});

// --- #311 realization URL ("book direct at <URL>", never a price) ---

test("buildBenefitResult carries the realization URL from the benefit value", () => {
  const matches = [
    {
      benefit: {
        id: "b1",
        scope: "property" as const,
        match: { propertyNames: ["Hotel PECR"] },
        value: {
          kind: "percentDiscount" as const,
          percentOff: 0.15,
          conditions: "direct booking only",
          realizationUrl: "https://hotel-pecr.cz/en/book",
        },
        source: "catalog" as const,
        programId: "pecr",
      },
      membershipId: "m1",
      membershipLabel: "Hotel PECR Club",
    },
  ];
  const result = buildBenefitResult(matches, { hotel: "Hotel PECR", stars: 4 });
  assert.strictEqual(result.matches[0]!.realizationUrl, "https://hotel-pecr.cz/en/book");
});

test("formatBenefitResult shows 'book direct' with the realization URL and no price", () => {
  const r: McpBenefitResult = {
    context: { hotel: "Hotel PECR", stars: 4 },
    matches: [
      {
        membershipId: "m1",
        membershipLabel: "Hotel PECR Club",
        benefitId: "b1",
        discount: { percentOff: 0.15, conditions: "direct booking only" },
        perks: [],
        structuredPerks: [],
        conditions: "direct booking only",
        realizationUrl: "https://hotel-pecr.cz/en/book",
      },
    ],
    perkValueEstimates: [],
    programsApplied: ["pecr"],
    generatedAt: new Date().toISOString(),
    stalenessWarnings: [],
  };
  const text = formatBenefitResult(r);
  assert.match(text, /15% off/);
  assert.match(text, /book direct/i);
  assert.match(text, /hotel-pecr\.cz\/en\/book/);
  assert.match(text, /Prices are not returned/i);
  assert.doesNotMatch(text, /member.*price|indicative|\$\d|€\d/i);
});
