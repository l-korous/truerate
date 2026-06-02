import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { CatalogCache, resetCatalogCache } from "../src/catalog-cache.js";
import { resetCatalogRepo, getCatalogRepo, programToCatalogInput } from "../src/catalog-db.js";
import { PROGRAMS } from "../src/programs.js";
import type { CatalogRepo } from "../src/catalog-db.js";
import type { CatalogEntryDoc } from "../src/types.js";

process.env["TRUERATE_INMEMORY"] = "true";

// --- Helpers -----------------------------------------------------------------

function makeEntry(programId: string): CatalogEntryDoc {
  return {
    id: `${programId}#v1`,
    programId,
    version: 1,
    isCurrent: true,
    status: "published",
    provenance: { source: "manual-seed", asOf: "2026-01" },
    region: "Global",
    name: programId,
    category: "hotel",
    defaultMatch: {},
    requiresCredential: false,
    fields: [],
    benefits: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    publishedAt: new Date().toISOString(),
  };
}

/** Simple spy repo that records how many times each method was called. */
function makeSpyRepo(entries: CatalogEntryDoc[]): CatalogRepo & { calls: Record<string, number> } {
  const calls: Record<string, number> = { listPublished: 0, getCurrent: 0 };
  return {
    calls,
    async init() {},
    async listPublished(region?: string) {
      calls["listPublished"]++;
      return region
        ? entries.filter((e) => e.region === region || e.region === "Global")
        : [...entries];
    },
    async getCurrent(programId: string) {
      calls["getCurrent"]++;
      return entries.find((e) => e.programId === programId && e.isCurrent) ?? null;
    },
    async listByStatus() { return []; },
    async getVersion() { return null; },
    async getHistory() { return []; },
    async upsertDraft(input) { return makeEntry(input.programId); },
    async publish(programId) { return makeEntry(programId); },
    async archive() {},
    async seedIfEmpty() { return { seeded: 0, skipped: 0 }; },
  };
}

// --- Tests -------------------------------------------------------------------

describe("CatalogCache", () => {
  test("listPublished caches result and avoids second repo call within TTL", async () => {
    const e1 = makeEntry("prog_a");
    const e2 = makeEntry("prog_b");
    const spy = makeSpyRepo([e1, e2]);
    const cache = new CatalogCache(spy, 60_000);

    const first = await cache.listPublished();
    const second = await cache.listPublished();

    assert.equal(spy.calls["listPublished"], 1, "repo called only once");
    assert.deepEqual(first, second, "same reference returned from cache");
    assert.equal(first.length, 2);
  });

  test("getCurrent caches result and avoids second repo call within TTL", async () => {
    const entry = makeEntry("prog_a");
    const spy = makeSpyRepo([entry]);
    const cache = new CatalogCache(spy, 60_000);

    const first = await cache.getCurrent("prog_a");
    const second = await cache.getCurrent("prog_a");

    assert.equal(spy.calls["getCurrent"], 1, "repo called only once");
    assert.deepEqual(first, second);
  });

  test("listPublished uses separate cache keys for different regions", async () => {
    const global = { ...makeEntry("prog_a"), region: "Global" };
    const cz = { ...makeEntry("prog_cz"), region: "CZ" };
    const spy = makeSpyRepo([global, cz]);
    const cache = new CatalogCache(spy, 60_000);

    const all = await cache.listPublished();
    const czOnly = await cache.listPublished("CZ");

    assert.equal(spy.calls["listPublished"], 2, "called once per distinct region key");
    assert.equal(all.length, 2);
    assert.equal(czOnly.length, 2); // CZ + Global
  });

  test("cached results expire after TTL and trigger a fresh repo call", async () => {
    const spy = makeSpyRepo([makeEntry("prog_a")]);
    const cache = new CatalogCache(spy, 1); // 1 ms TTL

    await cache.listPublished();
    await new Promise((r) => setTimeout(r, 10)); // let TTL expire
    await cache.listPublished();

    assert.equal(spy.calls["listPublished"], 2, "second call after expiry hits repo");
  });

  test("invalidate() clears all caches", async () => {
    const spy = makeSpyRepo([makeEntry("prog_a")]);
    const cache = new CatalogCache(spy, 60_000);

    await cache.listPublished();
    await cache.getCurrent("prog_a");
    assert.equal(spy.calls["listPublished"], 1);
    assert.equal(spy.calls["getCurrent"], 1);

    cache.invalidate();

    await cache.listPublished();
    await cache.getCurrent("prog_a");
    assert.equal(spy.calls["listPublished"], 2, "re-fetches after full invalidate");
    assert.equal(spy.calls["getCurrent"], 2);
  });

  test("invalidate(programId) clears only that program and all list caches", async () => {
    const spa = makeSpyRepo([makeEntry("prog_a"), makeEntry("prog_b")]);
    const cache = new CatalogCache(spa, 60_000);

    await cache.listPublished();
    await cache.getCurrent("prog_a");
    await cache.getCurrent("prog_b");

    cache.invalidate("prog_a");

    // list cache should be gone
    await cache.listPublished();
    assert.equal(spa.calls["listPublished"], 2, "list re-fetched after single-program invalidate");

    // prog_a current cache gone
    await cache.getCurrent("prog_a");
    assert.equal(spa.calls["getCurrent"], 3, "prog_a re-fetched");

    // prog_b current cache still valid
    await cache.getCurrent("prog_b");
    assert.equal(spa.calls["getCurrent"], 3, "prog_b still cached");
  });

  test("getCurrent returns null for unknown programId (and caches the null)", async () => {
    const spy = makeSpyRepo([]);
    const cache = new CatalogCache(spy, 60_000);

    const r1 = await cache.getCurrent("unknown");
    const r2 = await cache.getCurrent("unknown");

    assert.equal(r1, null);
    assert.equal(r2, null);
    assert.equal(spy.calls["getCurrent"], 1, "null result is cached too");
  });
});

// --- Singleton factory -------------------------------------------------------

describe("getCatalogCache singleton", () => {
  beforeEach(() => {
    resetCatalogCache();
    resetCatalogRepo();
  });

  test("getCatalogCache returns same instance on repeated calls", async () => {
    const { getCatalogCache } = await import("../src/catalog-cache.js");
    const a = await getCatalogCache();
    const b = await getCatalogCache();
    assert.equal(a, b, "singleton: same instance");
  });

  test("resetCatalogCache causes fresh instance on next call", async () => {
    const { getCatalogCache } = await import("../src/catalog-cache.js");
    const a = await getCatalogCache();
    resetCatalogCache();
    const b = await getCatalogCache();
    assert.notEqual(a, b, "reset: new instance");
  });
});

// --- catalogEntryToProgram ---------------------------------------------------

describe("catalogEntryToProgram", () => {
  test("converts a published CatalogEntryDoc to Program shape", async () => {
    const { catalogEntryToProgram } = await import("../src/catalog-db.js");
    const entry = makeEntry("booking_genius");
    const program = catalogEntryToProgram({
      ...entry,
      name: "Booking.com Genius",
      category: "ota",
      defaultMatch: { domains: ["booking.com"] },
      tiers: ["Level 1"],
      fields: [{ key: "tier", label: "Tier", type: "select" }],
      benefits: { "Level 1": [] },
    });

    assert.equal(program.id, "booking_genius");
    assert.equal(program.name, "Booking.com Genius");
    assert.equal(program.category, "ota");
    assert.deepEqual(program.defaultMatch, { domains: ["booking.com"] });
    assert.deepEqual(program.tiers, ["Level 1"]);
    assert.equal(program.requiresCredential, false);
    assert.equal(program.asOf, "2026-01");
  });

  test("round-trip: programToCatalogInput → catalogEntryToProgram preserves content", async () => {
    const { catalogEntryToProgram } = await import("../src/catalog-db.js");
    const original = PROGRAMS.find((p) => p.id === "booking_genius")!;
    const input = programToCatalogInput(original);
    const doc: CatalogEntryDoc = {
      ...input,
      id: `${input.programId}#v1`,
      version: 1,
      isCurrent: true,
      status: "published",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      publishedAt: new Date().toISOString(),
    };
    const roundTripped = catalogEntryToProgram(doc);

    assert.equal(roundTripped.id, original.id);
    assert.equal(roundTripped.name, original.name);
    assert.equal(roundTripped.category, original.category);
    assert.deepEqual(roundTripped.defaultMatch, original.defaultMatch);
    assert.deepEqual(roundTripped.tiers, original.tiers);
    assert.deepEqual(roundTripped.benefits, original.benefits);
  });
});
