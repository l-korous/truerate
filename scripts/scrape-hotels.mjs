#!/usr/bin/env node
// Desktop hotel-directory scraper (#99 / #11). Runs on the DESKTOP agent, not
// cloud CI (label: desktop). Pulls accommodations that publish a WEBSITE from
// OpenStreetMap via the Overpass API, per country, and normalizes them into
// catalog directory entries:
//   { name, domain, realizationUrl, city, country, stars?, kind, lat?, lon? }
//
// The realizationUrl is the hotel's own site = where a guest books DIRECT.
// NEVER scrapes prices — only the direct-booking URL + public facts. Specific
// discount %/perks are a later per-site enrichment step (#104); this builds the
// breadth foundation. OSM data (c) OpenStreetMap contributors, ODbL.
//
// Usage:  node scripts/scrape-hotels.mjs [CC ...]      (default: all configured)
//   e.g.  node scripts/scrape-hotels.mjs CZ
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";

// Default instance; override with OVERPASS_URL to use a mirror when the main
// instance rate-limits (e.g. https://overpass.kumi.systems/api/interpreter).
const OVERPASS = process.env.OVERPASS_URL || "https://overpass-api.de/api/interpreter";
// Overpass rejects requests without a descriptive User-Agent (HTTP 406).
const USER_AGENT = "TrueRate-directory-scraper/1.0 (+https://github.com/l-korous/truerate; ODbL OpenStreetMap)";

// Czechia is the focus (uncapped). A few hundred each are "sprinkled" from
// elsewhere via an Overpass-level cap so those queries stay light.
const CAP = Number(process.env.SPRINKLE_CAP || 300); // per far/sprinkle country
// TrueRate's home markets get deep coverage; the rest are sprinkled for reach.
const CORE = Number(process.env.CORE_CAP || 3000); // per core neighbour market
const COUNTRIES = {
  CZ: { cap: 0 }, // 0 = no cap (the focus — every CZ accommodation with a site)
  // European focus markets (owner: rest-of-Europe hotels) — deep coverage.
  DE: { cap: CORE }, AT: { cap: CORE }, PL: { cap: CORE }, SK: { cap: CORE }, HU: { cap: CORE },
  IT: { cap: CORE }, ES: { cap: CORE }, FR: { cap: CORE }, GB: { cap: CORE }, HR: { cap: CORE }, SI: { cap: CORE },
  // "Sprinkle" a few hundred each from other markets worldwide.
  NL: { cap: CAP }, BE: { cap: CAP }, CH: { cap: CAP }, PT: { cap: CAP },
  GR: { cap: CAP }, DK: { cap: CAP }, SE: { cap: CAP }, NO: { cap: CAP }, FI: { cap: CAP },
  IE: { cap: CAP }, RO: { cap: CAP }, US: { cap: CAP }, CA: { cap: CAP },
  JP: { cap: CAP }, KR: { cap: CAP }, AU: { cap: CAP }, TR: { cap: CAP },
};
const KINDS = ["hotel", "guest_house", "hostel", "motel", "apartment", "chalet"];

function overpass(query) {
  // curl is reliable behind the corp TLS proxy; --ssl-no-revoke skips the CRL
  // check the proxy can't satisfy. (A clean env can swap this for fetch().)
  const out = execFileSync(
    "curl",
    ["-sS", "-m", "310", "--ssl-no-revoke", "-A", USER_AGENT, "-G", OVERPASS, "--data-urlencode", `data=${query}`],
    { maxBuffer: 512 * 1024 * 1024, encoding: "utf8" },
  );
  return JSON.parse(out);
}

function domainOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

function buildQuery(cc, cap) {
  // Match website OR contact:website with EXACT keys — these use Overpass's tag
  // index, so the query stays fast even for big countries. (A key-regex filter
  // scans every tag with no index and times out on large areas like FR/ES/GB.)
  const tags = ["website", "contact:website"];
  const filt = KINDS.flatMap((k) => tags.map((tag) => `nwr["tourism"="${k}"]["${tag}"](area.c);`)).join("");
  const out = cap > 0 ? `out tags center ${cap};` : "out tags center;";
  return `[out:json][timeout:300];area["ISO3166-1"="${cc}"][admin_level=2]->.c;(${filt});${out}`;
}

const want = process.argv.slice(2).filter((a) => COUNTRIES[a]);
const targets = want.length ? want : Object.keys(COUNTRIES);

const all = [];
for (const cc of targets) {
  const { cap } = COUNTRIES[cc];
  process.stderr.write(`Fetching ${cc} (cap ${cap || "none"})...\n`);
  let data;
  try {
    data = overpass(buildQuery(cc, cap));
  } catch (e) {
    process.stderr.write(`  ${cc} FAILED: ${e.message}\n`);
    continue;
  }
  const seen = new Set();
  let n = 0;
  for (const el of data.elements ?? []) {
    const t = el.tags ?? {};
    const name = (t.name || t["name:en"] || "").trim();
    const website = (t.website || t["contact:website"] || t.url || "").trim();
    const domain = domainOf(website);
    if (!name || !domain) continue;
    const key = `${domain}|${name.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const stars = parseInt(t.stars, 10);
    all.push({
      name,
      domain,
      realizationUrl: website.startsWith("http") ? website : `https://${website}`,
      city: (t["addr:city"] || "").trim() || undefined,
      country: cc,
      stars: Number.isFinite(stars) && stars >= 1 && stars <= 5 ? stars : undefined,
      kind: t.tourism,
      lat: el.lat ?? el.center?.lat,
      lon: el.lon ?? el.center?.lon,
    });
    n++;
  }
  process.stderr.write(`  ${cc}: ${n} entries\n`);
}

mkdirSync("packages/core/data", { recursive: true });
const outPath = "packages/core/data/hotel-directory.json";

// Merge: keep entries for countries we did NOT scrape this run, replace the ones
// we did. So an incremental run (e.g. just CZ) grows that country without
// dropping the rest. A country whose Overpass query failed keeps its prior data.
let merged = all;
if (existsSync(outPath)) {
  try {
    const prev = JSON.parse(readFileSync(outPath, "utf8"));
    const refreshed = new Set(targets.filter((cc) => all.some((h) => h.country === cc)));
    const kept = prev.filter((h) => !refreshed.has(h.country));
    merged = [...kept, ...all.filter((h) => refreshed.has(h.country))];
    process.stderr.write(`Merged: kept ${kept.length} from ${[...new Set(kept.map((h) => h.country))].length} un-refreshed countries.\n`);
  } catch {
    /* unreadable prior file — write fresh */
  }
}

merged.sort((a, b) => (a.country + a.name).localeCompare(b.country + b.name));
writeFileSync(outPath, JSON.stringify(merged));
process.stderr.write(`\nWrote ${merged.length} entries to ${outPath} (this run scraped: ${targets.join(", ")})\n`);
