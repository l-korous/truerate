import type { PageContext } from "@truerate/core";
import type { DocLike } from "./doc-like";

export type { DocLike };

// Pure helpers for Marriott.com page-type detection and property-context
// extraction. Kept free of browser globals so they can be unit-tested directly.
// Mirrors the shape of booking-context.ts and hilton-context.ts for consistency.

export type MarriottPageType = "search" | "detail" | "unknown";

export function detectMarriottPageType(url: string): MarriottPageType {
  let pathname: string;
  let hostname: string;
  try {
    const parsed = new URL(url);
    pathname = parsed.pathname;
    hostname = parsed.hostname;
  } catch {
    return "unknown";
  }

  if (hostname !== "marriott.com" && !hostname.endsWith(".marriott.com")) return "unknown";

  // Property detail page: /hotels/travel/<CODE>-<slug>/ or /hotels/hotel-information/<CODE>-<slug>/
  // Marriott uses a hotel code (e.g. LONMD, PRAHH) followed by a slug
  if (/^\/hotels\/(travel|hotel-information|hotel-overview)\/[^/]+\/?/.test(pathname)) return "detail";

  // Search results pages
  if (
    /^\/search\//.test(pathname) ||
    pathname === "/search/default.mi" ||
    /^\/hotels\/hotel-search/.test(pathname) ||
    /^\/hotels\/find-hotels\//.test(pathname)
  ) return "search";

  return "unknown";
}

// Selectors ordered by stability — data-testid / data attributes first, class last.
const DETAIL_NAME_SELECTORS = [
  '[data-testid="hotel-name"]',
  '[data-testid="property-name"]',
  '[data-testid="hotel-details-name"]',
  '[data-component="hotel-name"] h1',
  'h1[class*="t-hotel-name"]',
  'h1[class*="property-name"]',
  "h1.propertyName",
  ".property-name h1",
  "[itemprop='name']",
] as const;

export function extractMarriottHotelName(doc: DocLike): string | undefined {
  for (const selector of DETAIL_NAME_SELECTORS) {
    const text = doc.querySelector(selector)?.textContent?.trim();
    if (text) return text;
  }
  // og:title on Marriott is typically "Hotel Name, City, Country | Marriott"
  const og = doc.querySelector('meta[property="og:title"]')?.getAttribute("content");
  if (og) {
    const part = og.split(",")[0]?.trim();
    if (part && !part.toLowerCase().startsWith("marriott")) return part;
  }
  // Page title is typically "Hotel Name | City | Marriott" — take first segment
  const titlePart = doc.title.split(" | ")[0]?.trim();
  return titlePart || undefined;
}

export function buildMarriottPageContext(url: string, doc: DocLike): PageContext {
  const domain = "marriott.com";
  if (detectMarriottPageType(url) !== "detail") return { domain };
  const name = extractMarriottHotelName(doc);
  return name ? { domain, property: { name } } : { domain };
}

// DOM signals that indicate the user is browsing Marriott.com with an active
// Bonvoy member session. We only check element presence — no cookies, session
// state, or prices are accessed (per product rule #1).
//
// When a Bonvoy member is signed in, Marriott shows a "Member Rate" badge or
// member-only pricing indicator in the UI. Detecting these signals lets us
// surface the "already applied" note so we never imply an unapplied discount.
const BONVOY_DOM_SIGNALS = [
  '[data-testid="bonvoy-member-badge"]',
  '[data-testid="member-rate-badge"]',
  '[data-testid="bonvoy-points-summary"]',
  '[data-testid="user-bonvoy-points"]',
  '[data-testid="bonvoy-tier-badge"]',
  '[data-bonvoy-tier]',
  '[data-component="bonvoy-member-badge"]',
  ".bonvoy-member-badge",
  ".member-rate-badge",
  ".t-member-badge",
] as const;

/**
 * Returns true when any known Bonvoy member DOM signal is present on the page.
 * Uses only element presence checks — never reads session state or cookies.
 */
export function detectBonvoyActive(doc: DocLike): boolean {
  for (const selector of BONVOY_DOM_SIGNALS) {
    if (doc.querySelector(selector) !== null) return true;
  }
  return false;
}
