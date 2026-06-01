import { test } from "node:test";
import assert from "node:assert/strict";
import { buildServer, formatResult } from "../src/server.js";
import type { EnrichmentResult } from "@truerate/core";

test("buildServer registers the hotel and membership tools", () => {
  const server = buildServer("user-1");
  const tools = (server as any)._registeredTools ?? (server as any).tools ?? {};
  const names = Object.keys(tools);
  assert.ok(names.includes("search_hotels"), `tools: ${names.join(",")}`);
  assert.ok(names.includes("get_membership_summary"));
});

const sample: EnrichmentResult = {
  query: { location: "Vienna", checkIn: "2026-07-10", checkOut: "2026-07-12", adults: 2, rooms: 1 },
  currency: "EUR",
  mode: "mock",
  generatedAt: new Date().toISOString(),
  programsApplied: ["booking_genius"],
  properties: [
    {
      propertyId: "p1",
      name: "Sheraton Grand",
      brand: "Marriott",
      area: "City Center",
      publicOffer: { source: "public", label: "Public rate", nightlyAmount: 100, totalAmount: 200, currency: "EUR" },
      matches: [
        {
          benefit: {
            id: "b1",
            scope: "category",
            match: { categories: ["hotel"] },
            value: { kind: "percentDiscount", percentOff: 0.2 },
            source: "catalog",
            programId: "booking_genius",
          },
          membershipId: "m1",
          membershipLabel: "Booking.com Genius - Level 3",
        },
      ],
      perks: ["Free breakfast"],
    },
  ],
};

test("formatResult surfaces discounts, brand and perks (no member price)", () => {
  const text = formatResult(sample);
  assert.match(text, /Sheraton Grand \[Marriott\]/);
  assert.match(text, /20% off via Booking\.com Genius - Level 3/);
  assert.match(text, /perks: Free breakfast/);
  assert.doesNotMatch(text, /member.*price|indicative|savings/i);
});

test("formatResult handles an empty result", () => {
  assert.match(formatResult({ ...sample, properties: [] }), /No properties found/);
});
