import type { PageContext } from "@truerate/core";
import type { DocLike } from "./doc-like";

export type { DocLike };

// Pure helpers for Expedia page-type detection and property-context
// extraction. Kept free of browser globals so they can be unit-tested directly.
// Mirrors the shape of hotelscom-context.ts (both are Expedia Group properties).

export type ExpediaPageType = "search" | "detail" | "unknown";

export function detectExpediaPageType(url: string): ExpediaPageType {
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

  // Property detail page: /<slug>.h<digits>.Hotel-Information (classic Expedia URL)
  if (/\.h\d+\.hotel-information/i.test(pathname)) return "detail";

  // Search results: /Hotel-Search or /Hotels (with optional suffix)
  if (/^\/hotel-search(\/|$|\?)/i.test(pathname) || /^\/hotels(\/|$|\?)/i.test(pathname)) return "search";

  return "unknown";
}

// Selectors ordered by stability — data-stid (Expedia UiToolKit test IDs) first,
// then data-testid, generic headings last. Expedia shares the UiToolKit with
// Hotels.com so the same stable stid attributes apply.
const DETAIL_NAME_SELECTORS = [
  '[data-stid="content-hotel-title"]',
  '[data-stid="hotel-name-text"]',
  '[data-testid="property-header-title"]',
  '[data-testid="hotel-headline"]',
  'h1[itemprop="name"]',
  'h1[class*="uitk-heading"]',
  ".uitk-heading-3",
] as const;

export function extractExpediaHotelName(doc: DocLike): string | undefined {
  for (const selector of DETAIL_NAME_SELECTORS) {
    const text = doc.querySelector(selector)?.textContent?.trim();
    if (text) return text;
  }
  // og:title on Expedia is typically "Hotel Name, City, State | Expedia"
  const og = doc.querySelector('meta[property="og:title"]')?.getAttribute("content");
  if (og) {
    const part = og.split(",")[0]?.trim();
    if (part && !part.toLowerCase().startsWith("expedia")) return part;
  }
  // Page title is typically "Hotel Name | Expedia" — take first segment
  const titlePart = doc.title.split(" | ")[0]?.trim();
  return titlePart || undefined;
}

export function buildExpediaPageContext(url: string, doc: DocLike): PageContext {
  const domain = "expedia.com";
  if (detectExpediaPageType(url) !== "detail") return { domain };
  const name = extractExpediaHotelName(doc);
  return name ? { domain, property: { name } } : { domain };
}

// DOM signals that indicate the user is browsing Expedia with an active One Key
// membership session. Expedia and Hotels.com share the Expedia Group UiToolKit
// and the One Key loyalty programme, so the same stid/testid signals apply.
// We only check element presence — no cookies, session state, or prices are
// accessed (per product rule #1).
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
 * Returns true when any known One Key DOM signal is present on the Expedia page.
 * Uses only element presence checks — never reads session state or cookies.
 */
export function detectOneKeyExpediaActive(doc: DocLike): boolean {
  for (const selector of ONE_KEY_DOM_SIGNALS) {
    if (doc.querySelector(selector) !== null) return true;
  }
  return false;
}
