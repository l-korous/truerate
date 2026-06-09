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
  matchHotelDirectory,
  templatesForTier,
  summariseBenefits,
  estimatePerkValueAllBands,
  getUsageRepo,
  type HotelDirectoryEntry,
  type Program,
} from "@truerate/core";

const _require = createRequire(import.meta.url);
let _dir: HotelDirectoryEntry[] | null = null;

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

/** Catalog programs whose brand/domain appears in the searched hotel text. */
function matchingPrograms(q: string): Program[] {
  const ql = q.toLowerCase();
  return PROGRAMS.filter((p) => {
    const brands = (p.defaultMatch.brands ?? []).map((b) => b.toLowerCase());
    const domains = (p.defaultMatch.domains ?? []).map((d) => d.toLowerCase().replace(/\..*$/, ""));
    return brands.some((b) => b.length > 2 && ql.includes(b)) || domains.some((d) => d.length > 2 && ql.includes(d));
  });
}

function programView(p: Program) {
  const tier = p.tiers?.[p.tiers.length - 1]; // top tier = best illustration
  const templates = templatesForTier(p, tier);
  const summary = summariseBenefits(templates);
  const seen = new Set<string>();
  const perkValues = templates
    .flatMap((t) => t.value.structuredPerks ?? [])
    .filter((sp) => (seen.has(sp.type) ? false : (seen.add(sp.type), true)))
    .map((sp) => ({ label: sp.label, estUsd: estimatePerkValueAllBands(sp.type)[4].estimatedUsd }))
    .filter((pv) => pv.estUsd > 0);
  return { programId: p.id, name: p.name, category: p.category, region: p.region, topTier: tier, summary, perkValues, realizationUrl: p.realizationUrl };
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
/** A directory hit is relevant only if it shares a DISTINCTIVE token with the
 *  query — not merely a generic word. (Substring containment is avoided: it
 *  false-matches "hotel 99" ⊆ "hotel 999".) If the query itself has no
 *  distinctive token (e.g. just "hotel"), don't over-filter. */
function relevantHotel(query: string, name: string): boolean {
  const qt = sigTokens(query);
  if (qt.size === 0) return true;
  for (const t of sigTokens(name)) if (qt.has(t)) return true;
  return false;
}

export const demoRoutes = new Hono();

// GET /demo/hotel?q= — what an end-user sees for a given hotel. Public.
demoRoutes.get("/demo/hotel", (c) => {
  const q = (c.req.query("q") ?? "").trim();
  if (!q) return c.json({ error: "missing_query" }, 400);
  const directBooking = matchHotelDirectory(directory(), { hotel: q }, 12)
    .filter((h) => relevantHotel(q, h.name))
    .slice(0, 5)
    .map((h) => ({
      name: h.name,
      city: h.city,
      country: h.country,
      kind: h.kind,
      realizationUrl: h.realizationUrl,
    }));
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
