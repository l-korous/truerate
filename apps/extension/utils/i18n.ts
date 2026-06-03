// Thin wrapper around the MV3 i18n API.
// Returns the message key as fallback when running outside an extension context
// (e.g. unit tests). Never computes or returns prices.
//
// Locale resolution: the browser resolves the user's preferred language against
// the available _locales/* directories at load time (Chrome: BCP-47 sub-tag
// matching, e.g. de-AT → de_AT → de → en). wxt.config.ts declares "en" as
// default_locale, so English is the ultimate fallback. No custom selection
// code is needed here.

// WXT generates strict overloads for getMessage; use the union from the last
// overload to satisfy the type checker while keeping the generic t(key) API.
type MessageKey = Parameters<(typeof browser.i18n)["getMessage"]>[0];

export function t(key: MessageKey): string {
  if (typeof browser !== "undefined" && browser.i18n?.getMessage) {
    return browser.i18n.getMessage(key) || (key as string);
  }
  return key as string;
}
