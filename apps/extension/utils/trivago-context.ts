import type { PageContext } from "@truerate/core";
import type { DocLike } from "./doc-like";

export type { DocLike };

// Pure helpers for Trivago page-type detection and property-context
// extraction. Kept free of browser globals so they can be unit-tested directly.
// Mirrors the shape of booking-context.ts and hotelscom-context.ts.
//
// Trivago is a metasearch engine — it aggregates offers from multiple OTAs
// (Booking.com, Expedia, Hotels.com, etc.). Context detection therefore differs
// from a single-OTA script: we detect page type from the URL path structure and
// extract the property name from stable DOM signals or meta tags.

export type TrivagoPageType = "search" | "detail" | "unknown";

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

  // Detail pages use locale-prefixed paths like:
  //   /en-US/lm/hotel/<id>/slug  (modern)
  //   /<locale>/lm/hotel/<id>/    (variant)
  // and older paths like:
  //   /CITY--CITYID/hotel/<id>    (legacy)
  if (/\/lm\/hotel\/\d+/.test(pathname)) return "detail";
  // Legacy detail: path segment matching /<slug>/hotel/<numeric-id>
  if (/\/hotel\/\d+(-[^/]*)?$/.test(pathname)) return "detail";

  // Search results use paths like:
  //   /en-US/lm/hotel-search     (modern)
  //   /hotel-search              (root)
  // and older: /CITY--CITYID/hotel (with no numeric id suffix = results list)
  if (/\/lm\/hotel-search/.test(pathname) || /\/hotel-search/.test(pathname)) return "search";
  // Legacy search: /CITY--CITYID/hotel (path ends with /hotel, not /hotel/<id>)
  if (/\/hotel\/?$/.test(pathname)) return "search";
  // Root — Trivago's homepage is the search entry point
  if (pathname === "/" || pathname === "") return "search";

  return "unknown";
}

// Selectors ordered by stability — data-testid first, class-based last.
const DETAIL_NAME_SELECTORS = [
  '[data-testid="hotel-name-headline"]',
  '[data-testid="hotel-name"]',
  '[data-testid="property-name"]',
  'h1[class*="hotel-name"]',
  'h1[class*="property-name"]',
  "h1.hotel-name",
  "h1",
] as const;

export function extractTrivagoHotelName(doc: DocLike): string | undefined {
  for (const selector of DETAIL_NAME_SELECTORS) {
    const text = doc.querySelector(selector)?.textContent?.trim();
    if (text) return text;
  }
  // og:title on Trivago is typically "Hotel Name, City, Country | trivago"
  const og = doc.querySelector('meta[property="og:title"]')?.getAttribute("content");
  if (og) {
    const part = og.split(",")[0]?.trim();
    if (part && !part.toLowerCase().startsWith("trivago")) return part;
  }
  // Page title is typically "Hotel Name - City | trivago" or "Hotel Name | trivago"
  // Try " | " separator first (only if the separator is actually present).
  const pipeIdx = doc.title.indexOf(" | ");
  if (pipeIdx !== -1) {
    const titlePipe = doc.title.slice(0, pipeIdx).trim();
    if (titlePipe && !titlePipe.toLowerCase().startsWith("trivago")) return titlePipe;
  }
  // Fallback: "Hotel Name - trivago" — split on " - "
  const dashIdx = doc.title.indexOf(" - ");
  if (dashIdx !== -1) {
    const titleDash = doc.title.slice(0, dashIdx).trim();
    if (titleDash && !titleDash.toLowerCase().startsWith("trivago")) return titleDash;
  }
  return undefined;
}

export function buildTrivagoPageContext(url: string, doc: DocLike): PageContext {
  const domain = "trivago.com";
  if (detectTrivagoPageType(url) !== "detail") return { domain };
  const name = extractTrivagoHotelName(doc);
  return name ? { domain, property: { name } } : { domain };
}

// Trivago is a metasearch engine — it aggregates offers from Booking.com,
// Expedia, Hotels.com, and others. Listed prices may already reflect member
// rates from OTAs the user is logged into (e.g. Genius, One Key).
// We detect this by checking for OTA-sourced member-rate badges that Trivago
// renders inline on result cards or the detail page.
//
// We only check element presence — no cookies, session state, or prices are
// accessed (per product rule #1).
const METASEARCH_MEMBER_RATE_SIGNALS = [
  // Trivago's own member-rate / deal labels
  '[data-testid="member-deal"]',
  '[data-testid="member-rate"]',
  '[data-testid="exclusive-deal"]',
  '[class*="member-deal"]',
  '[class*="memberDeal"]',
  '[class*="member-rate"]',
  '[class*="exclusive-deal"]',
  // Booking.com Genius badge surfaced through Trivago metasearch
  '[data-testid="genius-badge"]',
  '[class*="genius-badge"]',
  // Generic deal/loyalty badge patterns used across Trivago variants
  '[data-qa="member-badge"]',
  '[data-qa="exclusive-rate"]',
] as const;

/**
 * Returns true when any known member-rate or OTA loyalty signal is present on
 * the Trivago page. Indicates at least one listed offer may already incorporate
 * a program discount, so the extension note surfaces this context.
 */
export function detectMetasearchMemberRateActive(doc: DocLike): boolean {
  for (const selector of METASEARCH_MEMBER_RATE_SIGNALS) {
    if (doc.querySelector(selector) !== null) return true;
  }
  return false;
}
