import type { PageContext } from "@truerate/core";
import type { DocLike } from "./doc-like";

export type { DocLike };

// Pure helpers for Trivago page-type detection and property-context extraction.
// Trivago is a metasearch engine — context detection differs from a single OTA.
// Kept free of browser globals so helpers can be unit-tested directly.

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

  // Hotel detail page: /<locale>/odr/...
  // e.g. https://www.trivago.com/en-US/odr/hotel/marriott-prague
  if (/\/odr\//.test(pathname)) return "detail";

  // Search results list: /<locale>/srl[/...]
  // e.g. https://www.trivago.com/en-US/srl/hotel?search=...
  if (/\/srl(\/|$)/.test(pathname)) return "search";

  return "unknown";
}

// Selectors ordered by stability — data-testid attributes first, generic headings last.
const DETAIL_NAME_SELECTORS = [
  '[data-testid="item-name"]',
  '[data-testid="property-name"]',
  '[data-testid="hotel-name"]',
  'h1[class*="ItemName"]',
  'h1[class*="item-name"]',
  'h1[class*="property-name"]',
  "h1",
] as const;

export function extractTrivagoHotelName(doc: DocLike): string | undefined {
  for (const selector of DETAIL_NAME_SELECTORS) {
    const text = doc.querySelector(selector)?.textContent?.trim();
    if (text) return text;
  }
  // og:title on Trivago: "Hotel Name, City | trivago"
  const og = doc.querySelector('meta[property="og:title"]')?.getAttribute("content");
  if (og) {
    const part = og.split("|")[0]?.split(",")[0]?.trim();
    if (part && !part.toLowerCase().includes("trivago")) return part;
  }
  // Page title: "Hotel Name - City | trivago"
  const titlePart = doc.title.split("|")[0]?.trim();
  return titlePart || undefined;
}

export function buildTrivagoPageContext(url: string, doc: DocLike): PageContext {
  const domain = "trivago.com";
  if (detectTrivagoPageType(url) !== "detail") return { domain };
  const name = extractTrivagoHotelName(doc);
  return name ? { domain, property: { name } } : { domain };
}

/**
 * Trivago is inherently a metasearch engine — prices on every page aggregate
 * offers from OTA partners that may already include their own loyalty discounts
 * (e.g., Booking Genius if the user is signed into Booking.com). Always returns
 * true so the metasearch-awareness note is always shown, preventing TrueRate
 * from ever implying that listed OTA prices are unaffected by loyalty programmes
 * (product rule #1 — no prices from TrueRate, no implied final prices).
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function detectTrivagoMetasearchActive(_doc: DocLike): boolean {
  return true;
}
