import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldShowOnboarding, shouldShowResumeBanner, type OnboardingState } from "../lib/onboarding";
import { tLocale } from "../lib/i18n";

// ── shouldShowOnboarding ─────────────────────────────────────────────────────

test("shouldShowOnboarding: new signup with pending state → show wizard", () => {
  assert.ok(shouldShowOnboarding(0, "pending", true));
});

test("shouldShowOnboarding: new signup with no memberships → show wizard", () => {
  assert.ok(shouldShowOnboarding(0, "pending", true));
});

test("shouldShowOnboarding: done state → never show wizard", () => {
  assert.ok(!shouldShowOnboarding(0, "done", true));
  assert.ok(!shouldShowOnboarding(0, "done", false));
  assert.ok(!shouldShowOnboarding(5, "done", false));
});

test("shouldShowOnboarding: skipped state → not show wizard (show banner instead)", () => {
  assert.ok(!shouldShowOnboarding(0, "skipped", false));
  assert.ok(!shouldShowOnboarding(0, "skipped", true));
});

test("shouldShowOnboarding: in-progress state → show wizard", () => {
  assert.ok(shouldShowOnboarding(0, "in-progress", false));
  assert.ok(shouldShowOnboarding(3, "in-progress", false));
});

test("shouldShowOnboarding: returning user with memberships, pending → no wizard", () => {
  assert.ok(!shouldShowOnboarding(2, "pending", false));
});

test("shouldShowOnboarding: returning user, no memberships, pending → show wizard", () => {
  assert.ok(shouldShowOnboarding(0, "pending", false));
});

// ── shouldShowResumeBanner ───────────────────────────────────────────────────

test("shouldShowResumeBanner: skipped → show banner", () => {
  assert.ok(shouldShowResumeBanner("skipped"));
});

test("shouldShowResumeBanner: in-progress → no banner (wizard shown instead)", () => {
  assert.ok(!shouldShowResumeBanner("in-progress"));
});

test("shouldShowResumeBanner: done → no banner", () => {
  assert.ok(!shouldShowResumeBanner("done"));
});

test("shouldShowResumeBanner: pending → no banner", () => {
  assert.ok(!shouldShowResumeBanner("pending"));
});

// ── state transitions ────────────────────────────────────────────────────────

test("onboarding state transitions are logically consistent", () => {
  // pending → in-progress: wizard opened
  // in-progress → skipped: user clicked skip
  // in-progress → done: user completed wizard
  // skipped → in-progress: user clicked resume (state set back)
  // skipped → done: user dismissed banner

  const states: OnboardingState[] = ["pending", "in-progress", "skipped", "done"];
  for (const s of states) {
    // shouldShowOnboarding and shouldShowResumeBanner never both return true
    const show = shouldShowOnboarding(0, s, false);
    const banner = shouldShowResumeBanner(s);
    assert.ok(
      !(show && banner),
      `state "${s}": wizard and banner cannot both be true`,
    );
  }
});

// ── i18n: tLocale ────────────────────────────────────────────────────────────

test("tLocale: English onboarding_title is non-empty", () => {
  const result = tLocale("en", "onboarding_title");
  assert.ok(result.length > 0);
  assert.ok(result !== "onboarding_title");
});

test("tLocale: Czech onboarding_title is non-empty and different from English", () => {
  const en = tLocale("en", "onboarding_title");
  const cs = tLocale("cs", "onboarding_title");
  assert.ok(cs.length > 0);
  assert.notEqual(en, cs);
});

test("tLocale: interpolates {current} and {total} in progress string", () => {
  const result = tLocale("en", "onboarding_progress", { current: 1, total: 2 });
  assert.ok(result.includes("1"), `expected "1" in "${result}"`);
  assert.ok(result.includes("2"), `expected "2" in "${result}"`);
  assert.ok(!result.includes("{current}"), "placeholder should be replaced");
  assert.ok(!result.includes("{total}"), "placeholder should be replaced");
});

test("tLocale: interpolates {query} in empty search message", () => {
  const result = tLocale("en", "onboarding_empty_search", { query: "foo" });
  assert.ok(result.includes("foo"), `expected "foo" in "${result}"`);
  assert.ok(!result.includes("{query}"), "placeholder should be replaced");
});

test("tLocale: falls back to English for unknown locale", () => {
  const en = tLocale("en", "onboarding_title");
  const unknown = tLocale("xx", "onboarding_title");
  assert.equal(unknown, en);
});

test("tLocale: all supported locales have onboarding_title key", () => {
  const locales = ["en", "cs", "de", "pl", "sk", "hu", "de-AT"];
  for (const locale of locales) {
    const result = tLocale(locale, "onboarding_title");
    assert.ok(result.length > 0, `locale ${locale} missing onboarding_title`);
    assert.notEqual(result, "onboarding_title", `locale ${locale} returned key as value`);
  }
});

test("tLocale: no price references in onboarding messages", () => {
  const locales = ["en", "cs", "de", "pl", "sk", "hu", "de-AT"];
  const priceKeys = ["onboarding_title", "onboarding_subtitle", "onboarding_finish_body"];
  for (const locale of locales) {
    for (const key of priceKeys) {
      const result = tLocale(locale, key as Parameters<typeof tLocale>[1]);
      assert.ok(
        !result.match(/\$\d|\bprice\b|\bprices\b|\bPreis\b/i),
        `locale ${locale} key ${key} must not contain price references: "${result}"`,
      );
    }
  }
});
