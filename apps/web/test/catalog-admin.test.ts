import { test } from "node:test";
import assert from "node:assert/strict";
import type { CatalogEntry, CatalogEntryInput } from "../lib/api";

// Pure utility functions extracted from the catalog admin UI logic.
// These are tested independently of React rendering.

// ─── Status badge color ───────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-yellow-100 text-yellow-800",
  "in-review": "bg-blue-100 text-blue-800",
  published: "bg-green-100 text-green-800",
  archived: "bg-gray-100 text-gray-600",
};

function statusColor(status: string): string {
  return STATUS_COLORS[status] ?? "bg-gray-100 text-gray-600";
}

test("statusColor: draft gets yellow", () => {
  assert.ok(statusColor("draft").includes("yellow"));
});
test("statusColor: published gets green", () => {
  assert.ok(statusColor("published").includes("green"));
});
test("statusColor: archived gets gray", () => {
  assert.ok(statusColor("archived").includes("gray"));
});
test("statusColor: unknown status falls back to gray", () => {
  assert.ok(statusColor("unknown-xyz").includes("gray"));
});

// ─── Tiers parsing ────────────────────────────────────────────────────────────

function parseTiersInput(raw: string): string[] {
  return raw ? raw.split(",").map((t) => t.trim()).filter(Boolean) : [];
}

test("parseTiersInput: splits comma-separated tiers", () => {
  assert.deepEqual(parseTiersInput("Level 1, Level 2, Level 3"), ["Level 1", "Level 2", "Level 3"]);
});
test("parseTiersInput: trims whitespace", () => {
  assert.deepEqual(parseTiersInput("  Gold ,  Platinum "), ["Gold", "Platinum"]);
});
test("parseTiersInput: empty string yields empty array", () => {
  assert.deepEqual(parseTiersInput(""), []);
});
test("parseTiersInput: filters blank entries", () => {
  assert.deepEqual(parseTiersInput("Gold,,Platinum"), ["Gold", "Platinum"]);
});

// ─── Entry to input conversion ────────────────────────────────────────────────

function entryToInput(entry: CatalogEntry): CatalogEntryInput {
  return {
    programId: entry.programId,
    name: entry.name,
    category: entry.category,
    region: entry.region,
    requiresCredential: entry.requiresCredential,
    provenance: entry.provenance,
    defaultMatch: entry.defaultMatch,
    tiers: entry.tiers,
    fields: entry.fields,
    benefits: entry.benefits,
  };
}

function makeEntry(overrides: Partial<CatalogEntry> = {}): CatalogEntry {
  return {
    id: "booking_genius#v1",
    programId: "booking_genius",
    version: 1,
    isCurrent: true,
    status: "published",
    provenance: { source: "manual-seed", asOf: "2026-05" },
    region: "Global",
    name: "Booking.com Genius",
    category: "ota",
    defaultMatch: { domains: ["booking.com"] },
    tiers: ["Level 1", "Level 2", "Level 3"],
    requiresCredential: false,
    fields: [],
    benefits: { "Level 1": [{ scope: "domain", value: { kind: "percentDiscount", percentOff: 0.1 } }] },
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

test("entryToInput: strips Cosmos fields", () => {
  const entry = makeEntry();
  const input = entryToInput(entry);
  assert.equal("id" in input, false, "id should not be in input");
  assert.equal("version" in input, false, "version should not be in input");
  assert.equal("isCurrent" in input, false, "isCurrent should not be in input");
  assert.equal("status" in input, false, "status should not be in input");
  assert.equal("createdAt" in input, false, "createdAt should not be in input");
});

test("entryToInput: preserves name, category, region", () => {
  const entry = makeEntry({ name: "Test", category: "hotel", region: "CZ" });
  const input = entryToInput(entry);
  assert.equal(input.name, "Test");
  assert.equal(input.category, "hotel");
  assert.equal(input.region, "CZ");
});

test("entryToInput: preserves benefits without modification", () => {
  const entry = makeEntry();
  const input = entryToInput(entry);
  assert.deepEqual(input.benefits, entry.benefits);
  // Verify no price fields slipped in
  const raw = JSON.stringify(input);
  assert.ok(!raw.includes("nightlyAmount"), "no nightlyAmount in input");
  assert.ok(!raw.includes("totalAmount"), "no totalAmount in input");
  assert.ok(!raw.includes("memberPrice"), "no memberPrice in input");
  assert.ok(!raw.includes("finalPrice"), "no finalPrice in input");
});

// ─── Version history display helpers ─────────────────────────────────────────

function versionLabel(entry: CatalogEntry): string {
  if (entry.publishedAt) return `Published ${new Date(entry.publishedAt).toLocaleDateString()}`;
  if (entry.archivedAt) return `Archived ${new Date(entry.archivedAt).toLocaleDateString()}`;
  return `Updated ${new Date(entry.updatedAt).toLocaleDateString()}`;
}

test("versionLabel: shows published date when available", () => {
  const entry = makeEntry({ publishedAt: "2026-05-01T00:00:00Z" });
  assert.ok(versionLabel(entry).startsWith("Published"));
});
test("versionLabel: shows archived date when publishedAt absent", () => {
  const entry = makeEntry({ publishedAt: undefined, archivedAt: "2026-06-01T00:00:00Z" });
  assert.ok(versionLabel(entry).startsWith("Archived"));
});
test("versionLabel: falls back to updatedAt", () => {
  const entry = makeEntry({ publishedAt: undefined, archivedAt: undefined, updatedAt: "2026-04-01T00:00:00Z" });
  assert.ok(versionLabel(entry).startsWith("Updated"));
});

// ─── No-price invariant ───────────────────────────────────────────────────────

test("catalog entry types do not have price fields", () => {
  const entry = makeEntry();
  const raw = JSON.stringify(entry);
  assert.ok(!raw.includes("nightlyAmount"), "no nightlyAmount");
  assert.ok(!raw.includes("totalAmount"), "no totalAmount");
  assert.ok(!raw.includes("memberPrice"), "no memberPrice");
  assert.ok(!raw.includes("finalPrice"), "no finalPrice");
  assert.ok(!raw.includes("indicativePrice"), "no indicativePrice");
});
