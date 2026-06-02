import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

before(() => {
  process.env.TRUERATE_INMEMORY = "true";
  process.env.TRUERATE_JWT_SECRET = "catalog-test-secret";
  process.env.TRUERATE_CRED_KEY = randomBytes(32).toString("base64");
});

async function getApp() {
  const { app } = await import("../src/app.js");
  return app;
}

// Reset catalog state between tests so each test starts with a seeded
// in-memory catalog (seeding is idempotent via seedIfEmpty).
beforeEach(async () => {
  const { resetAppCatalog } = await import("../src/app.js");
  const { resetCatalogRepo } = await import("@truerate/core");
  resetAppCatalog();
  resetCatalogRepo();
});

// ---------------------------------------------------------------------------
// GET /catalog/programs
// ---------------------------------------------------------------------------

test("GET /catalog/programs returns published programs after seeding", async () => {
  const app = await getApp();
  const res = await app.request("/catalog/programs");
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(Array.isArray(body.programs), "programs is an array");
  assert.ok(body.programs.length > 0, "at least one program seeded");
});

test("GET /catalog/programs — each entry has required catalog fields and no price fields", async () => {
  const app = await getApp();
  const res = await app.request("/catalog/programs");
  const { programs } = await res.json();

  for (const p of programs) {
    assert.ok(typeof p.programId === "string", "has programId");
    assert.ok(typeof p.name === "string", "has name");
    assert.ok(typeof p.category === "string", "has category");
    assert.ok(typeof p.status === "string", "has status");
    assert.equal(p.status, "published", "only published entries returned");
    assert.ok(typeof p.summaryByTier === "object", "has summaryByTier");
  }

  // No price fields anywhere
  const raw = JSON.stringify(programs);
  assert.ok(!raw.includes("nightlyAmount"), "no nightlyAmount");
  assert.ok(!raw.includes("totalAmount"), "no totalAmount");
  assert.ok(!raw.includes("memberPrice"), "no memberPrice");
  assert.ok(!raw.includes("finalPrice"), "no finalPrice");
});

test("GET /catalog/programs includes booking_genius from seeded catalog", async () => {
  const app = await getApp();
  const res = await app.request("/catalog/programs");
  const { programs } = await res.json();
  const genius = programs.find((p: any) => p.programId === "booking_genius");
  assert.ok(genius, "booking_genius found in catalog");
  assert.equal(genius.status, "published");
  assert.ok(genius.tiers?.includes("Level 1"), "has Level 1 tier");
  assert.ok(genius.summaryByTier["Level 3"].some((s: string) => /20% off/.test(s)), "L3 summary has 20% off");
});

test("GET /catalog/programs?region=CZ returns only CZ and Global entries", async () => {
  const app = await getApp();
  const res = await app.request("/catalog/programs?region=CZ");
  assert.equal(res.status, 200);
  const { programs, region } = await res.json();
  assert.equal(region, "CZ");
  for (const p of programs) {
    assert.ok(p.region === "CZ" || p.region === "Global", `${p.programId} region must be CZ or Global, got ${p.region}`);
  }
});

test("GET /catalog/programs without region returns Global entries", async () => {
  const app = await getApp();
  const res = await app.request("/catalog/programs");
  const { programs, region } = await res.json();
  assert.equal(region, null, "region is null when not filtered");
  assert.ok(programs.some((p: any) => p.region === "Global"), "Global entries returned");
});

// ---------------------------------------------------------------------------
// GET /catalog/programs/:id
// ---------------------------------------------------------------------------

test("GET /catalog/programs/:id returns the current published entry", async () => {
  const app = await getApp();
  const res = await app.request("/catalog/programs/booking_genius");
  assert.equal(res.status, 200);
  const { program } = await res.json();
  assert.equal(program.programId, "booking_genius");
  assert.equal(program.status, "published");
  assert.ok(program.isCurrent, "entry is current");
  assert.ok(typeof program.summaryByTier === "object", "has summaryByTier");
});

test("GET /catalog/programs/:id — entry has no price fields", async () => {
  const app = await getApp();
  const res = await app.request("/catalog/programs/marriott_bonvoy");
  assert.equal(res.status, 200);
  const raw = JSON.stringify(await res.json());
  assert.ok(!raw.includes("nightlyAmount"), "no nightlyAmount");
  assert.ok(!raw.includes("totalAmount"), "no totalAmount");
  assert.ok(!raw.includes("memberPrice"), "no memberPrice");
});

test("GET /catalog/programs/:id returns 404 for unknown program", async () => {
  const app = await getApp();
  const res = await app.request("/catalog/programs/does_not_exist_program");
  assert.equal(res.status, 404);
  const body = await res.json();
  assert.equal(body.error, "not_found");
});

test("GET /catalog/programs/:id summaryByTier matches expected benefit content", async () => {
  const app = await getApp();
  const res = await app.request("/catalog/programs/booking_genius");
  const { program } = await res.json();
  const l3summary: string[] = program.summaryByTier["Level 3"];
  assert.ok(Array.isArray(l3summary), "summaryByTier Level 3 is an array");
  assert.ok(l3summary.some((s) => /20% off/.test(s)), "Level 3 summary includes 20% off");
});

// ---------------------------------------------------------------------------
// Membership routes use catalog (not hardcoded programs.ts)
// ---------------------------------------------------------------------------

test("POST /memberships resolves program from catalog (catalog path)", async () => {
  const app = await getApp();
  // Register a user
  const regRes = await app.request("/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: `u${Math.random().toString(36).slice(2)}@example.com`, password: "pw123456" }),
  });
  const { token } = await regRes.json();

  // Add membership — should resolve from seeded catalog
  const addRes = await app.request("/memberships", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ programId: "booking_genius", tier: "Level 3" }),
  });
  assert.equal(addRes.status, 200);
  const { user } = await addRes.json();
  const m = user.memberships[0];
  assert.equal(m.programId, "booking_genius");
  assert.ok(m.benefits.length > 0, "benefits instantiated from catalog");
  assert.ok(m.benefits.some((b: any) => b.value.kind === "percentDiscount" && b.value.percentOff === 0.2));
  // No price fields
  const raw = JSON.stringify(user);
  assert.ok(!raw.includes("finalPrice"), "no finalPrice");
  assert.ok(!raw.includes("memberPrice"), "no memberPrice");
});
