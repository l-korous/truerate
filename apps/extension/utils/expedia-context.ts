import type { PageContext } from "@truerate/core";

// Pure helpers for Expedia page-type detection and property-context extraction.
// Kept free of browser globals so they can be unit-tested directly.

export type ExpediaPageType = "search" | "detail" | "unknown";

export function detectPageType(url: string): ExpediaPageType {
  let pathname: string;
  let hostname: string;
  try {
    const parsed = new URL(url);
    pathname = parsed.pathname;
    hostname = parsed.hostname;
  } catch {
    return "unknown";
  }
  if (hostname !== "expedia.com" && !hostname.endsWith(".expedia.com")) return "unknown";
  // Detail page: ends with .h<digits>.Hotel-Information
  if (/\.h\d+\.Hotel-Information/.test(pathname)) return "detail";
  // Search results pages
  if (pathname.startsWith("/Hotel-Search") || pathname.startsWith("/Hotels")) return "search";
  return "unknown";
}

// Ordered by stability: data-stid / data-testid attributes first, generic selectors last.
const DETAIL_NAME_SELECTORS = [
  "[data-stid=\"content-hotel-title\"]",
  "h1[data-stid=\"content-hotel-title\"]",
  "[data-testid=\"property-name\"]",
  "[data-testid=\"hotel-name\"]",
  "h1.uitk-heading-3",
  ".uitk-heading-3",
] as const;

export interface DocLike {
  querySelector(selector: string): { textContent: string | null; getAttribute(name: string): string | null } | null;
  title: string;
}

export function extractHotelName(doc: DocLike): string | undefined {
  for (const selector of DETAIL_NAME_SELECTORS) {
    const text = doc.querySelector(selector)?.textContent?.trim();
    if (text) return text;
  }
  // og:title on Expedia detail pages is typically "Hotel Name, City | Expedia"
  const og = doc.querySelector('meta[property="og:title"]')?.getAttribute("content");
  if (og) {
    const part = og.split(",")[0]?.trim();
    if (part && !part.toLowerCase().includes("expedia")) return part;
  }
  // document.title is typically "Hotel Name - [City] | Hotels - Expedia"
  const titlePart = doc.title.split(" - ")[0]?.trim();
  return titlePart || undefined;
}

export function buildPageContext(url: string, doc: DocLike): PageContext {
  const domain = "expedia.com";
  if (detectPageType(url) !== "detail") return { domain };
  const name = extractHotelName(doc);
  return name ? { domain, property: { name } } : { domain };
}

// DOM signals that indicate Expedia's One Key member pricing is already active
// for the current user. We read only element presence — no cookies, sessions,
// or prices are accessed (per product rule #1).
const ONE_KEY_DOM_SIGNALS = [
  "[data-stid=\"one-key-banner\"]",
  "[data-testid=\"one-key-banner\"]",
  "[data-testid=\"member-price-badge\"]",
  "[data-stid=\"member-price-badge\"]",
  "[data-testid=\"one-key-logo\"]",
  "[data-stid=\"loyalty-bar\"]",
  ".uitk-loyalty-bar",
] as const;

/**
 * Returns true when any known One Key member-pricing DOM signal is present.
 * Uses only element presence checks — never reads session state or cookies.
 */
export function detectOneKeyActive(doc: DocLike): boolean {
  for (const selector of ONE_KEY_DOM_SIGNALS) {
    if (doc.querySelector(selector) !== null) return true;
  }
  return false;
}
