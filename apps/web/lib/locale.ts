import type { Locale } from "@/i18n/routing";

export type { Locale };

export const localeCurrencyMap: Record<Locale, string> = {
  en: "USD",
  cs: "CZK",
  de: "EUR",
  "de-AT": "EUR",
  pl: "PLN",
  sk: "EUR",
  hu: "HUF",
};

export const localeDisplayNames: Record<Locale, string> = {
  en: "English",
  cs: "Čeština",
  de: "Deutsch",
  "de-AT": "Deutsch (Österreich)",
  pl: "Polski",
  sk: "Slovenčina",
  hu: "Magyar",
};

export const localeMarketNames: Record<Locale, string> = {
  en: "International",
  cs: "Czechia",
  de: "Germany",
  "de-AT": "Austria",
  pl: "Poland",
  sk: "Slovakia",
  hu: "Hungary",
};

/**
 * Format a numeric estimate as a locale-appropriate currency display.
 * This is display-only; TrueRate never computes or stores prices.
 */
export function formatCurrencyEstimate(amount: number, locale: Locale): string {
  const currency = localeCurrencyMap[locale];
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

/**
 * Format a number per the active locale (thousands separators, decimal
 * notation, etc.).
 */
export function formatNumber(value: number, locale: Locale): string {
  return new Intl.NumberFormat(locale).format(value);
}

/**
 * Format a date per the active locale.
 */
export function formatDate(
  date: Date | number,
  locale: Locale,
  options?: Intl.DateTimeFormatOptions,
): string {
  return new Intl.DateTimeFormat(locale, options).format(date);
}
