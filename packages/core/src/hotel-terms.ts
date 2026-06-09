// Hotel direct-booking TERMS (#367): per-hotel discount %, perks, and conditions
// scraped from each hotel's OWN website — what makes the demo show real value,
// not just "name + URL". Keyed by bare domain (matches HotelDirectoryEntry.domain).
//
// HARD RULE #1: terms NEVER hold prices or room rates — only discount
// percentages, named perks, best-rate flags, loyalty, and conditions. The
// extractor strips money amounts; `termsHaveNoPrices` enforces it in tests.
//
// The dataset lives in packages/core/data/hotel-terms.json and is loaded by
// SERVER channels at runtime. This module is a PURE lookup (takes the index as
// an argument), so importing it never bundles the dataset into the web/extension.

export type Confidence = "low" | "medium" | "high";

export interface HotelTerms {
  /** Bare domain key, e.g. "pecr.cz" — matches HotelDirectoryEntry.domain. */
  domain: string;
  /** Direct-booking / registration discount as a fraction, e.g. 0.15 = 15%. */
  discountPercent?: number;
  /** True if the discount needs only free registration (anyone can get it). */
  openToAnyone?: boolean;
  /** Named perks, e.g. ["free breakfast", "free parking"]. Never a price. */
  perks: string[];
  bestRateGuarantee?: boolean;
  /** Short loyalty/club description (no money thresholds). */
  loyaltyProgram?: string;
  /** Conditions/caveats (no money). */
  conditions?: string;
  confidence: Confidence;
  /** Page the terms were read from. */
  sourceUrl: string;
  /** ISO date of the scrape, e.g. "2026-06-09". */
  scrapedAt: string;
}

/** A loaded terms dataset keyed by bare domain. */
export type HotelTermsIndex = Record<string, HotelTerms>;

/** Bare domain from a URL or domain string (strips scheme, "www.", path). */
export function domainOf(urlOrDomain: string): string {
  return (
    urlOrDomain
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .split(/[/?#]/)[0] ?? ""
  );
}

/** Look up terms for a hotel by its domain (or realization URL). Pure. */
export function termsForDomain(index: HotelTermsIndex, urlOrDomain: string): HotelTerms | undefined {
  return index[domainOf(urlOrDomain)];
}

// Money/price patterns that must never appear in stored terms (rule #1).
const PRICE_RE = /(\$|€|£|\b(czk|eur|usd|gbp|pln|huf)\b|kč|per night|\/ ?night|nightly|room rate|from\s*\d)/i;

/** True if a terms record carries no price/rate text (rule #1 guard). */
export function termsHaveNoPrices(t: HotelTerms): boolean {
  const blob = [t.loyaltyProgram, t.conditions, ...(t.perks ?? [])].filter(Boolean).join("  ");
  return !PRICE_RE.test(blob);
}
