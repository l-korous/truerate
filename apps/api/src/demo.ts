// Public "TrueRate for your hotel" demo surface — the wow for prospective hotel
// clients. Given a hotel name, show exactly what a TrueRate end-user sees:
//   • we steer travellers to BOOK DIRECT at the hotel (bypassing OTA commission)
//   • any loyalty programs that apply, with their perks + perk-VALUE estimates
// Plus platform-scale stats. No prices anywhere (rule #1) — perk value estimates
// are allowed (they're not hotel rates).

import { Hono } from "hono";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  PROGRAMS,
  templatesForTier,
  summariseBenefits,
  estimatePerkValueAllBands,
  getUsageRepo,
  termsForDomain,
  type HotelDirectoryEntry,
  type HotelTermsIndex,
  type Program,
} from "@truerate/core";

const _require = createRequire(import.meta.url);
let _dir: HotelDirectoryEntry[] | null = null;
let _terms: HotelTermsIndex | null = null;
let _commonTokens: Set<string> | null = null;
let _searchIndex: { h: HotelDirectoryEntry; nn: string }[] | null = null;

/** Lazy, fail-soft load of the hotel directory (same data the MCP serves).
 *  Resolve the package MAIN (allowed by `exports`) → <core>/dist → ../data;
 *  resolving "@truerate/core/package.json" is blocked by the exports field. */
function directory(): HotelDirectoryEntry[] {
  if (_dir) return _dir;
  try {
    const coreDist = path.dirname(_require.resolve("@truerate/core")); // <core>/dist
    _dir = JSON.parse(readFileSync(path.join(coreDist, "..", "data", "hotel-directory.json"), "utf-8")) as HotelDirectoryEntry[];
  } catch {
    _dir = [];
  }
  return _dir;
}

/** Lazy, fail-soft load of scraped per-hotel terms (#367), keyed by bare domain. */
function termsIndex(): HotelTermsIndex {
  if (_terms) return _terms;
  try {
    const coreDist = path.dirname(_require.resolve("@truerate/core"));
    _terms = JSON.parse(readFileSync(path.join(coreDist, "..", "data", "hotel-terms.json"), "utf-8")) as HotelTermsIndex;
  } catch {
    _terms = {};
  }
  return _terms;
}

/** Substring typeahead over the directory: hotels whose (diacritic-folded) name
 *  contains the query anywhere — so "olymp" AND "lympi" both match every
 *  "Olympia". Ranked: name-prefix < word-prefix < mid-substring, then shorter
 *  names. The folded-name index is built once, lazily. */
function searchDirectory(q: string, limit: number): HotelDirectoryEntry[] {
  const nq = norm(q).trim();
  if (nq.length < 2) return [];
  if (!_searchIndex) _searchIndex = directory().map((h) => ({ h, nn: norm(h.name) }));
  const hits: { h: HotelDirectoryEntry; rank: number; idx: number; len: number }[] = [];
  for (const e of _searchIndex) {
    const idx = e.nn.indexOf(nq);
    if (idx < 0) continue;
    const rank = idx === 0 ? 0 : e.nn[idx - 1] === " " ? 1 : 2;
    hits.push({ h: e.h, rank, idx, len: e.nn.length });
  }
  hits.sort((a, b) => a.rank - b.rank || a.idx - b.idx || a.len - b.len || a.h.name.localeCompare(b.h.name));
  return hits.slice(0, limit).map((s) => s.h);
}

/** Catalog programs that apply to the searched hotel text: by brand/domain
 *  substring, or because a brand / known property name's distinctive tokens are
 *  ALL present in the query — so "Emblem Prague" → Emblem Prague and "Hotel Roma"
 *  → Your Prague Hotels, while "Hilton Prague" does not match Emblem (shares only
 *  the city, which isn't distinctive). */
function matchingPrograms(q: string): Program[] {
  const ql = q.toLowerCase().trim();
  const qt = distinctiveTokens(q);
  const namedInQuery = (name: string): boolean => {
    const nt = distinctiveTokens(name);
    if (nt.size === 0) return false;
    for (const t of nt) if (!qt.has(t)) return false;
    return true;
  };
  const pfx = (s: string): boolean => ql.length >= 3 && s.startsWith(ql); // typeahead: typing a brand prefix
  return PROGRAMS.filter((p) => {
    const brands = (p.defaultMatch.brands ?? []).map((b) => b.toLowerCase());
    const domains = (p.defaultMatch.domains ?? []).map((d) => d.toLowerCase().replace(/\..*$/, ""));
    if (brands.some((b) => b.length > 2 && (ql.includes(b) || pfx(b)))) return true;
    if (domains.some((d) => d.length > 2 && (ql.includes(d) || pfx(d)))) return true;
    return [...(p.defaultMatch.brands ?? []), ...(p.defaultMatch.propertyNames ?? [])].some(namedInQuery);
  });
}

function programView(p: Program) {
  const tier = p.tiers?.[p.tiers.length - 1]; // top tier = best illustration
  const templates = templatesForTier(p, tier);
  const summary = summariseBenefits(templates);
  // Headline discount (a fraction, e.g. 0.15 → 15%). For open-to-anyone programs
  // the demo tells a non-member "−X% for you if you register at <url>".
  const percentOff = Math.max(0, ...templates.map((t) => t.value.percentOff ?? 0));
  const seen = new Set<string>();
  const perkValues = templates
    .flatMap((t) => t.value.structuredPerks ?? [])
    .filter((sp) => (seen.has(sp.type) ? false : (seen.add(sp.type), true)))
    .map((sp) => ({ label: sp.label, estUsd: estimatePerkValueAllBands(sp.type)[4].estimatedUsd }))
    .filter((pv) => pv.estUsd > 0);
  return { programId: p.id, name: p.name, category: p.category, region: p.region, topTier: tier, summary, perkValues, realizationUrl: p.realizationUrl, openToAnyone: p.openToAnyone ?? false, percentOff };
}

// Generic accommodation words that must not, alone, make two names "match" —
// otherwise "Hotel Sacher" loosely matches any "... Hotel ...". The matcher
// returns those weak token-overlap hits; for the demo we drop them so a hotel
// sees their property or a clean "not found", never irrelevant results.
const STOP = new Set([
  "hotel", "hotels", "apartment", "apartments", "apartmany", "penzion", "pension", "guesthouse", "guest",
  "house", "resort", "spa", "wellness", "hostel", "motel", "chalet", "villa", "rooms", "room", "inn",
  "the", "and", "by", "of", "garni", "boutique", "design", "park", "grand", "city", "old", "town",
  // generic accommodation-type words (and a few non-EN equivalents) — like
  // "hotel" they must not, alone, make two names match.
  "lodge", "lodges", "suites", "suite", "residence", "residences", "aparthotel", "aparthotels",
  "bnb", "camping", "gasthof", "gasthaus", "albergo", "locanda", "hostal", "ostello", "ferienwohnung",
]);
function norm(s: string): string {
  return s.toLowerCase().normalize("NFKD").replace(/\p{Diacritic}/gu, "");
}
function sigTokens(s: string): Set<string> {
  return new Set(norm(s).split(/[^a-z0-9]+/).filter((t) => t.length > 2 && !STOP.has(t)));
}
// A token that recurs across many hotel names is a location/common word (e.g.
// "prague"/"praha", "wien") — NOT a distinctive signal. Detected by document
// frequency over the directory (language-agnostic), so "Emblem Prague" matches
// on "emblem", not on every Prague hotel. Built once, lazily.
const COMMON_TOKEN_MIN = 25;
function commonTokens(): Set<string> {
  if (_commonTokens) return _commonTokens;
  const df = new Map<string, number>();
  for (const h of directory()) for (const t of sigTokens(h.name)) df.set(t, (df.get(t) ?? 0) + 1);
  const common = new Set<string>();
  for (const [t, n] of df) if (n >= COMMON_TOKEN_MIN) common.add(t);
  _commonTokens = common;
  return common;
}
/** sigTokens minus common/location tokens — the truly distinctive part of a name.
 *  Used to match programs by brand / property name without a shared city word
 *  (e.g. "Prague") creating false matches. */
function distinctiveTokens(s: string): Set<string> {
  const common = commonTokens();
  const out = new Set<string>();
  for (const t of sigTokens(s)) if (!common.has(t)) out.add(t);
  return out;
}

export const demoRoutes = new Hono();

// GET /demo/hotel?q= — what an end-user sees for a given hotel. Public.
demoRoutes.get("/demo/hotel", (c) => {
  const q = (c.req.query("q") ?? "").trim();
  if (!q) return c.json({ error: "missing_query" }, 400);
  const terms = termsIndex();
  const directBooking = searchDirectory(q, 6).map((h) => {
    const t = termsForDomain(terms, h.domain);
    return {
      name: h.name,
      city: h.city,
      country: h.country,
      kind: h.kind,
      realizationUrl: h.realizationUrl,
      // Scraped direct-booking terms for this exact hotel (#367), if we have them.
      terms: t
        ? {
            discountPercent: t.discountPercent,
            openToAnyone: t.openToAnyone,
            perks: t.perks,
            bestRateGuarantee: t.bestRateGuarantee,
            loyaltyProgram: t.loyaltyProgram,
            conditions: t.conditions,
            confidence: t.confidence,
            sourceUrl: t.sourceUrl,
          }
        : null,
    };
  });
  const memberPrograms = matchingPrograms(q).map(programView);
  return c.json({ query: q, directBooking, memberPrograms });
});

// GET /stats/overview — platform-scale stats for the "it reaches a ton of
// end-users" claim. Public, non-sensitive aggregates only.
demoRoutes.get("/stats/overview", async (c) => {
  const dir = directory();
  const countries = new Set(dir.map((h) => h.country)).size;
  let benefitSurfaces = 0;
  try {
    benefitSurfaces = (await (await getUsageRepo()).aggregate()).total;
  } catch {
    /* analytics unavailable — fail soft */
  }
  return c.json({ hotelsCovered: dir.length, programs: PROGRAMS.length, countries, benefitSurfaces });
});
