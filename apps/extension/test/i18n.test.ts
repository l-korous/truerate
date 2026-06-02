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

const enKeys = Object.keys(en);

test("en locale has all required keys", () => {
  const required = [
    "extName", "extDescription",
    "popupSignInSub", "popupEmailPlaceholder", "popupPasswordPlaceholder",
    "popupSignInButton", "popupSignedInSub", "popupSignOutButton", "popupOptionsLink",
    "panelSignInPrompt", "panelOpenTrueRate", "panelLoading", "panelNoBenefits",
    "panelPerkEstimatesHeader", "panelPerkEstimatesNote",
    "panelActivePrefix", "panelDisclaimer", "panelCloseAriaLabel",
    "optionsTitle", "optionsAccountHeading", "optionsSignedIn", "optionsNotSignedIn",
    "optionsSignOutButton", "optionsSignInLink",
    "optionsPreferencesHeading", "optionsShowPanelLabel",
  ];
  for (const key of required) {
    assert.ok(key in en, `en locale missing key: ${key}`);
    assert.ok(en[key].message.length > 0, `en locale empty message for: ${key}`);
  }
});

test("cs locale has all keys present in en locale", () => {
  for (const key of enKeys) {
    assert.ok(key in cs, `cs locale missing key: ${key}`);
    assert.ok(cs[key].message.length > 0, `cs locale empty message for: ${key}`);
  }
});

test("en and cs locales have the same set of keys", () => {
  const csKeys = Object.keys(cs);
  assert.deepEqual(enKeys.sort(), csKeys.sort(), "locale key sets must match");
});

test("no locale message contains price-computation strings", () => {
  const pricePatterns = ["finalPrice", "totalSavings", "indicativeOffer", "memberPrice"];
  for (const [locale, messages] of [["en", en], ["cs", cs]] as const) {
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
  for (const [locale, messages] of [["en", en], ["cs", cs]] as const) {
    for (const [key, entry] of Object.entries(messages)) {
      assert.equal(typeof entry.message, "string", `${locale}/${key} message must be a string`);
      assert.ok(entry.message.trim().length > 0, `${locale}/${key} message must not be blank`);
    }
  }
});
