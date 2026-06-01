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
