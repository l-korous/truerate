import { test } from "node:test";
import assert from "node:assert/strict";

// The t() utility calls browser.i18n.getMessage when available and falls back
// to the key name in non-extension contexts (e.g. unit tests).
// We test the fallback path here: in Node.js `browser` is undefined, so t()
// returns the key string itself.

test("t() falls back to the key when browser is not defined", async () => {
  const { t } = await import("../utils/i18n.js");
  const result = t("panelLoading");
  assert.equal(result, "panelLoading");
});

test("t() falls back to key for every locale key", async () => {
  const { t } = await import("../utils/i18n.js");
  assert.equal(t("optionsTitle"), "optionsTitle");
  assert.equal(t("popupSignInButton"), "popupSignInButton");
  assert.equal(t("panelDisclaimer"), "panelDisclaimer");
});

test("t() return value is always a non-empty string in fallback mode", async () => {
  const { t } = await import("../utils/i18n.js");
  const keys = [
    "extName", "panelSignInPrompt", "optionsAccountHeading",
    "optionsShowPanelLabel", "panelCloseAriaLabel",
  ] as const;
  for (const key of keys) {
    const result = t(key);
    assert.equal(typeof result, "string");
    assert.ok(result.length > 0, `t("${key}") must not return empty string`);
  }
});
