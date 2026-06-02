import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

before(() => {
  process.env.TRUERATE_INMEMORY = "true";
  process.env.TRUERATE_JWT_SECRET = "catalog-admin-test-secret";
  process.env.TRUERATE_CRED_KEY = randomBytes(32).toString("base64");
  process.env.ADMIN_SECRET = "test-admin-secret-catalog";
});

const ADMIN_H = { "x-admin-secret": "test-admin-secret-catalog", "Content-Type": "application/json" };
const JSON_H = { "Content-Type": "application/json" };

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

function makeEntry(programId = "test_program") {
  return {
    programId,
    provenance: {
      source: "manual-seed",
      sourceUrl: "https://example.com/program",
      asOf: "2026-01",
    },
    region: "Global",
    name: "Test Program",
    category: "hotel",
    defaultMatch: { brands: ["Test Hotel"] },
    tiers: ["Silver", "Gold"],
    requiresCredential: false,
    fields: [{ key: "member_id", label: "Member ID", type: "text" }],
    benefits: {
      Silver: [{ scope: "brand", match: { brands: ["Test Hotel"] }, value: { kind: "percentDiscount", percentOff: 0.05 } }],
      Gold: [{ scope: "brand", match: { brands: ["Test Hotel"] }, value: { kind: "percentDiscount", percentOff: 0.1 } }],
    },
  };
}

// ─── Auth checks ──────────────────────────────────────────────────────────────

test("admin catalog endpoints return 401 without or with wrong secret", async () => {
  const app = await getApp();
  const routes: { method: string; path: string }[] = [
    { method: "GET", path: "/admin/catalog/programs" },
    { method: "GET", path: "/admin/catalog/programs/some_prog" },
    { method: "GET", path: "/admin/catalog/programs/some_prog/versions/1" },
    { method: "POST", path: "/admin/catalog/programs" },
    { method: "PUT", path: "/admin/catalog/programs/some_prog" },
    { method: "POST", path: "/admin/catalog/programs/some_prog/publish" },
    { method: "POST", path: "/admin/catalog/programs/some_prog/archive" },
  ];
  for (const { method, path } of routes) {
    const r1 = await app.request(path, { method });
    assert.equal(r1.status, 401, `${method} ${path} must require auth (no header)`);
    const r2 = await app.request(path, { method, headers: { "x-admin-secret": "wrong-secret" } });
    assert.equal(r2.status, 401, `${method} ${path} must reject wrong secret`);
  }
});

// ─── Create draft (POST /admin/catalog/programs) ─────────────────────────────

test("POST /admin/catalog/programs creates a draft entry", async () => {
  const app = await getApp();
  const res = await app.request("/admin/catalog/programs", {
    method: "POST",
    headers: ADMIN_H,
    body: JSON.stringify(makeEntry("prog_create_01")),
  });
  assert.equal(res.status, 201);
  const { entry } = await res.json();
  assert.equal(entry.programId, "prog_create_01");
  assert.equal(entry.status, "draft");
  assert.equal(entry.isCurrent, false);
  assert.equal(entry.version, 1);
  assert.equal(entry.provenance.submittedBy, "admin");
  assert.ok(entry.createdAt, "has createdAt");
  assert.ok(entry.updatedAt, "has updatedAt");
  assert.ok(!JSON.stringify(entry).includes("nightlyAmount"), "no nightlyAmount");
  assert.ok(!JSON.stringify(entry).includes("finalPrice"), "no finalPrice");
});

test("POST /admin/catalog/programs second create increments version", async () => {
  const app = await getApp();
  // Create first draft and publish it
  await app.request("/admin/catalog/programs", {
    method: "POST", headers: ADMIN_H, body: JSON.stringify(makeEntry("prog_ver_test")),
  });
  await app.request("/admin/catalog/programs/prog_ver_test/publish", { method: "POST", headers: ADMIN_H });

  // Create another draft — should be version 2
  const res = await app.request("/admin/catalog/programs", {
    method: "POST", headers: ADMIN_H, body: JSON.stringify(makeEntry("prog_ver_test")),
  });
  assert.equal(res.status, 201);
  const { entry } = await res.json();
  assert.equal(entry.version, 2);
  assert.equal(entry.status, "draft");
});

test("POST /admin/catalog/programs rejects missing required fields", async () => {
  const app = await getApp();
  const res = await app.request("/admin/catalog/programs", {
    method: "POST",
    headers: ADMIN_H,
    body: JSON.stringify({ programId: "x", name: "Missing many fields" }),
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error, "validation_failed");
});

test("POST /admin/catalog/programs rejects payloads with price fields", async () => {
  const app = await getApp();
  const entry = makeEntry("prog_price_check");
  // Inject a forbidden price field into benefits
  (entry.benefits as Record<string, unknown[]>).Silver.push({
    scope: "brand",
    value: { kind: "perk", nightlyAmount: 120 },
  });
  const res = await app.request("/admin/catalog/programs", {
    method: "POST",
    headers: ADMIN_H,
    body: JSON.stringify(entry),
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error, "validation_failed");
  const issuesStr = JSON.stringify(body.issues);
  assert.ok(issuesStr.includes("nightlyAmount"), "error mentions nightlyAmount");
});

test("POST /admin/catalog/programs rejects finalPrice field", async () => {
  const app = await getApp();
  const entry = { ...makeEntry("prog_finalprice"), finalPrice: 299 };
  const res = await app.request("/admin/catalog/programs", {
    method: "POST", headers: ADMIN_H, body: JSON.stringify(entry),
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error, "validation_failed");
});

// ─── Update draft (PUT /admin/catalog/programs/:id) ──────────────────────────

test("PUT /admin/catalog/programs/:id updates an existing draft", async () => {
  const app = await getApp();
  // Create draft first
  await app.request("/admin/catalog/programs", {
    method: "POST", headers: ADMIN_H, body: JSON.stringify(makeEntry("prog_update")),
  });

  const updated = { ...makeEntry("prog_update"), name: "Updated Program Name" };
  const res = await app.request("/admin/catalog/programs/prog_update", {
    method: "PUT", headers: ADMIN_H, body: JSON.stringify(updated),
  });
  assert.equal(res.status, 200);
  const { entry } = await res.json();
  assert.equal(entry.name, "Updated Program Name");
  assert.equal(entry.version, 1, "still same draft version");
  assert.equal(entry.status, "draft");
});

test("PUT /admin/catalog/programs/:id rejects mismatched programId", async () => {
  const app = await getApp();
  const res = await app.request("/admin/catalog/programs/prog_a", {
    method: "PUT",
    headers: ADMIN_H,
    body: JSON.stringify(makeEntry("prog_b")),
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error, "validation_failed");
  assert.ok(JSON.stringify(body.issues).includes("programId"), "error mentions programId");
});

// ─── List + get ──────────────────────────────────────────────────────────────

test("GET /admin/catalog/programs returns all entries when no status filter", async () => {
  const app = await getApp();
  // Create two programs in different states
  await app.request("/admin/catalog/programs", {
    method: "POST", headers: ADMIN_H, body: JSON.stringify(makeEntry("prog_list_a")),
  });
  await app.request("/admin/catalog/programs", {
    method: "POST", headers: ADMIN_H, body: JSON.stringify(makeEntry("prog_list_b")),
  });
  await app.request("/admin/catalog/programs/prog_list_b/publish", { method: "POST", headers: ADMIN_H });

  const res = await app.request("/admin/catalog/programs", { headers: { "x-admin-secret": "test-admin-secret-catalog" } });
  assert.equal(res.status, 200);
  const { entries } = await res.json();
  const ids = entries.map((e: { programId: string }) => e.programId);
  assert.ok(ids.includes("prog_list_a"), "includes draft");
  assert.ok(ids.includes("prog_list_b"), "includes published");
});

test("GET /admin/catalog/programs?status=draft filters to drafts only", async () => {
  const app = await getApp();
  await app.request("/admin/catalog/programs", {
    method: "POST", headers: ADMIN_H, body: JSON.stringify(makeEntry("prog_filter_a")),
  });
  await app.request("/admin/catalog/programs", {
    method: "POST", headers: ADMIN_H, body: JSON.stringify(makeEntry("prog_filter_b")),
  });
  await app.request("/admin/catalog/programs/prog_filter_b/publish", { method: "POST", headers: ADMIN_H });

  const res = await app.request("/admin/catalog/programs?status=draft", {
    headers: { "x-admin-secret": "test-admin-secret-catalog" },
  });
  assert.equal(res.status, 200);
  const { entries, status } = await res.json();
  assert.equal(status, "draft");
  for (const e of entries) {
    assert.equal(e.status, "draft", `entry ${e.programId} must be draft`);
  }
  const ids = entries.map((e: { programId: string }) => e.programId);
  assert.ok(ids.includes("prog_filter_a"), "draft included");
  assert.ok(!ids.includes("prog_filter_b"), "published not in draft filter");
});

test("GET /admin/catalog/programs?status=invalid returns 400", async () => {
  const app = await getApp();
  const res = await app.request("/admin/catalog/programs?status=invalid", {
    headers: { "x-admin-secret": "test-admin-secret-catalog" },
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error, "validation_failed");
});

test("GET /admin/catalog/programs/:id returns current + history", async () => {
  const app = await getApp();
  // Create + publish v1, then create draft v2
  await app.request("/admin/catalog/programs", {
    method: "POST", headers: ADMIN_H, body: JSON.stringify(makeEntry("prog_hist")),
  });
  await app.request("/admin/catalog/programs/prog_hist/publish", { method: "POST", headers: ADMIN_H });
  await app.request("/admin/catalog/programs", {
    method: "POST", headers: ADMIN_H, body: JSON.stringify(makeEntry("prog_hist")),
  });

  const res = await app.request("/admin/catalog/programs/prog_hist", {
    headers: { "x-admin-secret": "test-admin-secret-catalog" },
  });
  assert.equal(res.status, 200);
  const { current, history } = await res.json();
  assert.equal(current.programId, "prog_hist");
  assert.equal(current.status, "published");
  assert.ok(Array.isArray(history), "history is array");
  assert.ok(history.length >= 2, "at least 2 versions in history");
});

test("GET /admin/catalog/programs/:id returns 404 for unknown program", async () => {
  const app = await getApp();
  const res = await app.request("/admin/catalog/programs/does_not_exist_42", {
    headers: { "x-admin-secret": "test-admin-secret-catalog" },
  });
  assert.equal(res.status, 404);
  const body = await res.json();
  assert.equal(body.error, "not_found");
});

test("GET /admin/catalog/programs/:id/versions/:version returns specific version", async () => {
  const app = await getApp();
  await app.request("/admin/catalog/programs", {
    method: "POST", headers: ADMIN_H, body: JSON.stringify(makeEntry("prog_ver_lookup")),
  });

  const res = await app.request("/admin/catalog/programs/prog_ver_lookup/versions/1", {
    headers: { "x-admin-secret": "test-admin-secret-catalog" },
  });
  assert.equal(res.status, 200);
  const { entry } = await res.json();
  assert.equal(entry.programId, "prog_ver_lookup");
  assert.equal(entry.version, 1);
});

test("GET /admin/catalog/programs/:id/versions/:version returns 404 for missing version", async () => {
  const app = await getApp();
  const res = await app.request("/admin/catalog/programs/prog_no_ver/versions/99", {
    headers: { "x-admin-secret": "test-admin-secret-catalog" },
  });
  assert.equal(res.status, 404);
  assert.equal((await res.json()).error, "not_found");
});

// ─── Publish ─────────────────────────────────────────────────────────────────

test("POST /admin/catalog/programs/:id/publish promotes draft to published", async () => {
  const app = await getApp();
  await app.request("/admin/catalog/programs", {
    method: "POST", headers: ADMIN_H, body: JSON.stringify(makeEntry("prog_publish")),
  });

  const res = await app.request("/admin/catalog/programs/prog_publish/publish", {
    method: "POST", headers: ADMIN_H,
  });
  assert.equal(res.status, 200);
  const { entry } = await res.json();
  assert.equal(entry.status, "published");
  assert.equal(entry.isCurrent, true);
  assert.ok(entry.publishedAt, "has publishedAt");
});

test("POST /admin/catalog/programs/:id/publish is visible in public catalog", async () => {
  const app = await getApp();
  await app.request("/admin/catalog/programs", {
    method: "POST", headers: ADMIN_H, body: JSON.stringify(makeEntry("prog_pub_visible")),
  });
  await app.request("/admin/catalog/programs/prog_pub_visible/publish", { method: "POST", headers: ADMIN_H });

  const res = await app.request("/catalog/programs/prog_pub_visible");
  assert.equal(res.status, 200);
  const { program } = await res.json();
  assert.equal(program.programId, "prog_pub_visible");
  assert.equal(program.status, "published");
});

test("POST /admin/catalog/programs/:id/publish returns 409 when no draft exists", async () => {
  const app = await getApp();
  const res = await app.request("/admin/catalog/programs/no_draft_prog/publish", {
    method: "POST", headers: ADMIN_H,
  });
  assert.equal(res.status, 409);
  const body = await res.json();
  assert.equal(body.error, "publish_failed");
});

// ─── Archive ─────────────────────────────────────────────────────────────────

test("POST /admin/catalog/programs/:id/archive retires the published entry", async () => {
  const app = await getApp();
  await app.request("/admin/catalog/programs", {
    method: "POST", headers: ADMIN_H, body: JSON.stringify(makeEntry("prog_archive")),
  });
  await app.request("/admin/catalog/programs/prog_archive/publish", { method: "POST", headers: ADMIN_H });

  const res = await app.request("/admin/catalog/programs/prog_archive/archive", {
    method: "POST", headers: ADMIN_H,
  });
  assert.equal(res.status, 204);

  // Verify public catalog no longer returns this entry
  const pubRes = await app.request("/catalog/programs/prog_archive");
  assert.equal(pubRes.status, 404, "archived entry not returned by public catalog");
});

test("POST /admin/catalog/programs/:id/archive returns 404 for unknown program", async () => {
  const app = await getApp();
  const res = await app.request("/admin/catalog/programs/prog_not_found/archive", {
    method: "POST", headers: ADMIN_H,
  });
  assert.equal(res.status, 404);
  assert.equal((await res.json()).error, "not_found");
});

// ─── Full lifecycle ───────────────────────────────────────────────────────────

test("full catalog lifecycle: create draft → publish → create v2 draft → publish", async () => {
  const app = await getApp();
  const pid = "prog_lifecycle";

  // v1: create and publish
  const create1 = await app.request("/admin/catalog/programs", {
    method: "POST", headers: ADMIN_H, body: JSON.stringify(makeEntry(pid)),
  });
  assert.equal(create1.status, 201);
  assert.equal((await create1.json()).entry.version, 1);

  const pub1 = await app.request(`/admin/catalog/programs/${pid}/publish`, { method: "POST", headers: ADMIN_H });
  assert.equal(pub1.status, 200);
  assert.equal((await pub1.json()).entry.status, "published");

  // v2: create draft
  const updatedEntry = { ...makeEntry(pid), name: "Test Program v2" };
  const create2 = await app.request("/admin/catalog/programs", {
    method: "POST", headers: ADMIN_H, body: JSON.stringify(updatedEntry),
  });
  assert.equal(create2.status, 201);
  assert.equal((await create2.json()).entry.version, 2);

  // v2: publish — previous current must be demoted
  const pub2 = await app.request(`/admin/catalog/programs/${pid}/publish`, { method: "POST", headers: ADMIN_H });
  assert.equal(pub2.status, 200);
  const { entry: v2 } = await pub2.json();
  assert.equal(v2.version, 2);
  assert.equal(v2.name, "Test Program v2");
  assert.equal(v2.isCurrent, true);

  // History shows both versions
  const hist = await app.request(`/admin/catalog/programs/${pid}`, {
    headers: { "x-admin-secret": "test-admin-secret-catalog" },
  });
  const { history } = await hist.json();
  assert.equal(history.length, 2, "two versions in history");
  const currentEntry = history.find((e: { isCurrent: boolean }) => e.isCurrent);
  assert.equal(currentEntry.version, 2, "v2 is current");

  // Public catalog returns v2
  const pub = await app.request(`/catalog/programs/${pid}`);
  assert.equal(pub.status, 200);
  assert.equal((await pub.json()).program.version, 2);
});

// ─── No price data in responses ───────────────────────────────────────────────

test("admin catalog responses contain no hotel price fields", async () => {
  const app = await getApp();
  await app.request("/admin/catalog/programs", {
    method: "POST", headers: ADMIN_H, body: JSON.stringify(makeEntry("prog_no_price")),
  });

  const res = await app.request("/admin/catalog/programs", {
    headers: { "x-admin-secret": "test-admin-secret-catalog" },
  });
  const body = JSON.stringify(await res.json());
  for (const field of ["nightlyAmount", "totalAmount", "memberPrice", "finalPrice"]) {
    assert.ok(!body.includes(field), `response must not contain '${field}'`);
  }
});
