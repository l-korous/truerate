import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { matchHotelDirectory, type HotelDirectoryEntry } from "../src/hotel-directory.js";

const sample: HotelDirectoryEntry[] = [
  { name: "1. Republic Hotel", domain: "firstrepublic.cz", realizationUrl: "https://www.firstrepublic.cz/", city: "Praha", country: "CZ", stars: 4, kind: "hotel" },
  { name: "Hotel Pecr", domain: "hotel-pecr.cz", realizationUrl: "https://hotel-pecr.cz/", city: "Pec pod Snezkou", country: "CZ", kind: "hotel" },
  { name: "Berlin Marriott", domain: "marriott.com", realizationUrl: "https://www.marriott.com/", city: "Berlin", country: "DE", stars: 5, kind: "hotel" },
];

test("matchHotelDirectory: name match returns the entry + its realization URL (no price)", () => {
  const r = matchHotelDirectory(sample, { hotel: "Hotel Pecr" });
  assert.equal(r[0]?.domain, "hotel-pecr.cz");
  assert.ok(r[0]?.realizationUrl.startsWith("https://"));
  assert.equal((r[0] as Record<string, unknown>).price, undefined);
});

test("matchHotelDirectory: domain match", () => {
  const r = matchHotelDirectory(sample, { domain: "firstrepublic.cz" });
  assert.equal(r[0]?.name, "1. Republic Hotel");
});

test("matchHotelDirectory: country is a hard filter", () => {
  assert.equal(matchHotelDirectory(sample, { hotel: "Marriott", country: "CZ" }).length, 0);
  assert.equal(matchHotelDirectory(sample, { hotel: "Marriott", country: "DE" }).length, 1);
});

test("matchHotelDirectory: empty query returns nothing", () => {
  assert.deepEqual(matchHotelDirectory(sample, {}), []);
});

// Smoke-test the committed real dataset (validates the scrape output shape).
test("committed hotel-directory.json is large, CZ-heavy, and price-free", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const data = JSON.parse(
    readFileSync(join(here, "..", "data", "hotel-directory.json"), "utf8"),
  ) as HotelDirectoryEntry[];
  assert.ok(data.length > 1000, `expected >1000 entries, got ${data.length}`);
  assert.ok(data.filter((e) => e.country === "CZ").length > 1000, "should be CZ-heavy");
  for (const e of data.slice(0, 300)) {
    assert.ok(e.name && e.domain && e.realizationUrl.startsWith("http"), "well-formed entry");
    assert.equal((e as Record<string, unknown>).price, undefined);
    assert.equal((e as Record<string, unknown>).amount, undefined);
  }
  assert.ok(
    matchHotelDirectory(data, { hotel: "Republic Hotel", city: "Praha", country: "CZ" }).length > 0,
    "resolves a real Czech hotel to its direct-booking URL",
  );
});
