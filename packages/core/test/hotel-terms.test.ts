import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  domainOf,
  termsForDomain,
  termsHaveNoPrices,
  type HotelTerms,
  type HotelTermsIndex,
} from "../src/hotel-terms.js";

const here = dirname(fileURLToPath(import.meta.url));
const seed = JSON.parse(readFileSync(join(here, "..", "data", "hotel-terms.json"), "utf-8")) as HotelTermsIndex;

const clean: HotelTerms = {
  domain: "x.cz",
  discountPercent: 0.1,
  openToAnyone: true,
  perks: ["free breakfast", "free parking"],
  confidence: "high",
  sourceUrl: "https://x.cz/",
  scrapedAt: "2026-06-09",
};

test("domainOf strips scheme, www, and path", () => {
  assert.equal(domainOf("https://www.pecr.cz/vernostni-program"), "pecr.cz");
  assert.equal(domainOf("http://Hotel-Avion.CZ"), "hotel-avion.cz");
  assert.equal(domainOf("987praguehotel.com"), "987praguehotel.com");
});

test("termsForDomain matches by bare domain or full URL", () => {
  assert.ok(termsForDomain(seed, "pecr.cz"));
  assert.ok(termsForDomain(seed, "https://www.pecr.cz/"));
  assert.equal(termsForDomain(seed, "nope.example"), undefined);
});

test("termsHaveNoPrices: clean terms pass, money fails (rule #1)", () => {
  assert.equal(termsHaveNoPrices(clean), true);
  assert.equal(termsHaveNoPrices({ ...clean, perks: ["breakfast", "rooms from $50"] }), false);
  assert.equal(termsHaveNoPrices({ ...clean, conditions: "min spend 25000 CZK" }), false);
  assert.equal(termsHaveNoPrices({ ...clean, loyaltyProgram: "€20 credit" }), false);
});

test("every seeded hotel's terms carry NO prices (rule #1)", () => {
  const entries = Object.values(seed);
  assert.ok(entries.length > 0, "seed has entries");
  for (const t of entries) {
    assert.equal(termsHaveNoPrices(t), true, `${t.domain} must have no price/rate`);
    // discountPercent is a fraction, not a price
    if (t.discountPercent !== undefined) assert.ok(t.discountPercent > 0 && t.discountPercent < 1, `${t.domain} discount is a fraction`);
  }
});

test("pecr.cz seed has the expected register-and-save terms", () => {
  const p = termsForDomain(seed, "pecr.cz");
  assert.ok(p);
  assert.equal(p!.discountPercent, 0.15);
  assert.equal(p!.openToAnyone, true);
  assert.ok(p!.perks.length > 0);
});
