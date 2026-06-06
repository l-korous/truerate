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
import { writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";

const OVERPASS = "https://overpass-api.de/api/interpreter";

// Czechia is the focus (uncapped). A few hundred each are "sprinkled" from
// elsewhere via an Overpass-level cap so those queries stay light.
const COUNTRIES = {
  CZ: { cap: 0 },   // 0 = no cap (the focus)
  DE: { cap: 400 },
  GB: { cap: 400 },
  US: { cap: 400 },
  JP: { cap: 300 },
  AT: { cap: 250 },
  PL: { cap: 250 },
  SK: { cap: 200 },
};
const KINDS = ["hotel", "guest_house", "hostel", "motel", "apartment", "chalet"];

function overpass(query) {
  // curl is reliable behind the corp TLS proxy; --ssl-no-revoke skips the CRL
  // check the proxy can't satisfy. (A clean env can swap this for fetch().)
  const out = execFileSync(
    "curl",
    ["-sS", "-m", "250", "--ssl-no-revoke", "-G", OVERPASS, "--data-urlencode", `data=${query}`],
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
  const filt = KINDS.map((k) => `nwr["tourism"="${k}"]["website"](area.c);`).join("");
  const out = cap > 0 ? `out tags center ${cap};` : "out tags center;";
  return `[out:json][timeout:240];area["ISO3166-1"="${cc}"][admin_level=2]->.c;(${filt});${out}`;
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
    const website = (t.website || t["contact:website"] || "").trim();
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

all.sort((a, b) => (a.country + a.name).localeCompare(b.country + b.name));
mkdirSync("packages/core/data", { recursive: true });
const outPath = "packages/core/data/hotel-directory.json";
writeFileSync(outPath, JSON.stringify(all));
process.stderr.write(`\nWrote ${all.length} entries to ${outPath}\n`);
