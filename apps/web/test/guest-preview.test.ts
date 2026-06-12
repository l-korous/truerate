import { test } from "node:test";
import assert from "node:assert/strict";
import type { CatalogEntry } from "../lib/api";

// Pure utility functions extracted from GuestPreview and BulkImportPage.
// These are tested independently of React rendering.

// ─── formatGuestPreviewLines ──────────────────────────────────────────────────
// Inlined here to avoid a React import in the test runner.

function headlineDiscount(templates: CatalogEntry["benefits"][string]): number | null {
  for (const t of templates) {
    if (t.value.kind === "percentDiscount" && t.value.percentOff) {
      return Math.round(t.value.percentOff * 100);
    }
  }
  return null;
}

function collectPerks(templates: CatalogEntry["benefits"][string]): string[] {
  const out: string[] = [];
  for (const t of templates) {
    if (t.value.perks) out.push(...t.value.perks);
  }
  return [...new Set(out)];
}

function formatGuestPreviewLines(entry: CatalogEntry): string[] {
  const realizationUrl = entry.realizationUrl ?? "";
  const tiers = Object.keys(entry.benefits);
  if (tiers.length === 0) return ["(no benefits defined)"];

  const lines: string[] = [];

  for (const tier of tiers) {
    const templates = entry.benefits[tier] ?? [];
    const pct = headlineDiscount(templates);
    const perks = collectPerks(templates);
    const tierLabel = tier === "*" ? "" : ` (${tier})`;

    if (pct !== null) {
      const who = entry.openToAnyone ? "Anyone can" : "Members";
      const verb = entry.openToAnyone ? "register and save" : "save";
      const bookPart = realizationUrl
        ? `book direct at ${realizationUrl}`
        : "book direct";
      lines.push(`${who} ${verb} ${pct}%${tierLabel} — ${bookPart}`);
    } else if (perks.length > 0) {
      const bookPart = realizationUrl
        ? `book direct at ${realizationUrl}`
        : "book direct";
      lines.push(`Members get: ${perks.join(", ")}${tierLabel} — ${bookPart}`);
    }
  }

  return lines.length > 0 ? lines : [`(no discount or perks — ${realizationUrl || "(no realization URL set)"})`];
}

function makeEntry(overrides: Partial<CatalogEntry> = {}): CatalogEntry {
  return {
    id: "test-v1",
    programId: "test_hotel",
    version: 1,
    isCurrent: true,
    status: "published",
    provenance: { source: "manual-seed", asOf: "2026-05" },
    region: "CZ",
    name: "Test Hotel Loyalty",
    category: "hotel",
    defaultMatch: {},
    tiers: [],
    requiresCredential: false,
    fields: [],
    benefits: {
      "*": [{ scope: "domain", value: { kind: "percentDiscount", percentOff: 0.1 } }],
    },
    realizationUrl: "https://hotel.example.com/book",
    openToAnyone: false,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

test("preview: shows discount % and realization URL", () => {
  const entry = makeEntry();
  const lines = formatGuestPreviewLines(entry);
  assert.equal(lines.length, 1);
  assert.ok(lines[0].includes("10%"), "shows 10%");
  assert.ok(lines[0].includes("https://hotel.example.com/book"), "shows realizationUrl");
  assert.ok(!lines[0].includes("price"), "no 'price' in output");
});

test("preview: uses 'Members save' for regular programs", () => {
  const entry = makeEntry({ openToAnyone: false });
  const lines = formatGuestPreviewLines(entry);
  assert.ok(lines[0].startsWith("Members save"), `expected 'Members save', got: ${lines[0]}`);
});

test("preview: uses 'Anyone can register and save' for open programs", () => {
  const entry = makeEntry({ openToAnyone: true });
  const lines = formatGuestPreviewLines(entry);
  assert.ok(lines[0].startsWith("Anyone can register and save"), `expected open phrasing, got: ${lines[0]}`);
});

test("preview: shows 'book direct' without URL when realizationUrl absent", () => {
  const entry = makeEntry({ realizationUrl: undefined });
  const lines = formatGuestPreviewLines(entry);
  assert.ok(lines[0].includes("book direct"), "says 'book direct'");
  assert.ok(!lines[0].includes("https://"), "no URL in output");
});

test("preview: shows perk-only line when no discount", () => {
  const entry = makeEntry({
    benefits: {
      "*": [{ scope: "domain", value: { kind: "perk", perks: ["Free breakfast", "Late checkout"] } }],
    },
  });
  const lines = formatGuestPreviewLines(entry);
  assert.ok(lines[0].includes("Free breakfast"), "shows perk");
  assert.ok(lines[0].startsWith("Members get:"), `expected 'Members get:', got: ${lines[0]}`);
});

test("preview: returns one line per tier with tiered benefits", () => {
  const entry = makeEntry({
    tiers: ["Standard", "Premium"],
    benefits: {
      Standard: [{ scope: "domain", value: { kind: "percentDiscount", percentOff: 0.1 } }],
      Premium: [{ scope: "domain", value: { kind: "percentDiscount", percentOff: 0.2 } }],
    },
  });
  const lines = formatGuestPreviewLines(entry);
  assert.equal(lines.length, 2);
  assert.ok(lines[0].includes("10%") && lines[0].includes("Standard"));
  assert.ok(lines[1].includes("20%") && lines[1].includes("Premium"));
});

test("preview: no benefits returns placeholder", () => {
  const entry = makeEntry({ benefits: {} });
  const lines = formatGuestPreviewLines(entry);
  assert.equal(lines.length, 1);
  assert.equal(lines[0], "(no benefits defined)");
});

test("preview output never contains price-like words", () => {
  const entry = makeEntry();
  const lines = formatGuestPreviewLines(entry);
  const raw = lines.join(" ");
  assert.ok(!raw.includes("nightlyAmount"), "no nightlyAmount");
  assert.ok(!raw.includes("memberPrice"), "no memberPrice");
  assert.ok(!raw.includes("finalPrice"), "no finalPrice");
});

// ─── parseBulkCsv ─────────────────────────────────────────────────────────────

function parseBulkCsv(raw: string): {
  rows: Array<{
    programId: string;
    name: string;
    category: string;
    region: string;
    discountPercent: number;
    realizationUrl: string;
    sourceUrl: string;
  }>;
  errors: string[];
} {
  const errors: string[] = [];
  const lines = raw.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) {
    return { rows: [], errors: ["CSV must have a header row and at least one data row"] };
  }

  const headers = lines[0].split(",").map((h) => h.trim());
  const required = ["programId", "name", "category", "region", "discountPercent", "realizationUrl", "sourceUrl"];
  for (const col of required) {
    if (!headers.includes(col)) {
      errors.push(`Missing required column: ${col}`);
    }
  }
  if (errors.length > 0) return { rows: [], errors };

  const rows: ReturnType<typeof parseBulkCsv>["rows"] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(",").map((c) => c.trim());
    const obj: Record<string, string> = {};
    headers.forEach((h, idx) => { obj[h] = cells[idx] ?? ""; });

    const pct = Number(obj.discountPercent);
    if (!obj.programId) { errors.push(`Row ${i}: programId is required`); continue; }
    if (!obj.name) { errors.push(`Row ${i}: name is required`); continue; }
    if (isNaN(pct) || pct < 0 || pct > 100) { errors.push(`Row ${i}: discountPercent must be 0-100`); continue; }

    rows.push({
      programId: obj.programId,
      name: obj.name,
      category: obj.category || "hotel",
      region: obj.region || "Global",
      discountPercent: pct,
      realizationUrl: obj.realizationUrl,
      sourceUrl: obj.sourceUrl,
    });
  }

  return { rows, errors };
}

test("parseBulkCsv: parses a valid CSV with one data row", () => {
  const csv = `programId,name,category,region,discountPercent,realizationUrl,sourceUrl
hotel_xyz,Hotel XYZ,hotel,CZ,10,https://hotelxyz.com/book,https://hotelxyz.com/loyalty`;
  const { rows, errors } = parseBulkCsv(csv);
  assert.equal(errors.length, 0, `unexpected errors: ${errors.join(", ")}`);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].programId, "hotel_xyz");
  assert.equal(rows[0].name, "Hotel XYZ");
  assert.equal(rows[0].discountPercent, 10);
  assert.equal(rows[0].realizationUrl, "https://hotelxyz.com/book");
});

test("parseBulkCsv: parses multiple rows", () => {
  const csv = `programId,name,category,region,discountPercent,realizationUrl,sourceUrl
hotel_a,Hotel A,hotel,CZ,10,https://a.com,https://a.com/src
hotel_b,Hotel B,hotel,Global,15,https://b.com,https://b.com/src`;
  const { rows, errors } = parseBulkCsv(csv);
  assert.equal(errors.length, 0);
  assert.equal(rows.length, 2);
  assert.equal(rows[1].programId, "hotel_b");
  assert.equal(rows[1].discountPercent, 15);
});

test("parseBulkCsv: error when CSV has only a header", () => {
  const { rows, errors } = parseBulkCsv("programId,name,category,region,discountPercent,realizationUrl,sourceUrl");
  assert.ok(errors.length > 0, "should have an error");
  assert.equal(rows.length, 0);
});

test("parseBulkCsv: error when required column is missing", () => {
  const csv = `programId,name,category,region,realizationUrl,sourceUrl
hotel_a,Hotel A,hotel,CZ,https://a.com,https://a.com/src`;
  const { errors } = parseBulkCsv(csv);
  assert.ok(errors.some((e) => e.includes("discountPercent")), "should flag missing discountPercent");
});

test("parseBulkCsv: error on invalid discountPercent", () => {
  const csv = `programId,name,category,region,discountPercent,realizationUrl,sourceUrl
hotel_a,Hotel A,hotel,CZ,abc,https://a.com,https://a.com/src`;
  const { rows, errors } = parseBulkCsv(csv);
  assert.ok(errors.some((e) => e.includes("discountPercent")));
  assert.equal(rows.length, 0);
});

test("parseBulkCsv: accepts discountPercent of 0 (perk-only program)", () => {
  const csv = `programId,name,category,region,discountPercent,realizationUrl,sourceUrl
hotel_a,Hotel A,hotel,CZ,0,https://a.com,https://a.com/src`;
  const { rows, errors } = parseBulkCsv(csv);
  assert.equal(errors.length, 0);
  assert.equal(rows[0].discountPercent, 0);
});

test("parseBulkCsv: error when programId is empty", () => {
  const csv = `programId,name,category,region,discountPercent,realizationUrl,sourceUrl
,Hotel A,hotel,CZ,10,https://a.com,https://a.com/src`;
  const { errors } = parseBulkCsv(csv);
  assert.ok(errors.some((e) => e.includes("programId")));
});

test("parseBulkCsv: skips empty lines", () => {
  const csv = `programId,name,category,region,discountPercent,realizationUrl,sourceUrl
hotel_a,Hotel A,hotel,CZ,10,https://a.com,https://a.com/src

hotel_b,Hotel B,hotel,CZ,15,https://b.com,https://b.com/src`;
  const { rows, errors } = parseBulkCsv(csv);
  assert.equal(errors.length, 0);
  assert.equal(rows.length, 2);
});
