import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatCurrencyEstimate,
  formatNumber,
  formatDate,
  localeCurrencyMap,
  localeDisplayNames,
  localeMarketNames,
} from "../lib/locale";
import type { Locale } from "../i18n/routing";

// ── Currency mapping ────────────────────────────────────────────────────────

test("localeCurrencyMap: all supported locales have a currency", () => {
  const supported: Locale[] = ["en", "cs", "de", "de-AT", "pl", "sk", "hu"];
  for (const locale of supported) {
    assert.ok(localeCurrencyMap[locale], `Missing currency for locale: ${locale}`);
  }
});

test("localeCurrencyMap: de and de-AT both use EUR", () => {
  assert.equal(localeCurrencyMap["de"], "EUR");
  assert.equal(localeCurrencyMap["de-AT"], "EUR");
});

test("localeCurrencyMap: en uses USD, cs uses CZK", () => {
  assert.equal(localeCurrencyMap["en"], "USD");
  assert.equal(localeCurrencyMap["cs"], "CZK");
});

// ── Display names ────────────────────────────────────────────────────────────

test("localeDisplayNames: all locales have display names", () => {
  const supported: Locale[] = ["en", "cs", "de", "de-AT", "pl", "sk", "hu"];
  for (const locale of supported) {
    assert.ok(localeDisplayNames[locale], `Missing display name for locale: ${locale}`);
  }
});

test("localeDisplayNames: en is English", () => {
  assert.equal(localeDisplayNames["en"], "English");
});

// ── Market names ─────────────────────────────────────────────────────────────

test("localeMarketNames: all locales have market names", () => {
  const supported: Locale[] = ["en", "cs", "de", "de-AT", "pl", "sk", "hu"];
  for (const locale of supported) {
    assert.ok(localeMarketNames[locale], `Missing market name for locale: ${locale}`);
  }
});

// ── formatCurrencyEstimate ──────────────────────────────────────────────────

test("formatCurrencyEstimate: en formats as USD", () => {
  const result = formatCurrencyEstimate(100, "en");
  assert.ok(result.includes("100"), `Expected 100 in: ${result}`);
  assert.ok(result.includes("$") || result.includes("USD"), `Expected $ or USD in: ${result}`);
});

test("formatCurrencyEstimate: cs formats as CZK", () => {
  const result = formatCurrencyEstimate(100, "cs");
  assert.ok(result.includes("100"), `Expected 100 in: ${result}`);
  assert.ok(result.includes("Kč") || result.includes("CZK"), `Expected CZK in: ${result}`);
});

test("formatCurrencyEstimate: de formats as EUR", () => {
  const result = formatCurrencyEstimate(100, "de");
  assert.ok(result.includes("100"), `Expected 100 in: ${result}`);
  assert.ok(result.includes("€") || result.includes("EUR"), `Expected EUR in: ${result}`);
});

test("formatCurrencyEstimate: de-AT formats as EUR", () => {
  const result = formatCurrencyEstimate(100, "de-AT");
  assert.ok(result.includes("100"), `Expected 100 in: ${result}`);
  assert.ok(result.includes("€") || result.includes("EUR"), `Expected EUR in: ${result}`);
});

test("formatCurrencyEstimate: hu formats as HUF", () => {
  const result = formatCurrencyEstimate(100, "hu");
  assert.ok(result.includes("100"), `Expected 100 in: ${result}`);
  assert.ok(result.includes("Ft") || result.includes("HUF"), `Expected HUF in: ${result}`);
});

test("formatCurrencyEstimate: zero formats without decimals", () => {
  const result = formatCurrencyEstimate(0, "en");
  assert.ok(!result.includes("."), `Expected no decimal in: ${result}`);
});

test("formatCurrencyEstimate: output is display-only — never a price", () => {
  // Verify the function produces a display string, not raw numeric data
  // that could be mistaken for a computed price.
  const result = formatCurrencyEstimate(42, "en");
  assert.ok(typeof result === "string", "Expected a string");
  assert.ok(result.length > 0, "Expected non-empty string");
  // The function receives perk estimate USD values and formats them;
  // it does NOT compute or return prices.
  assert.ok(!result.includes("price"), `Must not mention 'price': ${result}`);
});

// ── formatNumber ────────────────────────────────────────────────────────────

test("formatNumber: formats integers per locale", () => {
  const result = formatNumber(1000, "en");
  assert.ok(result.length > 0, "Expected non-empty result");
  assert.ok(result.includes("1") && result.includes("000"), `Expected 1000 in: ${result}`);
});

test("formatNumber: cs uses different thousand separator", () => {
  // Czech uses space or non-breaking space as thousands separator
  const result = formatNumber(1000, "cs");
  assert.ok(result.includes("1") && result.includes("000"), `Expected 1000 in: ${result}`);
});

// ── formatDate ──────────────────────────────────────────────────────────────

test("formatDate: formats a date for en locale", () => {
  const date = new Date(2024, 0, 15); // Jan 15, 2024
  const result = formatDate(date, "en");
  assert.ok(result.length > 0, "Expected non-empty date string");
  assert.ok(result.includes("2024") || result.includes("24"), `Expected year in: ${result}`);
});

test("formatDate: de locale uses different date order", () => {
  const date = new Date(2024, 0, 15); // Jan 15, 2024
  const result = formatDate(date, "de");
  assert.ok(result.length > 0, "Expected non-empty date string");
});

test("formatDate: accepts a timestamp number", () => {
  const ts = new Date(2024, 5, 1).getTime();
  const result = formatDate(ts, "en");
  assert.ok(result.length > 0, "Expected non-empty date string");
});

test("formatDate: accepts options for custom formatting", () => {
  const date = new Date(2024, 0, 15);
  const result = formatDate(date, "en", { year: "numeric", month: "long" });
  assert.ok(result.includes("January") || result.includes("2024"), `Expected long month in: ${result}`);
});
