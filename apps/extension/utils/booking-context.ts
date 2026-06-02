import type { PageContext } from "@truerate/core";

// Pure helpers for Booking.com page-type detection and property-context
// extraction. Kept free of browser globals so they can be unit-tested directly.

export type BookingPageType = "search" | "detail" | "unknown";

export function detectPageType(url: string): BookingPageType {
  let pathname: string;
  let hostname: string;
  try {
    const parsed = new URL(url);
    pathname = parsed.pathname;
    hostname = parsed.hostname;
  } catch {
    return "unknown";
  }
  if (hostname !== "booking.com" && !hostname.endsWith(".booking.com")) return "unknown";
  if (pathname.startsWith("/hotel/")) return "detail";
  if (pathname.startsWith("/searchresults")) return "search";
  return "unknown";
}

// Ordered by stability: data-testid attributes first, class-based selectors last.
const DETAIL_NAME_SELECTORS = [
  '[data-testid="title"]',
  '[data-testid="property-header-content"] h1',
  "h2.pp-header__title",
  ".pp-header__title",
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
  // og:title is very stable; format is typically "Hotel Name, City, Country"
  const og = doc.querySelector('meta[property="og:title"]')?.getAttribute("content");
  if (og) {
    const part = og.split(",")[0]?.trim();
    if (part) return part;
  }
  // Last resort: document title often has "Hotel Name – City | Booking.com"
  // Only split on en-dash/em-dash (not plain hyphen, which appears in hotel names).
  const titlePart = doc.title.split(/\s[–—]\s/)[0]?.trim();
  return titlePart || undefined;
}

export function buildPageContext(url: string, doc: DocLike): PageContext {
  const domain = "booking.com";
  if (detectPageType(url) !== "detail") return { domain };
  const name = extractHotelName(doc);
  return name ? { domain, property: { name } } : { domain };
}

// DOM signals that indicate Booking.com's Genius tier is active for the
// current user. We read only element presence — no cookies, sessions, or
// prices are accessed (per product rule #1).
const GENIUS_DOM_SIGNALS = [
  '[data-testid="genius-logo"]',
  '[data-testid="header-genius-logo"]',
  '[data-testid="genius-banner"]',
  '[data-testid="web-genius-banner"]',
  '[data-component="genius-badge"]',
  ".bui-header__action-link--genius",
] as const;

/**
 * Returns true when any known Genius-tier DOM signal is present on the page.
 * Uses only element presence checks — never reads session state or cookies.
 */
export function detectGeniusActive(doc: DocLike): boolean {
  for (const selector of GENIUS_DOM_SIGNALS) {
    if (doc.querySelector(selector) !== null) return true;
  }
  return false;
}
