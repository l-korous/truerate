import type { PageContext } from "@truerate/core";
import type { DocLike } from "./doc-like";

export type { DocLike };

// Pure helpers for Hotels.com page-type detection and property-context
// extraction. Kept free of browser globals so they can be unit-tested directly.
// Mirrors the shape of booking-context.ts and hilton-context.ts for consistency.

export type HotelsComPageType = "search" | "detail" | "unknown";

export function detectHotelsComPageType(url: string): HotelsComPageType {
  let pathname: string;
  let hostname: string;
  try {
    const parsed = new URL(url);
    pathname = parsed.pathname;
    hostname = parsed.hostname;
  } catch {
    return "unknown";
  }

  if (hostname !== "hotels.com" && !hostname.endsWith(".hotels.com")) return "unknown";

  // Property detail page: /ho<digits>/... (Hotels.com uses numeric property IDs)
  if (/^\/ho\d+/.test(pathname)) return "detail";

  // Search results: /search or /Hotel-Search (case-insensitive, with optional suffix)
  if (/^\/search(\.do)?(\/|$|\?)/i.test(pathname) || /^\/hotel-search(\/|$|\?)/i.test(pathname)) return "search";

  return "unknown";
}

// Selectors ordered by stability — data-stid (Expedia UiToolKit test IDs) first,
// then data-testid, generic headings last.
const DETAIL_NAME_SELECTORS = [
  '[data-stid="content-hotel-title"]',
  '[data-stid="hotel-name-text"]',
  '[data-testid="property-header-title"]',
  '[data-testid="hotel-headline"]',
  'h1[itemprop="name"]',
  'h1[class*="uitk-heading"]',
  ".uitk-heading-3",
] as const;

export function extractHotelsComHotelName(doc: DocLike): string | undefined {
  for (const selector of DETAIL_NAME_SELECTORS) {
    const text = doc.querySelector(selector)?.textContent?.trim();
    if (text) return text;
  }
  // og:title on Hotels.com is typically "Hotel Name, City, Country | Hotels.com"
  const og = doc.querySelector('meta[property="og:title"]')?.getAttribute("content");
  if (og) {
    const part = og.split(",")[0]?.trim();
    if (part && !part.toLowerCase().startsWith("hotels.com")) return part;
  }
  // Page title is typically "Hotel Name | Hotels.com" — take first segment
  const titlePart = doc.title.split(" | ")[0]?.trim();
  return titlePart || undefined;
}

export function buildHotelsComPageContext(url: string, doc: DocLike): PageContext {
  const domain = "hotels.com";
  if (detectHotelsComPageType(url) !== "detail") return { domain };
  const name = extractHotelsComHotelName(doc);
  return name ? { domain, property: { name } } : { domain };
}

// DOM signals that indicate the user is browsing Hotels.com with an active
// One Key membership session. We only check element presence — no cookies,
// session state, or prices are accessed (per product rule #1).
//
// Hotels.com uses Expedia Group's UiToolKit; `data-stid` is the stable test ID
// convention across Expedia Group properties.
const ONE_KEY_DOM_SIGNALS = [
  '[data-stid="one-key-cashback-summary"]',
  '[data-stid="loyalty-cashback"]',
  '[data-stid="loyalty-member-badge"]',
  '[data-stid="one-key-badge"]',
  '[data-testid="one-key-member-badge"]',
  '[data-testid="one-key-cashback"]',
  '[class*="onekey-badge"]',
  '[class*="one-key-badge"]',
] as const;

/**
 * Returns true when any known One Key DOM signal is present on the page.
 * Uses only element presence checks — never reads session state or cookies.
 */
export function detectOneKeyActive(doc: DocLike): boolean {
  for (const selector of ONE_KEY_DOM_SIGNALS) {
    if (doc.querySelector(selector) !== null) return true;
  }
  return false;
}
