// Hotel directory (#99 / #325): a large, scraped index of accommodations that
// publish a website, used to answer "book direct at <URL>" for a searched hotel.
// Built by scripts/scrape-hotels.mjs from OpenStreetMap (Overpass). NEVER holds
// prices — only the direct-booking URL + public facts.
//
// The dataset lives in packages/core/data/hotel-directory.json and is loaded by
// SERVER channels (MCP/API) at runtime. This module is the PURE matcher (it
// takes the entries as an argument), so importing it never bundles the ~1 MB
// dataset into the web app or the browser extension.

export interface HotelDirectoryEntry {
  name: string;
  /** Bare domain, e.g. "firstrepublic.cz". */
  domain: string;
  /** Direct-booking ("realization") URL — the hotel's own site. Never a price. */
  realizationUrl: string;
  city?: string;
  /** ISO 3166-1 alpha-2, e.g. "CZ". */
  country: string;
  stars?: number;
  /** OSM tourism kind: hotel | guest_house | hostel | motel | apartment | chalet. */
  kind?: string;
  lat?: number;
  lon?: number;
}

export interface HotelDirectoryQuery {
  /** Hotel/property name to look up, e.g. "Hotel PECR". */
  hotel?: string;
  /** Domain, e.g. "firstrepublic.cz". */
  domain?: string;
  /** City filter, e.g. "Praha". */
  city?: string;
  /** ISO country filter, e.g. "CZ". */
  country?: string;
}

function norm(s: string): string {
  // Lowercase + strip diacritics so "Sněžkou" matches "Snezkou" (Czech names).
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .trim();
}

/**
 * Find directory entries matching a searched hotel. Pure (no I/O) — pass the
 * loaded directory in. Scoring:
 *   3 — exact/suffix domain match, or exact name match
 *   2 — name containment (one includes the other)
 *   1 — name token overlap
 * `country` is a hard filter; `city` is a tie-break boost. Returns up to `limit`
 * best matches. Never returns or computes a price.
 */
export function matchHotelDirectory(
  entries: HotelDirectoryEntry[],
  q: HotelDirectoryQuery,
  limit = 5,
): HotelDirectoryEntry[] {
  const qDomain = q.domain ? norm(q.domain).replace(/^www\./, "") : "";
  const qName = q.hotel ? norm(q.hotel) : "";
  const qCity = q.city ? norm(q.city) : "";
  const qCountry = q.country ? q.country.toUpperCase() : "";
  if (!qDomain && !qName) return [];

  const scored: Array<{ e: HotelDirectoryEntry; s: number }> = [];
  for (const e of entries) {
    if (qCountry && e.country !== qCountry) continue;
    let s = 0;
    if (qDomain) {
      const d = norm(e.domain);
      if (d === qDomain || d.endsWith("." + qDomain) || qDomain.endsWith("." + d)) s += 3;
    }
    if (qName) {
      const n = norm(e.name);
      if (n === qName) s += 3;
      else if (n.includes(qName) || qName.includes(n)) s += 2;
      else {
        const nt = new Set(n.split(/\s+/).filter((w) => w.length > 2));
        const overlap = qName.split(/\s+/).filter((w) => w.length > 2 && nt.has(w)).length;
        if (overlap) s += 1;
      }
    }
    if (s === 0) continue;
    if (qCity && e.city && norm(e.city).includes(qCity)) s += 1;
    scored.push({ e, s });
  }
  scored.sort((a, b) => b.s - a.s || a.e.name.localeCompare(b.e.name));
  return scored.slice(0, limit).map((x) => x.e);
}
