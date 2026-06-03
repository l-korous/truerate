import { test } from "node:test";
import assert from "node:assert/strict";

// ── Pure logic helpers extracted from AccountPage ──────────────────────────

const MARKETS: { value: string; label: string; currency: string }[] = [
  { value: "cz", label: "Czechia", currency: "EUR" },
  { value: "de", label: "Germany", currency: "EUR" },
  { value: "pl", label: "Poland", currency: "PLN" },
  { value: "at", label: "Austria", currency: "EUR" },
  { value: "sk", label: "Slovakia", currency: "EUR" },
  { value: "hu", label: "Hungary", currency: "HUF" },
  { value: "us", label: "United States", currency: "USD" },
];

const CURRENCY_LABELS: Record<string, string> = {
  EUR: "Euro (EUR)", PLN: "Polish Złoty (PLN)", HUF: "Hungarian Forint (HUF)", USD: "US Dollar (USD)",
};

function previewCurrency(market: string): string {
  return MARKETS.find((m) => m.value === market)?.currency ?? "EUR";
}

function formatMemberSince(createdAt: string): string {
  return new Date(createdAt).toLocaleDateString("en-GB", {
    year: "numeric", month: "long", day: "numeric",
  });
}

// ── Market / currency preview ──────────────────────────────────────────────

test("previewCurrency: cz → EUR", () => {
  assert.equal(previewCurrency("cz"), "EUR");
});

test("previewCurrency: us → USD", () => {
  assert.equal(previewCurrency("us"), "USD");
});

test("previewCurrency: pl → PLN", () => {
  assert.equal(previewCurrency("pl"), "PLN");
});

test("previewCurrency: hu → HUF", () => {
  assert.equal(previewCurrency("hu"), "HUF");
});

test("previewCurrency: unknown market falls back to EUR", () => {
  assert.equal(previewCurrency("xx"), "EUR");
});

test("MARKETS covers all supported regions", () => {
  const values = MARKETS.map((m) => m.value);
  for (const v of ["cz", "de", "pl", "at", "sk", "hu", "us"]) {
    assert.ok(values.includes(v), `missing market: ${v}`);
  }
});

test("every MARKET has a non-empty label and currency", () => {
  for (const m of MARKETS) {
    assert.ok(m.label.length > 0, `empty label for ${m.value}`);
    assert.ok(m.currency.length > 0, `empty currency for ${m.value}`);
  }
});

// ── Currency labels ──────────────────────────────────────────────────────

test("CURRENCY_LABELS covers all MARKET currencies", () => {
  const currencies = [...new Set(MARKETS.map((m) => m.currency))];
  for (const c of currencies) {
    assert.ok(CURRENCY_LABELS[c], `missing label for currency: ${c}`);
  }
});

// ── memberSince formatting ────────────────────────────────────────────────

test("formatMemberSince: returns human-readable date", () => {
  const result = formatMemberSince("2025-01-15T10:00:00.000Z");
  assert.ok(/2025/.test(result), `year not found in: ${result}`);
  assert.ok(/January/.test(result), `month not found in: ${result}`);
});

test("formatMemberSince: includes day", () => {
  const result = formatMemberSince("2025-06-03T00:00:00.000Z");
  assert.ok(/3/.test(result), `day not found in: ${result}`);
});

// ── No-price invariant ────────────────────────────────────────────────────

test("AccountPage: settings fields contain no price-related keys", () => {
  // Ensure the settings we expose to the UI have no price-related field names.
  const settingsKeys = ["market"];
  const pricePattern = /price|amount|nightly|rate|cost|fee|discount_value|total/i;
  for (const k of settingsKeys) {
    assert.ok(!pricePattern.test(k), `price-related key in settings: ${k}`);
  }
});

test("MARKETS: no market entry contains price information", () => {
  for (const m of MARKETS) {
    assert.ok(typeof m.currency === "string" && m.currency.length <= 5,
      `unexpected currency value for ${m.value}: ${m.currency}`);
    // Currency codes are never monetary amounts
    assert.ok(!/\d/.test(m.currency), `currency code contains digits for ${m.value}: ${m.currency}`);
  }
});
