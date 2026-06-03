// Audit log tests for issue #79.
//
// Covers:
//   - Catalog admin actions produce audit entries (create draft, update draft, publish, archive, restore)
//   - Partner/submission admin actions produce audit entries (create, approve, reject)
//   - GET /admin/audit supports filtering (actor, action, targetId, targetType, since, until)
//   - Audit entries capture before/after state snapshots where applicable
//   - Audit log is append-only (no write/delete endpoints exposed)

import { test, before, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

const ADMIN_SECRET = "test-admin-secret-audit-79";

before(() => {
  process.env.TRUERATE_INMEMORY = "true";
  process.env.TRUERATE_JWT_SECRET = "audit-test-secret";
  process.env.TRUERATE_CRED_KEY = randomBytes(32).toString("base64");
  process.env.ADMIN_SECRET = ADMIN_SECRET;
});

async function getApp() {
  const { app } = await import("../src/app.js");
  return app;
}

beforeEach(async () => {
  const { resetAppCatalog, resetAppAudit, resetAppPartner } = await import("../src/app.js");
  const { resetCatalogRepo, resetPartnerWorkflow, resetUserRepo } = await import("@truerate/core");
  const { apiLimiter } = await import("../src/rate-limit.js");
  resetAppCatalog();
  resetAppAudit();
  resetAppPartner();
  resetCatalogRepo();
  resetPartnerWorkflow();
  resetUserRepo();
  // Reset rate limiter so tests don't block each other
  apiLimiter.reset("ip:unknown");
});

const adminHeader = { "x-admin-secret": ADMIN_SECRET };
const JSON_CT = { "Content-Type": "application/json" };
const actorHeader = { "x-admin-secret": ADMIN_SECRET, "x-admin-actor": "alice@truerate.io" };

const sampleEntry = {
  programId: "audit_test_prog",
  provenance: { source: "manual-seed", asOf: "2026-05", sourceUrl: "https://example.com/terms" },
  region: "CZ",
  name: "Audit Test Program",
  category: "hotel",
  defaultMatch: { domains: ["audittest.com"] },
  tiers: ["Standard"],
  requiresCredential: false,
  fields: [],
  benefits: {
    Standard: [{ scope: "domain", value: { kind: "percentDiscount", percentOff: 0.1 } }],
  },
};

const sampleOrg = {
  id: "org-audit-test",
  name: "Audit Test Hotel Group",
  country: "CZ",
  contactEmail: "partner@audittest.cz",
};

const sampleSubmission = {
  id: "sub-audit-1",
  orgId: "org-audit-test",
  submittedByUserId: "user-audit",
  status: "submitted" as const,
  source: "partner" as const,
  programDraft: {
    name: "Audit Loyalty Program",
    category: "hotel",
    region: "CZ",
    fields: [],
    benefits: {
      Silver: [{ scope: "brand", match: { brands: ["Audit Hotel"] }, value: { kind: "percentDiscount", percentOff: 0.1 } }],
    },
  },
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function auditEntries(app: Awaited<ReturnType<typeof getApp>>) {
  const res = await app.request("/admin/audit?limit=200", { headers: adminHeader });
  assert.equal(res.status, 200);
  return (await res.json()).entries as Array<{ action: string; targetId: string; targetType: string; actor: string; before?: unknown; after?: unknown; notes?: string; timestamp: string }>;
}

async function seedOrg(app: Awaited<ReturnType<typeof getApp>>) {
  const res = await app.request("/admin/partners", {
    method: "POST",
    headers: { ...adminHeader, ...JSON_CT },
    body: JSON.stringify(sampleOrg),
  });
  assert.equal(res.status, 201);
  return (await res.json()).org;
}

async function seedSubmission(app: Awaited<ReturnType<typeof getApp>>) {
  const { getPartnerSubmissionRepo } = await import("@truerate/core");
  const repo = await getPartnerSubmissionRepo();
  return repo.create(sampleSubmission);
}

// ─── Catalog audit entries ────────────────────────────────────────────────────

describe("catalog admin audit entries", () => {
  test("POST /admin/catalog — records admin.catalog.draft.create", async () => {
    const app = await getApp();
    const res = await app.request("/admin/catalog", {
      method: "POST",
      headers: { ...adminHeader, ...JSON_CT },
      body: JSON.stringify(sampleEntry),
    });
    assert.equal(res.status, 201);

    const entries = await auditEntries(app);
    const e = entries.find((a) => a.action === "admin.catalog.draft.create");
    assert.ok(e, "draft.create audit entry exists");
    assert.equal(e!.targetId, sampleEntry.programId);
    assert.equal(e!.targetType, "catalog");
  });

  test("PUT /admin/catalog/:id — records admin.catalog.draft.update with before/after", async () => {
    const app = await getApp();
    // Create draft first
    await app.request("/admin/catalog", {
      method: "POST",
      headers: { ...adminHeader, ...JSON_CT },
      body: JSON.stringify(sampleEntry),
    });

    // Update draft
    const res = await app.request(`/admin/catalog/${sampleEntry.programId}`, {
      method: "PUT",
      headers: { ...adminHeader, ...JSON_CT },
      body: JSON.stringify({ ...sampleEntry, name: "Updated Name" }),
    });
    assert.equal(res.status, 200);

    const entries = await auditEntries(app);
    const e = entries.find((a) => a.action === "admin.catalog.draft.update");
    assert.ok(e, "draft.update audit entry exists");
    assert.equal(e!.targetId, sampleEntry.programId);
    assert.ok(e!.after, "has after snapshot");
  });

  test("POST /admin/catalog/:id/publish — records admin.catalog.publish with after", async () => {
    const app = await getApp();
    await app.request("/admin/catalog", {
      method: "POST",
      headers: { ...adminHeader, ...JSON_CT },
      body: JSON.stringify(sampleEntry),
    });

    const res = await app.request(`/admin/catalog/${sampleEntry.programId}/publish`, {
      method: "POST",
      headers: adminHeader,
    });
    assert.equal(res.status, 200);

    const entries = await auditEntries(app);
    const e = entries.find((a) => a.action === "admin.catalog.publish");
    assert.ok(e, "publish audit entry exists");
    assert.equal(e!.targetId, sampleEntry.programId);
    assert.equal(e!.targetType, "catalog");
    assert.ok((e!.after as Record<string, unknown>)?.status === "published");
  });

  test("DELETE /admin/catalog/:id — records admin.catalog.archive with before/after", async () => {
    const app = await getApp();
    // First seed via public catalog
    await app.request("/catalog/programs");

    // Pick any published program
    const listRes = await app.request("/admin/catalog?status=published", { headers: adminHeader });
    const { entries } = await listRes.json();
    assert.ok(entries.length > 0);
    const programId = entries[0].programId;

    const res = await app.request(`/admin/catalog/${programId}`, {
      method: "DELETE",
      headers: adminHeader,
    });
    assert.equal(res.status, 204);

    const auditLog = await auditEntries(app);
    const e = auditLog.find((a) => a.action === "admin.catalog.archive");
    assert.ok(e, "archive audit entry exists");
    assert.equal(e!.targetId, programId);
    assert.equal((e!.after as Record<string, unknown>)?.status, "archived");
  });

  test("POST /admin/catalog/:id/restore/:version — records admin.catalog.restore", async () => {
    const app = await getApp();
    await app.request("/admin/catalog", {
      method: "POST",
      headers: { ...adminHeader, ...JSON_CT },
      body: JSON.stringify(sampleEntry),
    });
    await app.request(`/admin/catalog/${sampleEntry.programId}/publish`, {
      method: "POST",
      headers: adminHeader,
    });

    const res = await app.request(`/admin/catalog/${sampleEntry.programId}/restore/1`, {
      method: "POST",
      headers: adminHeader,
    });
    assert.equal(res.status, 201);

    const auditLog = await auditEntries(app);
    const e = auditLog.find((a) => a.action === "admin.catalog.restore");
    assert.ok(e, "restore audit entry exists");
    assert.equal(e!.targetId, sampleEntry.programId);
    assert.ok(e!.notes?.includes("restored from version"));
  });
});

// ─── Partner admin audit entries ──────────────────────────────────────────────

describe("partner admin audit entries", () => {
  test("POST /admin/partners — records admin.partner.create", async () => {
    const app = await getApp();
    await seedOrg(app);

    const entries = await auditEntries(app);
    const e = entries.find((a) => a.action === "admin.partner.create");
    assert.ok(e, "partner.create audit entry exists");
    assert.equal(e!.targetId, sampleOrg.id);
    assert.equal(e!.targetType, "partner");
  });

  test("POST /admin/partners/:id/approve — records admin.partner.approve with before/after", async () => {
    const app = await getApp();
    await seedOrg(app);

    const res = await app.request(`/admin/partners/${sampleOrg.id}/approve`, {
      method: "POST",
      headers: { ...adminHeader, ...JSON_CT },
      body: JSON.stringify({ adminId: "admin" }),
    });
    assert.equal(res.status, 200);

    const entries = await auditEntries(app);
    const e = entries.find((a) => a.action === "admin.partner.approve");
    assert.ok(e, "partner.approve audit entry exists");
    assert.equal(e!.targetId, sampleOrg.id);
    assert.equal((e!.before as Record<string, unknown>)?.status, "pending");
    assert.equal((e!.after as Record<string, unknown>)?.status, "active");
  });

  test("POST /admin/partners/:id/reject — records admin.partner.reject with reason in notes", async () => {
    const app = await getApp();
    await seedOrg(app);

    const reason = "Does not meet quality standards";
    const res = await app.request(`/admin/partners/${sampleOrg.id}/reject`, {
      method: "POST",
      headers: { ...adminHeader, ...JSON_CT },
      body: JSON.stringify({ reason }),
    });
    assert.equal(res.status, 200);

    const entries = await auditEntries(app);
    const e = entries.find((a) => a.action === "admin.partner.reject");
    assert.ok(e, "partner.reject audit entry exists");
    assert.equal(e!.targetId, sampleOrg.id);
    assert.equal((e!.before as Record<string, unknown>)?.status, "pending");
    assert.ok(e!.notes?.includes(reason));
  });
});

// ─── Submission admin audit entries ───────────────────────────────────────────

describe("submission admin audit entries", () => {
  test("POST /admin/submissions/:id/approve — records admin.submission.approve", async () => {
    const app = await getApp();
    await seedOrg(app);
    const sub = await seedSubmission(app);

    const res = await app.request(`/admin/submissions/${sub.id}/approve`, {
      method: "POST",
      headers: { ...adminHeader, ...JSON_CT },
      body: JSON.stringify({ publishedProgramId: "audit_pub_prog", adminId: "admin" }),
    });
    assert.equal(res.status, 200);

    const entries = await auditEntries(app);
    const e = entries.find((a) => a.action === "admin.submission.approve");
    assert.ok(e, "submission.approve audit entry exists");
    assert.equal(e!.targetId, sub.id);
    assert.equal(e!.targetType, "submission");
    assert.equal((e!.after as Record<string, unknown>)?.publishedProgramId, "audit_pub_prog");
  });

  test("POST /admin/submissions/:id/reject — records admin.submission.reject with reason", async () => {
    const app = await getApp();
    await seedOrg(app);
    const sub = await seedSubmission(app);

    const reason = "Incomplete benefit definitions";
    const res = await app.request(`/admin/submissions/${sub.id}/reject`, {
      method: "POST",
      headers: { ...adminHeader, ...JSON_CT },
      body: JSON.stringify({ reason, adminId: "admin" }),
    });
    assert.equal(res.status, 200);

    const entries = await auditEntries(app);
    const e = entries.find((a) => a.action === "admin.submission.reject");
    assert.ok(e, "submission.reject audit entry exists");
    assert.equal(e!.targetId, sub.id);
    assert.ok(e!.notes?.includes(reason));
  });
});

// ─── Audit log filtering ──────────────────────────────────────────────────────

describe("GET /admin/audit filtering", () => {
  test("?action= — filters by action type", async () => {
    const app = await getApp();
    // Generate both catalog and partner entries
    await app.request("/admin/catalog", {
      method: "POST",
      headers: { ...adminHeader, ...JSON_CT },
      body: JSON.stringify(sampleEntry),
    });
    await seedOrg(app);

    const res = await app.request("/admin/audit?action=admin.catalog.draft.create", { headers: adminHeader });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.count >= 1);
    assert.ok(body.entries.every((e: { action: string }) => e.action === "admin.catalog.draft.create"));
  });

  test("?targetType= — filters by target type", async () => {
    const app = await getApp();
    await app.request("/admin/catalog", {
      method: "POST",
      headers: { ...adminHeader, ...JSON_CT },
      body: JSON.stringify(sampleEntry),
    });
    await seedOrg(app);

    const res = await app.request("/admin/audit?targetType=catalog", { headers: adminHeader });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.count >= 1);
    assert.ok(body.entries.every((e: { targetType: string }) => e.targetType === "catalog"));
  });

  test("?targetId= — filters by target entity", async () => {
    const app = await getApp();
    await app.request("/admin/catalog", {
      method: "POST",
      headers: { ...adminHeader, ...JSON_CT },
      body: JSON.stringify(sampleEntry),
    });
    await seedOrg(app);

    const res = await app.request(`/admin/audit?targetId=${sampleEntry.programId}`, { headers: adminHeader });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.count >= 1);
    assert.ok(body.entries.every((e: { targetId: string }) => e.targetId === sampleEntry.programId));
  });

  test("?actor= — filters by actor identity", async () => {
    const app = await getApp();
    // Action with custom actor header
    await app.request("/admin/catalog", {
      method: "POST",
      headers: { ...actorHeader, ...JSON_CT },
      body: JSON.stringify(sampleEntry),
    });
    // Another action without custom actor (defaults to "admin")
    await seedOrg(app);

    const res = await app.request("/admin/audit?actor=alice%40truerate.io", { headers: adminHeader });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.count >= 1);
    assert.ok(body.entries.every((e: { actor: string }) => e.actor === "alice@truerate.io"));
  });

  test("?since= and ?until= — filters by timestamp range", async () => {
    const app = await getApp();
    const before = new Date().toISOString();

    await app.request("/admin/catalog", {
      method: "POST",
      headers: { ...adminHeader, ...JSON_CT },
      body: JSON.stringify(sampleEntry),
    });

    const after = new Date().toISOString();

    // Entries since `before` should include our action
    const resSince = await app.request(`/admin/audit?since=${encodeURIComponent(before)}`, { headers: adminHeader });
    const bodySince = await resSince.json();
    assert.ok(bodySince.count >= 1);

    // Entries until a timestamp before our action should be empty (none existed before `before`)
    const resUntil = await app.request(`/admin/audit?until=${encodeURIComponent(before)}`, { headers: adminHeader });
    const bodyUntil = await resUntil.json();
    // All entries should be at or before `before`
    for (const e of bodyUntil.entries) {
      assert.ok(e.timestamp <= before, `entry.timestamp ${e.timestamp} should be <= ${before}`);
    }

    // Combined range since/until that brackets our entry
    const resBoth = await app.request(
      `/admin/audit?since=${encodeURIComponent(before)}&until=${encodeURIComponent(after)}`,
      { headers: adminHeader },
    );
    const bodyBoth = await resBoth.json();
    assert.ok(bodyBoth.count >= 1);
  });

  test("no filter params — returns recent entries unfiltered", async () => {
    const app = await getApp();
    await app.request("/admin/catalog", {
      method: "POST",
      headers: { ...adminHeader, ...JSON_CT },
      body: JSON.stringify(sampleEntry),
    });
    await seedOrg(app);

    const res = await app.request("/admin/audit", { headers: adminHeader });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.count >= 2);
  });

  test("?limit= — caps number of results", async () => {
    const app = await getApp();
    // Generate multiple entries
    for (let i = 0; i < 5; i++) {
      await app.request("/admin/catalog", {
        method: "POST",
        headers: { ...adminHeader, ...JSON_CT },
        body: JSON.stringify({ ...sampleEntry, programId: `audit_prog_${i}` }),
      });
    }

    const res = await app.request("/admin/audit?limit=3", { headers: adminHeader });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.entries.length, 3);
    assert.equal(body.count, 3);
  });
});

// ─── Append-only invariants ───────────────────────────────────────────────────

describe("audit log is append-only", () => {
  test("no DELETE endpoint exists for audit entries", async () => {
    const app = await getApp();
    // Attempt to delete an audit entry — should 404 (route not found) not 204
    const res = await app.request("/admin/audit/some-entry-id", {
      method: "DELETE",
      headers: adminHeader,
    });
    assert.notEqual(res.status, 204, "DELETE on audit entry must not succeed");
  });

  test("no PUT/PATCH endpoint exists for audit entries", async () => {
    const app = await getApp();
    const res = await app.request("/admin/audit/some-entry-id", {
      method: "PUT",
      headers: { ...adminHeader, ...JSON_CT },
      body: JSON.stringify({ action: "tampered" }),
    });
    assert.notEqual(res.status, 200, "PUT on audit entry must not succeed");
  });

  test("audit entries never contain prices", async () => {
    const app = await getApp();
    await app.request("/admin/catalog", {
      method: "POST",
      headers: { ...adminHeader, ...JSON_CT },
      body: JSON.stringify(sampleEntry),
    });

    const res = await app.request("/admin/audit", { headers: adminHeader });
    const raw = await res.text();
    // Ensure none of the price-related fields leak into audit log
    assert.ok(!raw.includes('"price"'), "audit log must not contain price fields");
    assert.ok(!raw.includes('"amount"'), "audit log must not contain amount fields");
  });

  test("x-admin-actor header is recorded as actor", async () => {
    const app = await getApp();
    await app.request("/admin/catalog", {
      method: "POST",
      headers: { ...actorHeader, ...JSON_CT },
      body: JSON.stringify(sampleEntry),
    });

    const entries = await auditEntries(app);
    const e = entries.find((a) => a.action === "admin.catalog.draft.create");
    assert.ok(e, "audit entry exists");
    assert.equal(e!.actor, "alice@truerate.io");
  });

  test("default actor is 'admin' when x-admin-actor is absent", async () => {
    const app = await getApp();
    await seedOrg(app);

    const entries = await auditEntries(app);
    const e = entries.find((a) => a.action === "admin.partner.create");
    assert.ok(e, "audit entry exists");
    assert.equal(e!.actor, "admin");
  });
});

// ─── GET /admin/audit auth guard ─────────────────────────────────────────────

test("GET /admin/audit — 401 without admin secret", async () => {
  const app = await getApp();
  const res = await app.request("/admin/audit");
  assert.equal(res.status, 401);
});
