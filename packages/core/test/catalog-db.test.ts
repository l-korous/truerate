import { test } from "node:test";
import assert from "node:assert/strict";
import { programToCatalogInput, getCatalogRepo, resetCatalogRepo, catalogEntryToProgram } from "../src/catalog-db.js";
import { PROGRAMS, getProgram } from "../src/programs.js";
import type { CatalogEntryInput } from "../src/types.js";

// All tests run against the in-memory backend.
// Set TRUERATE_INMEMORY so getCatalogRepo() picks MemoryCatalogRepo.
process.env["TRUERATE_INMEMORY"] = "true";

// ─── programToCatalogInput helper ───────────────────────────────────────────

test("programToCatalogInput maps all Program fields correctly", () => {
  const program = getProgram("booking_genius")!;
  const input = programToCatalogInput(program);

  assert.equal(input.programId, "booking_genius");
  assert.equal(input.name, program.name);
  assert.equal(input.category, program.category);
  assert.equal(input.region, program.region);
  assert.deepEqual(input.defaultMatch, program.defaultMatch);
  assert.deepEqual(input.tiers, program.tiers);
  assert.equal(input.requiresCredential, program.requiresCredential);
  assert.deepEqual(input.fields, program.fields);
  assert.deepEqual(input.benefits, program.benefits);
  assert.equal(input.provenance.source, "manual-seed");
  assert.equal(input.provenance.sourceUrl, program.sourceUrl);
  assert.equal(input.provenance.asOf, program.asOf);
});

test("programToCatalogInput defaults region to Global when absent", () => {
  const program = { ...getProgram("booking_genius")!, region: undefined };
  const input = programToCatalogInput(program as Parameters<typeof programToCatalogInput>[0]);
  assert.equal(input.region, "Global");
});

test("programToCatalogInput defaults asOf to current month when absent", () => {
  const program = { ...getProgram("booking_genius")!, asOf: undefined };
  const input = programToCatalogInput(program as Parameters<typeof programToCatalogInput>[0]);
  assert.match(input.provenance.asOf, /^\d{4}-\d{2}$/);
});

test("programToCatalogInput contains no price-related keys", () => {
  const priceKeys = ["price", "nightlyAmount", "totalAmount", "priceOff"];
  for (const program of PROGRAMS) {
    const input = programToCatalogInput(program);
    const serialised = JSON.stringify(input);
    for (const key of priceKeys) {
      assert.ok(!serialised.includes(`"${key}"`), `${program.id}: CatalogEntryInput must not contain '${key}'`);
    }
  }
});

// ─── MemoryCatalogRepo — basic CRUD ─────────────────────────────────────────

function makeInput(overrides: Partial<CatalogEntryInput> = {}): CatalogEntryInput {
  return {
    programId: "test_program",
    provenance: { source: "manual-seed", asOf: "2026-06" },
    region: "Global",
    name: "Test Program",
    category: "hotel",
    defaultMatch: { domains: ["test.com"] },
    requiresCredential: false,
    fields: [],
    benefits: { "*": [] },
    ...overrides,
  };
}

test("upsertDraft creates a draft at version 1 for a new program", async () => {
  resetCatalogRepo();
  const repo = await getCatalogRepo();
  const draft = await repo.upsertDraft(makeInput());

  assert.equal(draft.programId, "test_program");
  assert.equal(draft.version, 1);
  assert.equal(draft.status, "draft");
  assert.equal(draft.isCurrent, false);
  assert.equal(draft.id, "test_program#v1");
  assert.ok(draft.createdAt);
  assert.ok(draft.updatedAt);
});

test("upsertDraft updates an existing draft in place", async () => {
  resetCatalogRepo();
  const repo = await getCatalogRepo();
  await repo.upsertDraft(makeInput({ name: "Test v1" }));
  const updated = await repo.upsertDraft(makeInput({ name: "Test v2" }));

  assert.equal(updated.version, 1, "version must not change when updating a draft");
  assert.equal(updated.name, "Test v2");
  assert.equal(updated.id, "test_program#v1");
});

test("publish promotes draft to published+isCurrent", async () => {
  resetCatalogRepo();
  const repo = await getCatalogRepo();
  await repo.upsertDraft(makeInput());
  const published = await repo.publish("test_program");

  assert.equal(published.status, "published");
  assert.equal(published.isCurrent, true);
  assert.ok(published.publishedAt);
});

test("getCurrent returns the published entry", async () => {
  resetCatalogRepo();
  const repo = await getCatalogRepo();
  await repo.upsertDraft(makeInput());
  await repo.publish("test_program");

  const current = await repo.getCurrent("test_program");
  assert.ok(current);
  assert.equal(current.status, "published");
  assert.equal(current.isCurrent, true);
});

test("getCurrent returns null for unknown program", async () => {
  resetCatalogRepo();
  const repo = await getCatalogRepo();
  assert.equal(await repo.getCurrent("unknown"), null);
});

// ─── Versioning invariant ────────────────────────────────────────────────────

test("second publish creates v2 and demotes v1", async () => {
  resetCatalogRepo();
  const repo = await getCatalogRepo();

  // Publish v1
  await repo.upsertDraft(makeInput({ name: "v1" }));
  await repo.publish("test_program");

  // Draft v2 and publish it
  await repo.upsertDraft(makeInput({ name: "v2" }));
  const v2 = await repo.publish("test_program");

  assert.equal(v2.version, 2);
  assert.equal(v2.status, "published");
  assert.equal(v2.isCurrent, true);

  // v1 must no longer be current
  const v1 = await repo.getVersion("test_program", 1);
  assert.ok(v1);
  assert.equal(v1.isCurrent, false);

  // Only one current entry
  const history = await repo.getHistory("test_program");
  const currentEntries = history.filter((e) => e.isCurrent);
  assert.equal(currentEntries.length, 1);
});

test("getHistory returns versions newest-first", async () => {
  resetCatalogRepo();
  const repo = await getCatalogRepo();

  await repo.upsertDraft(makeInput({ name: "v1" }));
  await repo.publish("test_program");
  await repo.upsertDraft(makeInput({ name: "v2" }));
  await repo.publish("test_program");
  await repo.upsertDraft(makeInput({ name: "v3" }));
  await repo.publish("test_program");

  const history = await repo.getHistory("test_program");
  assert.equal(history.length, 3);
  assert.equal(history[0]!.version, 3);
  assert.equal(history[1]!.version, 2);
  assert.equal(history[2]!.version, 1);
});

test("getVersion fetches a specific version", async () => {
  resetCatalogRepo();
  const repo = await getCatalogRepo();

  await repo.upsertDraft(makeInput({ name: "original" }));
  await repo.publish("test_program");
  await repo.upsertDraft(makeInput({ name: "updated" }));
  await repo.publish("test_program");

  const v1 = await repo.getVersion("test_program", 1);
  assert.ok(v1);
  assert.equal(v1.name, "original");
  assert.equal(v1.version, 1);
});

test("getVersion returns null for non-existent version", async () => {
  resetCatalogRepo();
  const repo = await getCatalogRepo();
  assert.equal(await repo.getVersion("test_program", 99), null);
});

test("publish throws when no draft exists", async () => {
  resetCatalogRepo();
  const repo = await getCatalogRepo();
  await assert.rejects(() => repo.publish("test_program"), /No draft found/);
});

// ─── Status queries ──────────────────────────────────────────────────────────

test("listByStatus returns only entries with that status", async () => {
  resetCatalogRepo();
  const repo = await getCatalogRepo();

  await repo.upsertDraft(makeInput({ programId: "prog_a" }));
  await repo.upsertDraft(makeInput({ programId: "prog_b" }));
  await repo.publish("prog_a");

  const drafts = await repo.listByStatus("draft");
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0]!.programId, "prog_b");

  const published = await repo.listByStatus("published");
  assert.equal(published.length, 1);
  assert.equal(published[0]!.programId, "prog_a");
});

test("listPublished returns current published entries", async () => {
  resetCatalogRepo();
  const repo = await getCatalogRepo();

  await repo.upsertDraft(makeInput({ programId: "prog_a", region: "Global" }));
  await repo.publish("prog_a");
  await repo.upsertDraft(makeInput({ programId: "prog_b", region: "CZ" }));
  await repo.publish("prog_b");
  await repo.upsertDraft(makeInput({ programId: "prog_c" }));
  // prog_c left as draft — must not appear

  const all = await repo.listPublished();
  assert.equal(all.length, 2);

  const cz = await repo.listPublished("CZ");
  // CZ filter returns CZ entries + Global entries
  assert.equal(cz.length, 2);
  assert.ok(cz.some((e) => e.programId === "prog_b"));
  assert.ok(cz.some((e) => e.programId === "prog_a"), "Global entries must appear in regional filter");

  const us = await repo.listPublished("US");
  // No US-specific entries, but Global still matches
  assert.equal(us.length, 1);
  assert.equal(us[0]!.region, "Global");
});

// ─── archive ────────────────────────────────────────────────────────────────

test("archive marks current entry as archived and not current", async () => {
  resetCatalogRepo();
  const repo = await getCatalogRepo();

  await repo.upsertDraft(makeInput());
  await repo.publish("test_program");
  await repo.archive("test_program");

  const current = await repo.getCurrent("test_program");
  assert.equal(current, null, "No current entry after archive");

  const v1 = await repo.getVersion("test_program", 1);
  assert.ok(v1);
  assert.equal(v1.status, "archived");
  assert.equal(v1.isCurrent, false);
  assert.ok(v1.archivedAt);
});

test("archive is a no-op when no current entry exists", async () => {
  resetCatalogRepo();
  const repo = await getCatalogRepo();
  await assert.doesNotReject(() => repo.archive("nonexistent"));
});

// ─── seedIfEmpty ─────────────────────────────────────────────────────────────

test("seedIfEmpty seeds all static programs as published", async () => {
  resetCatalogRepo();
  const repo = await getCatalogRepo();

  const inputs = PROGRAMS.map(programToCatalogInput);
  const result = await repo.seedIfEmpty(inputs);

  assert.equal(result.seeded, PROGRAMS.length);
  assert.equal(result.skipped, 0);

  const published = await repo.listPublished();
  assert.equal(published.length, PROGRAMS.length);
  for (const entry of published) {
    assert.equal(entry.status, "published");
    assert.equal(entry.isCurrent, true);
    assert.equal(entry.version, 1);
    assert.equal(entry.provenance.source, "manual-seed");
  }
});

test("seedIfEmpty is idempotent — skips already-seeded programs", async () => {
  resetCatalogRepo();
  const repo = await getCatalogRepo();

  const inputs = PROGRAMS.map(programToCatalogInput);
  await repo.seedIfEmpty(inputs);
  const result2 = await repo.seedIfEmpty(inputs);

  assert.equal(result2.seeded, 0);
  assert.equal(result2.skipped, PROGRAMS.length);

  // Still only one published entry per program
  const published = await repo.listPublished();
  assert.equal(published.length, PROGRAMS.length);
});

// ─── Field mapping: CatalogEntryDoc mirrors Program ─────────────────────────

test("seeded entries preserve all Program fields (spot-check booking_genius)", async () => {
  resetCatalogRepo();
  const repo = await getCatalogRepo();

  const program = getProgram("booking_genius")!;
  await repo.seedIfEmpty([programToCatalogInput(program)]);

  const entry = await repo.getCurrent("booking_genius");
  assert.ok(entry);
  assert.equal(entry.name, program.name);
  assert.equal(entry.category, program.category);
  assert.deepEqual(entry.tiers, program.tiers);
  assert.deepEqual(entry.fields, program.fields);
  assert.deepEqual(entry.defaultMatch, program.defaultMatch);
  assert.deepEqual(entry.benefits, program.benefits);
  assert.equal(entry.region, program.region);
  assert.equal(entry.provenance.sourceUrl, program.sourceUrl);
  assert.equal(entry.provenance.asOf, program.asOf);
});

test("seeded catalog entries contain no price-related keys", async () => {
  resetCatalogRepo();
  const repo = await getCatalogRepo();
  await repo.seedIfEmpty(PROGRAMS.map(programToCatalogInput));

  const published = await repo.listPublished();
  const priceKeys = ["nightlyAmount", "totalAmount", "priceOff"];
  for (const entry of published) {
    const serialised = JSON.stringify(entry);
    for (const key of priceKeys) {
      assert.ok(!serialised.includes(`"${key}"`), `${entry.programId}: catalog entry must not contain '${key}'`);
    }
  }
});

// ─── Round-trip: ALL programs ────────────────────────────────────────────────

test("programToCatalogInput → catalogEntryToProgram round-trips all static programs", () => {
  for (const original of PROGRAMS) {
    const input = programToCatalogInput(original);
    const doc = {
      ...input,
      id: `${input.programId}#v1`,
      version: 1 as const,
      isCurrent: true,
      status: "published" as const,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      publishedAt: new Date().toISOString(),
    };
    const roundTripped = catalogEntryToProgram(doc);

    assert.equal(roundTripped.id, original.id, `${original.id}: id`);
    assert.equal(roundTripped.name, original.name, `${original.id}: name`);
    assert.equal(roundTripped.category, original.category, `${original.id}: category`);
    assert.deepEqual(roundTripped.defaultMatch, original.defaultMatch, `${original.id}: defaultMatch`);
    assert.deepEqual(roundTripped.benefits, original.benefits, `${original.id}: benefits`);
    assert.equal(roundTripped.requiresCredential, original.requiresCredential, `${original.id}: requiresCredential`);
  }
});

// ─── Full lifecycle: archive → re-draft → re-publish ────────────────────────

test("archive then re-publish creates a new version with correct numbering", async () => {
  resetCatalogRepo();
  const repo = await getCatalogRepo();

  // v1: publish
  await repo.upsertDraft(makeInput({ name: "v1" }));
  await repo.publish("test_program");

  // archive v1
  await repo.archive("test_program");
  assert.equal(await repo.getCurrent("test_program"), null);

  // v2: new draft after archive
  await repo.upsertDraft(makeInput({ name: "v2" }));
  const v2 = await repo.publish("test_program");

  assert.equal(v2.version, 2, "post-archive publish must be v2");
  assert.equal(v2.status, "published");
  assert.equal(v2.isCurrent, true);

  const history = await repo.getHistory("test_program");
  assert.equal(history.length, 2);
  assert.equal(history.filter((e) => e.isCurrent).length, 1, "exactly one current entry");
});

// ─── getHistory edge cases ───────────────────────────────────────────────────

test("getHistory returns empty array for an unknown program", async () => {
  resetCatalogRepo();
  const repo = await getCatalogRepo();
  const history = await repo.getHistory("does_not_exist");
  assert.deepEqual(history, []);
});

// ─── listByStatus edge cases ─────────────────────────────────────────────────

test("listByStatus returns empty array when no entries match the status", async () => {
  resetCatalogRepo();
  const repo = await getCatalogRepo();
  const result = await repo.listByStatus("in-review");
  assert.deepEqual(result, []);
});

test("listByStatus(archived) returns entries archived via archive()", async () => {
  resetCatalogRepo();
  const repo = await getCatalogRepo();

  await repo.upsertDraft(makeInput({ programId: "prog_a" }));
  await repo.publish("prog_a");
  await repo.archive("prog_a");

  const archived = await repo.listByStatus("archived");
  assert.equal(archived.length, 1);
  assert.equal(archived[0]!.programId, "prog_a");
  assert.equal(archived[0]!.status, "archived");
});

// ─── Price-field guard (comprehensive) ──────────────────────────────────────

test("price-field guard: CatalogEntryInput must not carry any price or money fields", () => {
  const priceKeys = [
    "price", "nightlyAmount", "totalAmount", "priceOff", "memberPrice",
    "finalPrice", "discountedPrice", "amount", "rateAmount", "hotelPrice",
  ];
  for (const program of PROGRAMS) {
    const input = programToCatalogInput(program);
    const serialised = JSON.stringify(input);
    for (const key of priceKeys) {
      assert.ok(
        !serialised.includes(`"${key}"`),
        `${program.id}: CatalogEntryInput must not contain price field '${key}'`,
      );
    }
  }
});
