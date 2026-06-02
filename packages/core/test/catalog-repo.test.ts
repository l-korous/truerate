import { test } from "node:test";
import assert from "node:assert/strict";
import { MemoryCatalogRepo, toCatalogProgram } from "../src/catalog-repo.js";
import { PROGRAMS, getProgram } from "../src/programs.js";
import type { Program } from "../src/types.js";

// ─── toCatalogProgram ─────────────────────────────────────────────────────────

test("toCatalogProgram carries all Program fields", () => {
  const program = getProgram("booking_genius")!;
  const doc = toCatalogProgram(program);

  // All top-level Program fields must be present
  assert.equal(doc.id, program.id);
  assert.equal(doc.name, program.name);
  assert.equal(doc.category, program.category);
  assert.deepEqual(doc.defaultMatch, program.defaultMatch);
  assert.deepEqual(doc.tiers, program.tiers);
  assert.deepEqual(doc.fields, program.fields);
  assert.equal(doc.requiresCredential, program.requiresCredential);
  assert.equal(doc.sourceUrl, program.sourceUrl);
  assert.equal(doc.region, program.region);
});

test("toCatalogProgram sets default lifecycle metadata", () => {
  const program = getProgram("accor_all")!;
  const doc = toCatalogProgram(program);

  assert.equal(doc.status, "published");
  assert.equal(doc.provenance, "manual-seed");
  assert.equal(doc.version, program.asOf);
  assert.ok(doc.updatedAt, "updatedAt must be set");
  // updatedAt must be a valid ISO string
  assert.ok(!isNaN(Date.parse(doc.updatedAt)));
});

test("toCatalogProgram accepts override status and provenance", () => {
  const program = getProgram("hilton_honors")!;
  const doc = toCatalogProgram(program, { status: "draft", provenance: "admin-edit" });

  assert.equal(doc.status, "draft");
  assert.equal(doc.provenance, "admin-edit");
});

test("toCatalogProgram falls back to 'unknown' version when asOf is absent", () => {
  const program: Program = { ...getProgram("booking_genius")!, asOf: undefined };
  const doc = toCatalogProgram(program);
  assert.equal(doc.version, "unknown");
});

// ─── MemoryCatalogRepo ────────────────────────────────────────────────────────

test("upsert stores and getById retrieves a record", async () => {
  const repo = new MemoryCatalogRepo();
  await repo.init();

  const doc = toCatalogProgram(getProgram("booking_genius")!);
  await repo.upsert(doc);

  const retrieved = await repo.getById("booking_genius");
  assert.ok(retrieved);
  assert.equal(retrieved.id, "booking_genius");
  assert.equal(retrieved.status, "published");
  assert.equal(retrieved.provenance, "manual-seed");
});

test("getById returns null for unknown id", async () => {
  const repo = new MemoryCatalogRepo();
  await repo.init();
  assert.equal(await repo.getById("does-not-exist"), null);
});

test("getAll returns every upserted record", async () => {
  const repo = new MemoryCatalogRepo();
  await repo.init();

  const docs = PROGRAMS.map((p) => toCatalogProgram(p));
  await repo.upsertMany(docs);

  const all = await repo.getAll();
  assert.equal(all.length, PROGRAMS.length);

  const ids = new Set(all.map((d) => d.id));
  for (const p of PROGRAMS) assert.ok(ids.has(p.id), `missing ${p.id}`);
});

test("getAll filters by status", async () => {
  const repo = new MemoryCatalogRepo();
  await repo.init();

  await repo.upsert(toCatalogProgram(getProgram("booking_genius")!, { status: "published" }));
  await repo.upsert(toCatalogProgram(getProgram("accor_all")!, { status: "draft" }));

  const published = await repo.getAll("published");
  assert.equal(published.length, 1);
  assert.equal(published[0].id, "booking_genius");

  const draft = await repo.getAll("draft");
  assert.equal(draft.length, 1);
  assert.equal(draft[0].id, "accor_all");
});

test("upsert is idempotent — re-running does not duplicate", async () => {
  const repo = new MemoryCatalogRepo();
  await repo.init();

  const doc = toCatalogProgram(getProgram("hilton_honors")!);
  await repo.upsert(doc);
  await repo.upsert(doc); // second run
  await repo.upsert(doc); // third run

  const all = await repo.getAll();
  assert.equal(all.length, 1);
});

test("upsert overwrites changed fields", async () => {
  const repo = new MemoryCatalogRepo();
  await repo.init();

  const doc = toCatalogProgram(getProgram("hilton_honors")!);
  await repo.upsert(doc);

  const updated = { ...doc, status: "archived" as const };
  await repo.upsert(updated);

  const retrieved = await repo.getById("hilton_honors");
  assert.equal(retrieved?.status, "archived");
});

// ─── Round-trip fidelity ──────────────────────────────────────────────────────

test("every Program from the catalog round-trips via upsert without loss", async () => {
  const repo = new MemoryCatalogRepo();
  await repo.init();

  for (const program of PROGRAMS) {
    const doc = toCatalogProgram(program);
    await repo.upsert(doc);
    const retrieved = await repo.getById(program.id);
    assert.ok(retrieved, `${program.id} not found after upsert`);
    // Core Program fields must be preserved exactly
    assert.equal(retrieved.name, program.name);
    assert.equal(retrieved.category, program.category);
    assert.equal(retrieved.region, program.region);
    assert.equal(retrieved.asOf, program.asOf);
    assert.equal(retrieved.sourceUrl, program.sourceUrl);
    assert.deepEqual(retrieved.defaultMatch, program.defaultMatch);
    assert.deepEqual(retrieved.tiers, program.tiers);
    assert.deepEqual(retrieved.fields, program.fields);
    assert.equal(retrieved.requiresCredential, program.requiresCredential);
    // Verify benefits keys are preserved
    assert.deepEqual(Object.keys(retrieved.benefits).sort(), Object.keys(program.benefits).sort());
  }
});

test("seeded records carry provenance=manual-seed and status=published", async () => {
  const repo = new MemoryCatalogRepo();
  await repo.init();

  const docs = PROGRAMS.map((p) => toCatalogProgram(p, { provenance: "manual-seed", status: "published" }));
  await repo.upsertMany(docs);

  const all = await repo.getAll();
  for (const doc of all) {
    assert.equal(doc.provenance, "manual-seed");
    assert.equal(doc.status, "published");
  }
});
