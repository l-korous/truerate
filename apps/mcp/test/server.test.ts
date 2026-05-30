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
  totalSavings: 40,
  programsApplied: ["booking_genius"],
  properties: [
    {
      propertyId: "p1",
      name: "Sheraton Grand",
      brand: "Marriott",
      area: "City Center",
      publicOffer: { source: "public", label: "Public rate", nightlyAmount: 100, totalAmount: 200, currency: "EUR" },
      memberOffers: [],
      bestOffer: { source: "booking_genius", label: "Booking.com Genius - Level 3", nightlyAmount: 80, totalAmount: 160, currency: "EUR", perks: [], indicative: true },
      perks: ["Free breakfast"],
      savingsAmount: 40,
      savingsPercent: 20,
      indicative: true,
    },
  ],
};

test("formatResult surfaces indicative savings, brand and perks", () => {
  const text = formatResult(sample);
  assert.match(text, /Indicative member savings up to 40 EUR/);
  assert.match(text, /Sheraton Grand \[Marriott\]/);
  assert.match(text, /member \(est\.\): 160 EUR/);
  assert.match(text, /perks: Free breakfast/);
});

test("formatResult handles an empty result", () => {
  assert.match(formatResult({ ...sample, properties: [], totalSavings: 0 }), /No properties found/);
});
