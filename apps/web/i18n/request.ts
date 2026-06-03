import { getRequestConfig } from "next-intl/server";
import { routing, locales, defaultLocale, type Locale } from "./routing";

function getLocaleChain(locale: Locale): Locale[] {
  if (locale === "de-AT") return ["de-AT", "de", "en"];
  return [locale, "en"];
}

async function loadMessages(locale: Locale): Promise<Record<string, unknown>> {
  const chain = getLocaleChain(locale);
  const base = (await import("../messages/en.json")).default as Record<string, unknown>;
  if (locale === "en") return base;

  const merged: Record<string, unknown> = { ...base };
  for (const l of chain.slice(0, -1).reverse()) {
    try {
      const extra = (await import(`../messages/${l}.json`)) as {
        default: Record<string, unknown>;
      };
      Object.assign(merged, extra.default);
    } catch {
      // locale file might not exist yet — fall back to English
    }
  }
  return merged;
}

export default getRequestConfig(async ({ requestLocale }) => {
  let locale = await requestLocale;
  if (!locale || !(routing.locales as readonly string[]).includes(locale)) {
    locale = defaultLocale;
  }
  const typedLocale = locale as Locale;
  const messages = await loadMessages(typedLocale);

  return { locale: typedLocale, messages };
});

// Re-export for use in other server modules
export { locales, defaultLocale };
