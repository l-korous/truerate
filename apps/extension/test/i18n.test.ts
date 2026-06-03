import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const localesDir = join(__dirname, "../public/_locales");

function loadLocale(locale: string): Record<string, { message: string }> {
  const raw = readFileSync(join(localesDir, locale, "messages.json"), "utf-8");
  return JSON.parse(raw) as Record<string, { message: string }>;
}

const en = loadLocale("en");
const cs = loadLocale("cs");
const de = loadLocale("de");
const pl = loadLocale("pl");
const sk = loadLocale("sk");
const hu = loadLocale("hu");
const deAT = loadLocale("de_AT");

const enKeys = Object.keys(en);

// Locales that must be key-complete vs en
const FULL_LOCALES = [
  ["cs", cs],
  ["de", de],
  ["pl", pl],
  ["sk", sk],
  ["hu", hu],
] as const;

// Required keys for en locale
const REQUIRED_KEYS = [
  "extName", "extDescription",
  "popupSignInSub", "popupEmailPlaceholder", "popupPasswordPlaceholder",
  "popupSignInButton", "popupSignedInSub", "popupSignOutButton", "popupOptionsLink",
  "panelSignInPrompt", "panelOpenTrueRate", "panelLoading", "panelNoBenefits",
  "panelPerkEstimatesHeader", "panelPerkEstimatesNote",
  "panelActivePrefix", "panelDisclaimer", "panelCloseAriaLabel",
  "panelGeniusActiveNote",
  "optionsTitle", "optionsAccountHeading", "optionsSignedIn", "optionsNotSignedIn",
  "optionsSignOutButton", "optionsSignInLink",
  "optionsPreferencesHeading", "optionsShowPanelLabel",
];

test("en locale has all required keys", () => {
  for (const key of REQUIRED_KEYS) {
    assert.ok(key in en, `en locale missing key: ${key}`);
    assert.ok(en[key].message.length > 0, `en locale empty message for: ${key}`);
  }
});

for (const [locale, messages] of FULL_LOCALES) {
  test(`${locale} locale has all keys present in en locale`, () => {
    for (const key of enKeys) {
      assert.ok(key in messages, `${locale} locale missing key: ${key}`);
      assert.ok(messages[key].message.length > 0, `${locale} locale empty message for: ${key}`);
    }
  });

  test(`${locale} and en locales have the same set of keys`, () => {
    const localeKeys = Object.keys(messages);
    assert.deepEqual(enKeys.sort(), localeKeys.sort(), `${locale} locale key sets must match en`);
  });
}

test("de_AT locale contains only valid override keys (subset of en keys)", () => {
  const deATKeys = Object.keys(deAT);
  for (const key of deATKeys) {
    assert.ok(key in en, `de_AT locale has unknown key not in en: ${key}`);
    assert.ok(deAT[key].message.length > 0, `de_AT locale empty message for: ${key}`);
  }
  // de_AT must not be empty (it must have at least one override)
  assert.ok(deATKeys.length > 0, "de_AT override layer must not be empty");
});

test("de_AT override keys all exist in de (fallback parent)", () => {
  for (const key of Object.keys(deAT)) {
    assert.ok(key in de, `de_AT overrides key '${key}' not found in de parent locale`);
  }
});

test("de_AT override values differ from de (they are genuine overrides)", () => {
  for (const [key, entry] of Object.entries(deAT)) {
    assert.notEqual(
      entry.message,
      de[key].message,
      `de_AT key '${key}' has the same value as de — remove it from de_AT or choose a genuine Austrian override`,
    );
  }
});

test("no locale message contains price-computation strings", () => {
  const pricePatterns = ["finalPrice", "totalSavings", "indicativeOffer", "memberPrice"];
  const allLocales = [
    ["en", en], ["cs", cs], ["de", de], ["pl", pl], ["sk", sk], ["hu", hu], ["de_AT", deAT],
  ] as const;
  for (const [locale, messages] of allLocales) {
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
  const allLocales = [
    ["en", en], ["cs", cs], ["de", de], ["pl", pl], ["sk", sk], ["hu", hu], ["de_AT", deAT],
  ] as const;
  for (const [locale, messages] of allLocales) {
    for (const [key, entry] of Object.entries(messages)) {
      assert.equal(typeof entry.message, "string", `${locale}/${key} message must be a string`);
      assert.ok(entry.message.trim().length > 0, `${locale}/${key} message must not be blank`);
    }
  }
});
