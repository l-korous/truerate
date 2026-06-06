import { test } from "node:test";
import assert from "node:assert/strict";
import { buildBenefitResult, formatBenefitResult, type McpBenefitResult } from "../src/server.js";
import { matchHotelDirectory, type HotelDirectoryEntry } from "@truerate/core";

// Minimal fixture directory — tests do NOT depend on the full 10k-entry dataset
// so they stay fast and deterministic.
const fixture: HotelDirectoryEntry[] = [
  {
    name: "1. Republic Hotel",
    domain: "firstrepublic.cz",
    realizationUrl: "https://www.firstrepublic.cz/",
    city: "Praha",
    country: "CZ",
    stars: 4,
    kind: "hotel",
  },
  {
    name: "Hotel Grandium Prague",
    domain: "grandium.cz",
    realizationUrl: "https://www.grandium.cz/",
    city: "Praha",
    country: "CZ",
    stars: 4,
    kind: "hotel",
  },
  {
    name: "Alpenhotel Küren",
    domain: "kueren.de",
    realizationUrl: "https://www.kueren.de/",
    city: "Mittelberg",
    country: "AT",
    kind: "hotel",
  },
];

// --- matchHotelDirectory unit tests (pure, no I/O) ---

test("matchHotelDirectory: finds hotel by exact domain", () => {
  const results = matchHotelDirectory(fixture, { domain: "firstrepublic.cz" });
  assert.strictEqual(results.length, 1);
  assert.strictEqual(results[0]!.name, "1. Republic Hotel");
  assert.strictEqual(results[0]!.realizationUrl, "https://www.firstrepublic.cz/");
});

test("matchHotelDirectory: finds hotel by name containment", () => {
  const results = matchHotelDirectory(fixture, { hotel: "Grandium" });
  assert.ok(results.some((r) => r.name === "Hotel Grandium Prague"));
});

test("matchHotelDirectory: country filter excludes non-matching entries", () => {
  const results = matchHotelDirectory(fixture, { hotel: "Hotel", country: "AT" });
  assert.ok(results.every((r) => r.country === "AT"));
  assert.ok(!results.some((r) => r.country === "CZ"));
});

test("matchHotelDirectory: empty query returns []", () => {
  const results = matchHotelDirectory(fixture, {});
  assert.deepStrictEqual(results, []);
});

test("matchHotelDirectory: returns [] for empty directory", () => {
  const results = matchHotelDirectory([], { hotel: "Anything" });
  assert.deepStrictEqual(results, []);
});

// --- buildBenefitResult with directBookingOptions ---

test("buildBenefitResult carries directBookingOptions through", () => {
  const opts: McpBenefitResult["directBookingOptions"] = [
    { name: "1. Republic Hotel", realizationUrl: "https://www.firstrepublic.cz/", city: "Praha", country: "CZ" },
  ];
  const result = buildBenefitResult([], { hotel: "1. Republic Hotel" }, opts);
  assert.strictEqual(result.directBookingOptions.length, 1);
  assert.strictEqual(result.directBookingOptions[0]!.realizationUrl, "https://www.firstrepublic.cz/");
  // Verify no price fields sneaked in
  const raw = JSON.stringify(result);
  assert.ok(!raw.includes("price"), "no price fields allowed");
});

test("buildBenefitResult defaults directBookingOptions to [] when omitted", () => {
  const result = buildBenefitResult([], { brand: "Marriott" });
  assert.deepStrictEqual(result.directBookingOptions, []);
});

// --- formatBenefitResult with directBookingOptions ---

const baseResult: McpBenefitResult = {
  context: { hotel: "1. Republic Hotel", stars: 4 },
  matches: [],
  perkValueEstimates: [],
  programsApplied: [],
  generatedAt: new Date().toISOString(),
  directBookingOptions: [],
  stalenessWarnings: [],
};

test("formatBenefitResult renders 'Book direct:' section with name + URL + location", () => {
  const r: McpBenefitResult = {
    ...baseResult,
    directBookingOptions: [
      { name: "1. Republic Hotel", realizationUrl: "https://www.firstrepublic.cz/", city: "Praha", country: "CZ" },
    ],
  };
  const text = formatBenefitResult(r);
  assert.match(text, /Book direct:/i);
  assert.match(text, /1\. Republic Hotel/);
  assert.match(text, /https:\/\/www\.firstrepublic\.cz\//);
  assert.match(text, /Praha/);
  assert.match(text, /CZ/);
  // Must never include prices (the disclaimer "Prices are not returned" is expected — exclude it)
  assert.doesNotMatch(text, /member.*price|indicative|\$\d|€\d/i);
});

test("formatBenefitResult omits 'Book direct:' section when no directory matches", () => {
  const text = formatBenefitResult({ ...baseResult, directBookingOptions: [] });
  assert.doesNotMatch(text, /Book direct:/i);
});

test("formatBenefitResult renders multiple direct-booking options", () => {
  const r: McpBenefitResult = {
    ...baseResult,
    directBookingOptions: [
      { name: "Hotel Alpha", realizationUrl: "https://alpha.cz/", city: "Praha", country: "CZ" },
      { name: "Hotel Beta", realizationUrl: "https://beta.cz/", country: "CZ" },
    ],
  };
  const text = formatBenefitResult(r);
  assert.match(text, /Hotel Alpha/);
  assert.match(text, /Hotel Beta/);
  assert.match(text, /alpha\.cz/);
  assert.match(text, /beta\.cz/);
});

test("formatBenefitResult omits location parens when city is absent", () => {
  const r: McpBenefitResult = {
    ...baseResult,
    directBookingOptions: [
      { name: "No-City Hotel", realizationUrl: "https://nocity.cz/", country: "CZ" },
    ],
  };
  const text = formatBenefitResult(r);
  assert.match(text, /No-City Hotel \(CZ\) — https:\/\/nocity\.cz\//);
});

test("formatBenefitResult always ends with no-price disclaimer", () => {
  const r: McpBenefitResult = {
    ...baseResult,
    directBookingOptions: [
      { name: "Some Hotel", realizationUrl: "https://some.cz/", city: "Brno", country: "CZ" },
    ],
  };
  const text = formatBenefitResult(r);
  assert.match(text, /Prices are not returned/i);
});
