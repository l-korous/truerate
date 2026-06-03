import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const localesDir = join(__dirname, "../public/_locales");

// Locale resolution: the MV3 browser i18n API follows the user's browser language
// setting automatically. _locales/en is the default_locale (wxt.config.ts) and is
// used as fallback when no better match exists. The Chrome engine resolves
// sub-tags (e.g. de-AT → de_AT directory, then de, then en).
// No custom locale-selection code is required; the t() wrapper in utils/i18n.ts
// simply calls browser.i18n.getMessage which performs this resolution.

function loadLocale(locale: string): Record<string, { message: string }> {
  const raw = readFileSync(join(localesDir, locale, "messages.json"), "utf-8");
  return JSON.parse(raw) as Record<string, { message: string }>;
}

const LOCALES: string[] = readdirSync(localesDir).filter((d) => {
  try {
    readFileSync(join(localesDir, d, "messages.json"), "utf-8");
    return true;
  } catch {
    return false;
  }
});

const en = loadLocale("en");
const enKeys = Object.keys(en);

test("all launch locales are present", () => {
  const required = ["en", "cs", "de", "pl", "sk", "hu", "de_AT"];
  for (const locale of required) {
    assert.ok(
      LOCALES.includes(locale),
      `_locales/${locale}/messages.json is missing`,
    );
  }
});

test("en locale has all required keys", () => {
  const required = [
    "extName", "extDescription",
    "popupSignInSub", "popupEmailPlaceholder", "popupPasswordPlaceholder",
    "popupSignInButton", "popupSignedInSub", "popupSignOutButton", "popupOptionsLink",
    "panelSignInPrompt", "panelOpenTrueRate", "panelLoading", "panelNoBenefits",
    "panelPerkEstimatesHeader", "panelPerkEstimatesNote",
    "panelActivePrefix", "panelDisclaimer", "panelCloseAriaLabel",
    "panelGeniusActiveNote", "panelTermsStaleNote", "panelTermsLowConfidenceNote",
    "panelErrorGeneric",
    "optionsTitle", "optionsAccountHeading", "optionsSignedIn", "optionsNotSignedIn",
    "optionsSignOutButton", "optionsSignInLink",
    "optionsPreferencesHeading", "optionsShowPanelLabel",
  ];
  for (const key of required) {
    assert.ok(key in en, `en locale missing key: ${key}`);
    assert.ok(en[key].message.length > 0, `en locale empty message for: ${key}`);
  }
});

test("every non-en locale has all keys present in en locale", () => {
  for (const locale of LOCALES) {
    if (locale === "en") continue;
    const messages = loadLocale(locale);
    for (const key of enKeys) {
      assert.ok(key in messages, `${locale} locale missing key: ${key}`);
      assert.ok(
        messages[key].message.length > 0,
        `${locale} locale empty message for: ${key}`,
      );
    }
  }
});

test("every locale has exactly the same set of keys as en", () => {
  for (const locale of LOCALES) {
    if (locale === "en") continue;
    const messages = loadLocale(locale);
    const localeKeys = Object.keys(messages);
    assert.deepEqual(
      enKeys.sort(),
      localeKeys.sort(),
      `${locale} locale key set must match en`,
    );
  }
});

test("no locale message contains price-computation strings", () => {
  const pricePatterns = ["finalPrice", "totalSavings", "indicativeOffer", "memberPrice"];
  for (const locale of LOCALES) {
    const messages = loadLocale(locale);
    for (const [key, entry] of Object.entries(messages)) {
      for (const pattern of pricePatterns) {
        assert.ok(
          !entry.message.includes(pattern),
          `${locale}/${key} must not contain price string: ${pattern}`,
        );
      }
    }
  }
});

test("locale message values are non-empty strings", () => {
  for (const locale of LOCALES) {
    const messages = loadLocale(locale);
    for (const [key, entry] of Object.entries(messages)) {
      assert.equal(typeof entry.message, "string", `${locale}/${key} message must be a string`);
      assert.ok(entry.message.trim().length > 0, `${locale}/${key} message must not be blank`);
    }
  }
});
