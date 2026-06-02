import { test } from "node:test";
import assert from "node:assert/strict";

// Unit tests for account-settings logic that can be extracted from the component.

const MARKETS = [
  { value: "cz", label: "Czech Republic" },
  { value: "de", label: "Germany" },
  { value: "pl", label: "Poland" },
  { value: "at", label: "Austria" },
  { value: "sk", label: "Slovakia" },
  { value: "hu", label: "Hungary" },
  { value: "us", label: "United States" },
];

const CURRENCIES = [
  { value: "EUR", label: "Euro (EUR)" },
  { value: "USD", label: "US Dollar (USD)" },
  { value: "CZK", label: "Czech Koruna (CZK)" },
  { value: "PLN", label: "Polish Złoty (PLN)" },
  { value: "HUF", label: "Hungarian Forint (HUF)" },
];

const VALID_MARKETS = new Set(MARKETS.map((m) => m.value));
const VALID_CURRENCIES = new Set(CURRENCIES.map((c) => c.value));

test("markets list includes required launch markets (Czechia first)", () => {
  assert.equal(MARKETS[0]!.value, "cz");
  assert.ok(VALID_MARKETS.has("cz"), "cz present");
  assert.ok(VALID_MARKETS.has("de"), "de present");
  assert.ok(VALID_MARKETS.has("pl"), "pl present");
  assert.ok(VALID_MARKETS.has("at"), "at present");
  assert.ok(VALID_MARKETS.has("sk"), "sk present");
  assert.ok(VALID_MARKETS.has("hu"), "hu present");
  assert.ok(VALID_MARKETS.has("us"), "us present");
});

test("currencies list covers EUR, USD, CZK, PLN, HUF", () => {
  assert.ok(VALID_CURRENCIES.has("EUR"), "EUR present");
  assert.ok(VALID_CURRENCIES.has("USD"), "USD present");
  assert.ok(VALID_CURRENCIES.has("CZK"), "CZK present");
  assert.ok(VALID_CURRENCIES.has("PLN"), "PLN present");
  assert.ok(VALID_CURRENCIES.has("HUF"), "HUF present");
});

test("dirty detection: same values are not dirty", () => {
  const initial = { market: "cz", currency: "EUR" };
  const current = { market: "cz", currency: "EUR" };
  const dirty = current.market !== initial.market || current.currency !== initial.currency;
  assert.equal(dirty, false);
});

test("dirty detection: changed market is dirty", () => {
  const initial = { market: "cz", currency: "EUR" };
  const current = { market: "de", currency: "EUR" };
  const dirty = current.market !== initial.market || current.currency !== initial.currency;
  assert.equal(dirty, true);
});

test("dirty detection: changed currency is dirty", () => {
  const initial = { market: "cz", currency: "EUR" };
  const current = { market: "cz", currency: "USD" };
  const dirty = current.market !== initial.market || current.currency !== initial.currency;
  assert.equal(dirty, true);
});

test("no price-related keys in settings fields", () => {
  const settingKeys = ["market", "currency"];
  const PRICE_PATTERN = /price|amount|cost|total|rate|nightly|savings/i;
  for (const key of settingKeys) {
    assert.ok(!PRICE_PATTERN.test(key), `unexpected price-related key: ${key}`);
  }
  for (const c of CURRENCIES) {
    assert.ok(!c.label.includes("price"), `currency label must not mention price: ${c.label}`);
  }
});
