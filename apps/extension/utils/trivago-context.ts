import type { PageContext } from "@truerate/core";
import type { DocLike } from "./doc-like";

export type { DocLike };

// Pure helpers for Trivago page-type detection and property-context extraction.
// Kept free of browser globals so they can be unit-tested directly.
// Trivago is a metasearch engine that aggregates rates from multiple OTAs.

export type TrivagoPageType = "search" | "detail" | "unknown";

// Trivago URL structure:
//   Search/results: /<locale>/lm/...  (list mode)
//   Hotel detail:   /<locale>/odr/... (open deal/rate)
// Locale is like en-US, de-DE, fr-FR, cs-CZ, etc.
const LOCALE_SEG = "[a-z]{2}-[A-Z]{2}";
const DETAIL_RE = new RegExp(`^\\/${LOCALE_SEG}\\/odr\\/`);
const SEARCH_RE = new RegExp(`^\\/${LOCALE_SEG}\\/lm\\/`);

export function detectTrivagoPageType(url: string): TrivagoPageType {
  let pathname: string;
  let hostname: string;
  try {
    const parsed = new URL(url);
    pathname = parsed.pathname;
    hostname = parsed.hostname;
  } catch {
    return "unknown";
  }

  if (hostname !== "trivago.com" && !hostname.endsWith(".trivago.com")) return "unknown";

  if (DETAIL_RE.test(pathname)) return "detail";
  if (SEARCH_RE.test(pathname)) return "search";

  return "unknown";
}

// Selectors ordered by stability — data-testid first, generic last.
const DETAIL_NAME_SELECTORS = [
  '[data-testid="property-name"]',
  '[data-testid="hotel-name"]',
  '[data-testid="accommodation-name"]',
  'h1[class*="PropertyName"]',
  'h1[class*="property-name"]',
  'h1[class*="accommodation-name"]',
  ".property-name",
  "h1.accommodation__name",
  "[itemprop='name']",
] as const;

export function extractTrivagoHotelName(doc: DocLike): string | undefined {
  for (const selector of DETAIL_NAME_SELECTORS) {
    const text = doc.querySelector(selector)?.textContent?.trim();
    if (text) return text;
  }
  // og:title on Trivago detail pages: "Hotel Name - trivago" or "Hotel Name | trivago"
  const og = doc.querySelector('meta[property="og:title"]')?.getAttribute("content");
  if (og) {
    const part = og.split(/\s[-|]\s/)[0]?.trim();
    if (part && !part.toLowerCase().includes("trivago")) return part;
  }
  // Page title: "Hotel Name - trivago.com" or "Hotel Name | trivago"
  const titlePart = doc.title.split(/\s[-|]\s/)[0]?.trim();
  return titlePart || undefined;
}

export function buildTrivagoPageContext(url: string, doc: DocLike): PageContext {
  const domain = "trivago.com";
  if (detectTrivagoPageType(url) !== "detail") return { domain };
  const name = extractTrivagoHotelName(doc);
  return name ? { domain, property: { name } } : { domain };
}

// DOM signals that indicate the user has an active Trivago member session.
// Trivago has an account/rewards system (Trivago Score). We only check element
// presence — no cookies, session state, or prices are accessed (per product rule #1).
//
// Since Trivago is a metasearch, a logged-in member may see rates that already
// include discounts from underlying booking channels (e.g. Booking.com Genius).
// The content script uses this to show a metasearch-awareness note.
const TRIVAGO_MEMBER_SIGNALS = [
  '[data-testid="user-avatar"]',
  '[data-testid="user-profile"]',
  '[data-testid="trivago-score"]',
  '[data-testid="ts-balance"]',
  '[data-testid="member-badge"]',
  '[data-testid="rewards-points"]',
  ".member-icon",
  ".ts-balance",
] as const;

/**
 * Returns true when any known Trivago member session DOM signal is present.
 * Uses only element presence checks — never reads session state or cookies.
 */
export function detectTrivagoMemberActive(doc: DocLike): boolean {
  for (const selector of TRIVAGO_MEMBER_SIGNALS) {
    if (doc.querySelector(selector) !== null) return true;
  }
  return false;
}
