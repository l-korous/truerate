import { defineRouting } from "next-intl/routing";

export const locales = ["en", "cs", "de", "de-AT", "pl", "sk", "hu"] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "en";

export const routing = defineRouting({
  locales,
  defaultLocale,
  localePrefix: "always",
});
