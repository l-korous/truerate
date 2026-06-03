import type { PageContext } from "@truerate/core";
import type { DocLike } from "./doc-like";

export type { DocLike };

// Pure helpers for Hilton.com page-type detection and property-context
// extraction. Kept free of browser globals so they can be unit-tested directly.
// Mirrors the shape of booking-context.ts for consistency.

export type HiltonPageType = "search" | "detail" | "unknown";

export function detectHiltonPageType(url: string): HiltonPageType {
  let pathname: string;
  let hostname: string;
  try {
    const parsed = new URL(url);
    pathname = parsed.pathname;
    hostname = parsed.hostname;
  } catch {
    return "unknown";
  }

  if (hostname !== "hilton.com" && !hostname.endsWith(".hilton.com")) return "unknown";

  // Property detail page: /en/hotels/<property-slug>/ — slug is non-empty
  if (/^\/en\/hotels\/[^/]+\/?$/.test(pathname)) return "detail";

  // Search results: /en/hotels/ (with or without trailing slash)
  if (/^\/en\/hotels\/?$/.test(pathname)) return "search";

  return "unknown";
}

// Selectors ordered by stability — data-testid first, generic last.
const DETAIL_NAME_SELECTORS = [
  '[data-testid="hotel-name"]',
  '[data-testid="hotel-details-title"]',
  'h1[class*="headline"]',
  ".hotel-headline",
  "h1.ctyhocn-name",
  "[itemprop='name']",
] as const;

export function extractHiltonHotelName(doc: DocLike): string | undefined {
  for (const selector of DETAIL_NAME_SELECTORS) {
    const text = doc.querySelector(selector)?.textContent?.trim();
    if (text) return text;
  }
  // og:title on Hilton is typically "Hotel Name, City, Country | Hilton"
  const og = doc.querySelector('meta[property="og:title"]')?.getAttribute("content");
  if (og) {
    const part = og.split(",")[0]?.trim();
    if (part && !part.toLowerCase().startsWith("hilton.com")) return part;
  }
  // Page title is typically "Hotel Name | Official Site | Hilton" — take first segment
  const titlePart = doc.title.split(" | ")[0]?.trim();
  return titlePart || undefined;
}

export function buildHiltonPageContext(url: string, doc: DocLike): PageContext {
  const domain = "hilton.com";
  if (detectHiltonPageType(url) !== "detail") return { domain };
  const name = extractHiltonHotelName(doc);
  return name ? { domain, property: { name } } : { domain };
}

// DOM signals that indicate the user is browsing Hilton.com with an active
// Hilton Honors session. We only check element presence — no cookies, session
// state, or prices are accessed (per product rule #1).
//
// These are heuristic selectors; the safe default (no signals → no note) is
// preferred over false positives.
const HONORS_DOM_SIGNALS = [
  '[data-testid="honors-points"]',
  '[data-testid="user-honors-points"]',
  '[data-testid="header-honors-badge"]',
  '[data-testid="honors-member-badge"]',
  '[data-honors-tier]',
  ".hhonors-member-badge",
  ".honors-badge",
] as const;

/**
 * Returns true when any known Hilton Honors DOM signal is present on the page.
 * Uses only element presence checks — never reads session state or cookies.
 */
export function detectHonorsActive(doc: DocLike): boolean {
  for (const selector of HONORS_DOM_SIGNALS) {
    if (doc.querySelector(selector) !== null) return true;
  }
  return false;
}
