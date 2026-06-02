import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

const ADMIN_SECRET = "test-admin-secret-76";

before(() => {
  process.env.TRUERATE_INMEMORY = "true";
  process.env.TRUERATE_JWT_SECRET = "catalog-admin-test-secret";
  process.env.TRUERATE_CRED_KEY = randomBytes(32).toString("base64");
  process.env.ADMIN_SECRET = ADMIN_SECRET;
});

async function getApp() {
  const { app } = await import("../src/app.js");
  return app;
}

beforeEach(async () => {
  const { resetAppCatalog } = await import("../src/app.js");
  const { resetCatalogRepo } = await import("@truerate/core");
  resetAppCatalog();
  resetCatalogRepo();
});

const adminHeader = { "x-admin-secret": ADMIN_SECRET };
const JSON_CT = { "Content-Type": "application/json" };

// Minimal valid catalog entry input for creating a draft
const sampleEntry = {
  programId: "test_program",
  provenance: { source: "manual-seed", asOf: "2026-05", sourceUrl: "https://example.com/terms" },
  region: "CZ",
  name: "Test Program",
  category: "hotel",
  defaultMatch: { domains: ["testhotel.com"] },
  tiers: ["Standard", "Premium"],
  requiresCredential: false,
  fields: [{ key: "tier", label: "Tier", type: "select", options: ["Standard", "Premium"] }],
  benefits: {
    Standard: [{ scope: "domain", value: { kind: "percentDiscount", percentOff: 0.1 } }],
    Premium: [{ scope: "domain", value: { kind: "percentDiscount", percentOff: 0.2 } }],
  },
};

// ─── Auth guard ──────────────────────────────────────────────────────────────

test("GET /admin/catalog — 401 without admin secret", async () => {
  const app = await getApp();
  const res = await app.request("/admin/catalog");
  assert.equal(res.status, 401);
  const body = await res.json();
  assert.equal(body.error, "unauthorized");
});

test("GET /admin/catalog — 401 with wrong admin secret", async () => {
  const app = await getApp();
  const res = await app.request("/admin/catalog", {
    headers: { "x-admin-secret": "wrong-secret" },
  });
  assert.equal(res.status, 401);
});

// ─── List ────────────────────────────────────────────────────────────────────

test("GET /admin/catalog — returns seeded published programs", async () => {
  const app = await getApp();
  // trigger seeding by calling the public catalog endpoint first
  await app.request("/catalog/programs");

  const res = await app.request("/admin/catalog", { headers: adminHeader });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(Array.isArray(body.entries), "entries is an array");
  assert.ok(body.entries.length > 0, "at least one entry");
  assert.equal(typeof body.count, "number");
});

test("GET /admin/catalog?status=published — returns only published entries", async () => {
  const app = await getApp();
  await app.request("/catalog/programs"); // seed
  const res = await app.request("/admin/catalog?status=published", { headers: adminHeader });
  assert.equal(res.status, 200);
  const { entries } = await res.json();
  for (const e of entries) {
    assert.equal(e.status, "published", `${e.programId} should be published`);
  }
});

test("GET /admin/catalog?status=draft — empty when no drafts exist", async () => {
  const app = await getApp();
  await app.request("/catalog/programs"); // seed
  const res = await app.request("/admin/catalog?status=draft", { headers: adminHeader });
  assert.equal(res.status, 200);
  const { entries } = await res.json();
  assert.equal(entries.length, 0, "no drafts initially");
});

// ─── Create draft ────────────────────────────────────────────────────────────

test("POST /admin/catalog — creates a new draft", async () => {
  const app = await getApp();
  const res = await app.request("/admin/catalog", {
    method: "POST",
    headers: { ...adminHeader, ...JSON_CT },
    body: JSON.stringify(sampleEntry),
  });
  assert.equal(res.status, 201);
  const { entry } = await res.json();
  assert.equal(entry.programId, "test_program");
  assert.equal(entry.status, "draft");
  assert.equal(entry.isCurrent, false);
  assert.equal(entry.name, "Test Program");
  assert.equal(entry.region, "CZ");
  assert.equal(entry.version, 1);
});

test("POST /admin/catalog — 400 on missing required fields", async () => {
  const app = await getApp();
  const res = await app.request("/admin/catalog", {
    method: "POST",
    headers: { ...adminHeader, ...JSON_CT },
    body: JSON.stringify({ programId: "incomplete" }),
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error, "validation_failed");
});

test("POST /admin/catalog — draft does not appear in public /catalog/programs", async () => {
  const app = await getApp();
  // Create a draft for a brand-new programId
  await app.request("/admin/catalog", {
    method: "POST",
    headers: { ...adminHeader, ...JSON_CT },
    body: JSON.stringify(sampleEntry),
  });

  // Public endpoint must NOT include the unpublished draft
  const res = await app.request("/catalog/programs");
  const { programs } = await res.json();
  const found = programs.find((p: { programId: string }) => p.programId === "test_program");
  assert.equal(found, undefined, "draft must not appear in public catalog");
});

// ─── Update draft ────────────────────────────────────────────────────────────

test("PUT /admin/catalog/:id — updates an existing draft", async () => {
  const app = await getApp();
  // Create draft first
  await app.request("/admin/catalog", {
    method: "POST",
    headers: { ...adminHeader, ...JSON_CT },
    body: JSON.stringify(sampleEntry),
  });

  const updated = { ...sampleEntry, name: "Updated Test Program", region: "Global" };
  const res = await app.request("/admin/catalog/test_program", {
    method: "PUT",
    headers: { ...adminHeader, ...JSON_CT },
    body: JSON.stringify(updated),
  });
  assert.equal(res.status, 200);
  const { entry } = await res.json();
  assert.equal(entry.name, "Updated Test Program");
  assert.equal(entry.region, "Global");
  assert.equal(entry.status, "draft");
  assert.equal(entry.version, 1, "update keeps same draft version");
});

test("PUT /admin/catalog/:id — 400 when programId in body mismatches URL", async () => {
  const app = await getApp();
  const res = await app.request("/admin/catalog/different_id", {
    method: "PUT",
    headers: { ...adminHeader, ...JSON_CT },
    body: JSON.stringify(sampleEntry),
  });
  assert.equal(res.status, 400);
});

// ─── Get single entry ────────────────────────────────────────────────────────

test("GET /admin/catalog/:id — returns current entry", async () => {
  const app = await getApp();
  await app.request("/catalog/programs"); // seed booking_genius

  const res = await app.request("/admin/catalog/booking_genius", { headers: adminHeader });
  assert.equal(res.status, 200);
  const { entry } = await res.json();
  assert.equal(entry.programId, "booking_genius");
});

test("GET /admin/catalog/:id — 404 for unknown programId", async () => {
  const app = await getApp();
  const res = await app.request("/admin/catalog/does_not_exist_zz", { headers: adminHeader });
  assert.equal(res.status, 404);
  assert.equal((await res.json()).error, "not_found");
});

// ─── Publish ─────────────────────────────────────────────────────────────────

test("POST /admin/catalog/:id/publish — publishes a draft and appears in public catalog", async () => {
  const app = await getApp();

  // Create draft
  await app.request("/admin/catalog", {
    method: "POST",
    headers: { ...adminHeader, ...JSON_CT },
    body: JSON.stringify(sampleEntry),
  });

  // Publish
  const pubRes = await app.request("/admin/catalog/test_program/publish", {
    method: "POST",
    headers: adminHeader,
  });
  assert.equal(pubRes.status, 200);
  const { entry } = await pubRes.json();
  assert.equal(entry.status, "published");
  assert.equal(entry.isCurrent, true);
  assert.ok(entry.publishedAt, "publishedAt is set");

  // Verify channels can now see it (cache invalidated by publish)
  const pubCatalogRes = await app.request("/catalog/programs");
  const { programs } = await pubCatalogRes.json();
  const found = programs.find((p: { programId: string }) => p.programId === "test_program");
  assert.ok(found, "published entry visible to channels");
  assert.equal(found.status, "published");
});

test("POST /admin/catalog/:id/publish — 400 when no draft exists", async () => {
  const app = await getApp();
  await app.request("/catalog/programs"); // seed — all are published, no drafts

  const res = await app.request("/admin/catalog/booking_genius/publish", {
    method: "POST",
    headers: adminHeader,
  });
  // booking_genius is already published, no draft to publish
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.ok(body.error, "error message present");
});

test("published entry contains no price fields", async () => {
  const app = await getApp();
  await app.request("/admin/catalog", {
    method: "POST",
    headers: { ...adminHeader, ...JSON_CT },
    body: JSON.stringify(sampleEntry),
  });
  const pubRes = await app.request("/admin/catalog/test_program/publish", {
    method: "POST",
    headers: adminHeader,
  });
  const raw = JSON.stringify(await pubRes.json());
  assert.ok(!raw.includes("nightlyAmount"), "no nightlyAmount");
  assert.ok(!raw.includes("totalAmount"), "no totalAmount");
  assert.ok(!raw.includes("memberPrice"), "no memberPrice");
  assert.ok(!raw.includes("finalPrice"), "no finalPrice");
});

// ─── Version history ─────────────────────────────────────────────────────────

test("GET /admin/catalog/:id/history — returns all versions newest first", async () => {
  const app = await getApp();
  await app.request("/catalog/programs"); // seed booking_genius v1

  // Create a draft (v2)
  await app.request("/admin/catalog", {
    method: "POST",
    headers: { ...adminHeader, ...JSON_CT },
    body: JSON.stringify({ ...sampleEntry, programId: "booking_genius", name: "Booking Genius v2 Draft" }),
  });

  const res = await app.request("/admin/catalog/booking_genius/history", { headers: adminHeader });
  assert.equal(res.status, 200);
  const { history } = await res.json();
  assert.ok(Array.isArray(history), "history is array");
  assert.ok(history.length >= 2, "at least 2 versions");
  assert.equal(history[0].version, 2, "newest version is first");
  assert.equal(history[1].version, 1, "oldest version is last");
});

test("GET /admin/catalog/:id/history — 404 for unknown program", async () => {
  const app = await getApp();
  const res = await app.request("/admin/catalog/does_not_exist_zz/history", { headers: adminHeader });
  assert.equal(res.status, 404);
});

// ─── Restore version ─────────────────────────────────────────────────────────

test("POST /admin/catalog/:id/restore/:version — restores an older version as a new draft", async () => {
  const app = await getApp();
  await app.request("/catalog/programs"); // seed booking_genius v1 (published)

  // Create and publish a v2 draft with changed name
  await app.request("/admin/catalog", {
    method: "POST",
    headers: { ...adminHeader, ...JSON_CT },
    body: JSON.stringify({ ...sampleEntry, programId: "booking_genius", name: "Booking Genius Updated" }),
  });
  await app.request("/admin/catalog/booking_genius/publish", {
    method: "POST",
    headers: adminHeader,
  });

  // Restore v1
  const restoreRes = await app.request("/admin/catalog/booking_genius/restore/1", {
    method: "POST",
    headers: adminHeader,
  });
  assert.equal(restoreRes.status, 201);
  const { entry } = await restoreRes.json();
  assert.equal(entry.status, "draft");
  assert.equal(entry.version, 3, "restore creates a new draft version");
  // The content should come from v1 (original seeded booking_genius name)
  assert.ok(entry.name !== "Booking Genius Updated", "restored content differs from v2");
});

test("POST /admin/catalog/:id/restore/:version — 404 for non-existent version", async () => {
  const app = await getApp();
  await app.request("/catalog/programs"); // seed
  const res = await app.request("/admin/catalog/booking_genius/restore/999", {
    method: "POST",
    headers: adminHeader,
  });
  assert.equal(res.status, 404);
  assert.equal((await res.json()).error, "version_not_found");
});

// ─── Archive (DELETE) ────────────────────────────────────────────────────────

test("DELETE /admin/catalog/:id — archives the current entry", async () => {
  const app = await getApp();
  await app.request("/catalog/programs"); // seed

  const res = await app.request("/admin/catalog/booking_genius", {
    method: "DELETE",
    headers: adminHeader,
  });
  assert.equal(res.status, 204);

  // Should no longer be in public catalog
  const pubRes = await app.request("/catalog/programs");
  const { programs } = await pubRes.json();
  const found = programs.find((p: { programId: string }) => p.programId === "booking_genius");
  assert.equal(found, undefined, "archived entry not in public catalog");
});

test("DELETE /admin/catalog/:id — 404 for unknown program", async () => {
  const app = await getApp();
  const res = await app.request("/admin/catalog/does_not_exist_zz", {
    method: "DELETE",
    headers: adminHeader,
  });
  assert.equal(res.status, 404);
});
