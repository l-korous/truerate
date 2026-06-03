// Admin partner approval + submission review queue tests (#75).
//
// Covers:
//   - Auth guard on all partner/submission admin endpoints
//   - Partner org CRUD + approve/reject workflows (recording who/when)
//   - Submission queue listing and approve/reject (scraped vs partner)
//   - Price-field guard on all responses

import { test, before, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

const ADMIN_SECRET = "test-admin-secret-partner-75";

before(() => {
  process.env.TRUERATE_INMEMORY = "true";
  process.env.TRUERATE_JWT_SECRET = "partner-admin-test-secret";
  process.env.TRUERATE_CRED_KEY = randomBytes(32).toString("base64");
  process.env.ADMIN_SECRET = ADMIN_SECRET;
});

async function getApp() {
  const { app } = await import("../src/app.js");
  return app;
}

beforeEach(async () => {
  const { resetAppPartner, resetAppCatalog } = await import("../src/app.js");
  const { resetPartnerWorkflow } = await import("@truerate/core");
  const { apiLimiter } = await import("../src/rate-limit.js");
  resetAppPartner();
  resetPartnerWorkflow();
  resetAppCatalog();
  apiLimiter.reset("ip:unknown");
});

const adminHeader = { "x-admin-secret": ADMIN_SECRET };
const JSON_CT = { "Content-Type": "application/json" };

const sampleOrg = {
  id: "org-test-partner",
  name: "Test Hotel Group",
  country: "CZ",
  contactEmail: "partner@testhotel.cz",
};

const sampleSubmission = {
  id: "sub-test-1",
  orgId: "org-test-partner",
  submittedByUserId: "user-alice",
  status: "submitted" as const,
  source: "partner" as const,
  programDraft: {
    name: "Test Loyalty Program",
    category: "hotel",
    region: "CZ",
    fields: [{ key: "memberNumber", label: "Member Number", type: "text" }],
    benefits: {
      Silver: [{ scope: "brand", match: { brands: ["Test Hotel Group"] }, value: { kind: "percentDiscount", percentOff: 0.1 } }],
    },
  },
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

// ─── Auth guards ─────────────────────────────────────────────────────────────

describe("admin partner auth guards", () => {
  test("GET /admin/partners — 401 without admin secret", async () => {
    const app = await getApp();
    const res = await app.request("/admin/partners");
    assert.equal(res.status, 401);
    assert.equal((await res.json()).error, "unauthorized");
  });

  test("POST /admin/partners — 401 without admin secret", async () => {
    const app = await getApp();
    const res = await app.request("/admin/partners", {
      method: "POST",
      headers: { ...JSON_CT },
      body: JSON.stringify(sampleOrg),
    });
    assert.equal(res.status, 401);
  });

  test("GET /admin/submissions — 401 without admin secret", async () => {
    const app = await getApp();
    const res = await app.request("/admin/submissions");
    assert.equal(res.status, 401);
  });

  test("POST /admin/submissions/:id/approve — 401 without admin secret", async () => {
    const app = await getApp();
    const res = await app.request("/admin/submissions/sub-1/approve", {
      method: "POST",
      headers: { ...JSON_CT },
      body: JSON.stringify({ publishedProgramId: "prog-1" }),
    });
    assert.equal(res.status, 401);
  });

  test("POST /admin/submissions/:id/reject — 401 without admin secret", async () => {
    const app = await getApp();
    const res = await app.request("/admin/submissions/sub-1/reject", {
      method: "POST",
      headers: { ...JSON_CT },
      body: JSON.stringify({ reason: "bad data" }),
    });
    assert.equal(res.status, 401);
  });
});

// ─── Partner org management ──────────────────────────────────────────────────

describe("partner org management", () => {
  test("POST /admin/partners — creates a pending partner org", async () => {
    const app = await getApp();
    const res = await app.request("/admin/partners", {
      method: "POST",
      headers: { ...adminHeader, ...JSON_CT },
      body: JSON.stringify(sampleOrg),
    });
    assert.equal(res.status, 201);
    const { org } = await res.json();
    assert.equal(org.id, sampleOrg.id);
    assert.equal(org.status, "pending");
    assert.equal(org.name, sampleOrg.name);
    assert.ok(org.createdAt, "createdAt set");
  });

  test("POST /admin/partners — 409 on duplicate id", async () => {
    const app = await getApp();
    await app.request("/admin/partners", {
      method: "POST",
      headers: { ...adminHeader, ...JSON_CT },
      body: JSON.stringify(sampleOrg),
    });
    const res = await app.request("/admin/partners", {
      method: "POST",
      headers: { ...adminHeader, ...JSON_CT },
      body: JSON.stringify(sampleOrg),
    });
    assert.equal(res.status, 409);
    assert.equal((await res.json()).error, "already_exists");
  });

  test("POST /admin/partners — 400 on missing required fields", async () => {
    const app = await getApp();
    const res = await app.request("/admin/partners", {
      method: "POST",
      headers: { ...adminHeader, ...JSON_CT },
      body: JSON.stringify({ id: "incomplete" }),
    });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, "validation_failed");
  });

  test("GET /admin/partners — returns pending orgs by default", async () => {
    const app = await getApp();
    await app.request("/admin/partners", {
      method: "POST",
      headers: { ...adminHeader, ...JSON_CT },
      body: JSON.stringify(sampleOrg),
    });
    const res = await app.request("/admin/partners", { headers: adminHeader });
    assert.equal(res.status, 200);
    const { orgs, count } = await res.json();
    assert.ok(Array.isArray(orgs));
    assert.equal(count, orgs.length);
    assert.ok(orgs.some((o: { id: string }) => o.id === sampleOrg.id));
  });

  test("GET /admin/partners?status=active — empty before any approvals", async () => {
    const app = await getApp();
    await app.request("/admin/partners", {
      method: "POST",
      headers: { ...adminHeader, ...JSON_CT },
      body: JSON.stringify(sampleOrg),
    });
    const res = await app.request("/admin/partners?status=active", { headers: adminHeader });
    assert.equal(res.status, 200);
    const { orgs } = await res.json();
    assert.equal(orgs.length, 0);
  });

  test("GET /admin/partners/:id — returns the org", async () => {
    const app = await getApp();
    await app.request("/admin/partners", {
      method: "POST",
      headers: { ...adminHeader, ...JSON_CT },
      body: JSON.stringify(sampleOrg),
    });
    const res = await app.request(`/admin/partners/${sampleOrg.id}`, { headers: adminHeader });
    assert.equal(res.status, 200);
    const { org } = await res.json();
    assert.equal(org.id, sampleOrg.id);
  });

  test("GET /admin/partners/:id — 404 for unknown org", async () => {
    const app = await getApp();
    const res = await app.request("/admin/partners/does-not-exist", { headers: adminHeader });
    assert.equal(res.status, 404);
    assert.equal((await res.json()).error, "not_found");
  });
});

// ─── Partner org approval ────────────────────────────────────────────────────

describe("partner org approval", () => {
  test("POST /admin/partners/:id/approve — approves a pending org, records who/when", async () => {
    const app = await getApp();
    await app.request("/admin/partners", {
      method: "POST",
      headers: { ...adminHeader, ...JSON_CT },
      body: JSON.stringify(sampleOrg),
    });

    const res = await app.request(`/admin/partners/${sampleOrg.id}/approve`, {
      method: "POST",
      headers: { ...adminHeader, ...JSON_CT },
      body: JSON.stringify({ adminId: "admin-user-1" }),
    });
    assert.equal(res.status, 200);
    const { org } = await res.json();
    assert.equal(org.status, "active");
    assert.ok(org.approvedAt, "approvedAt is set");
    assert.equal(org.approvedBy, "admin-user-1");
    assert.ok(!org.rejectedAt, "rejectedAt not set");
  });

  test("POST /admin/partners/:id/approve — 400 when org is already active", async () => {
    const app = await getApp();
    await app.request("/admin/partners", {
      method: "POST",
      headers: { ...adminHeader, ...JSON_CT },
      body: JSON.stringify(sampleOrg),
    });
    await app.request(`/admin/partners/${sampleOrg.id}/approve`, {
      method: "POST",
      headers: { ...adminHeader, ...JSON_CT },
      body: JSON.stringify({ adminId: "admin-user-1" }),
    });
    // Try to approve again
    const res = await app.request(`/admin/partners/${sampleOrg.id}/approve`, {
      method: "POST",
      headers: { ...adminHeader, ...JSON_CT },
      body: JSON.stringify({ adminId: "admin-user-1" }),
    });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, "invalid_transition");
  });

  test("POST /admin/partners/:id/approve — 404 for unknown org", async () => {
    const app = await getApp();
    const res = await app.request("/admin/partners/nonexistent/approve", {
      method: "POST",
      headers: { ...adminHeader, ...JSON_CT },
      body: JSON.stringify({ adminId: "admin-user-1" }),
    });
    assert.equal(res.status, 404);
    assert.equal((await res.json()).error, "org_not_found");
  });

  test("approved org appears in ?status=active list", async () => {
    const app = await getApp();
    await app.request("/admin/partners", {
      method: "POST",
      headers: { ...adminHeader, ...JSON_CT },
      body: JSON.stringify(sampleOrg),
    });
    await app.request(`/admin/partners/${sampleOrg.id}/approve`, {
      method: "POST",
      headers: { ...adminHeader, ...JSON_CT },
      body: JSON.stringify({ adminId: "admin-user-1" }),
    });
    const res = await app.request("/admin/partners?status=active", { headers: adminHeader });
    const { orgs } = await res.json();
    assert.ok(orgs.some((o: { id: string }) => o.id === sampleOrg.id));
  });

  test("approved org response contains no price fields", async () => {
    const app = await getApp();
    await app.request("/admin/partners", {
      method: "POST",
      headers: { ...adminHeader, ...JSON_CT },
      body: JSON.stringify(sampleOrg),
    });
    const res = await app.request(`/admin/partners/${sampleOrg.id}/approve`, {
      method: "POST",
      headers: { ...adminHeader, ...JSON_CT },
      body: JSON.stringify({ adminId: "admin-user-1" }),
    });
    const raw = JSON.stringify(await res.json());
    assert.ok(!raw.includes("memberPrice"), "no memberPrice");
    assert.ok(!raw.includes("finalPrice"), "no finalPrice");
    assert.ok(!raw.includes("nightlyAmount"), "no nightlyAmount");
  });
});

// ─── Partner org rejection ───────────────────────────────────────────────────

describe("partner org rejection", () => {
  test("POST /admin/partners/:id/reject — rejects a pending org with a reason, records who/when", async () => {
    const app = await getApp();
    await app.request("/admin/partners", {
      method: "POST",
      headers: { ...adminHeader, ...JSON_CT },
      body: JSON.stringify(sampleOrg),
    });

    const res = await app.request(`/admin/partners/${sampleOrg.id}/reject`, {
      method: "POST",
      headers: { ...adminHeader, ...JSON_CT },
      body: JSON.stringify({ reason: "Incomplete information provided.", adminId: "admin-user-2" }),
    });
    assert.equal(res.status, 200);
    const { org } = await res.json();
    assert.equal(org.status, "rejected");
    assert.equal(org.rejectReason, "Incomplete information provided.");
    assert.ok(org.rejectedAt, "rejectedAt is set");
    assert.equal(org.rejectedBy, "admin-user-2");
    assert.ok(!org.approvedAt, "approvedAt not set");
  });

  test("POST /admin/partners/:id/reject — 400 without reason", async () => {
    const app = await getApp();
    await app.request("/admin/partners", {
      method: "POST",
      headers: { ...adminHeader, ...JSON_CT },
      body: JSON.stringify(sampleOrg),
    });
    const res = await app.request(`/admin/partners/${sampleOrg.id}/reject`, {
      method: "POST",
      headers: { ...adminHeader, ...JSON_CT },
      body: JSON.stringify({ reason: "" }),
    });
    assert.equal(res.status, 400);
  });

  test("POST /admin/partners/:id/reject — 400 when org already rejected", async () => {
    const app = await getApp();
    await app.request("/admin/partners", {
      method: "POST",
      headers: { ...adminHeader, ...JSON_CT },
      body: JSON.stringify(sampleOrg),
    });
    await app.request(`/admin/partners/${sampleOrg.id}/reject`, {
      method: "POST",
      headers: { ...adminHeader, ...JSON_CT },
      body: JSON.stringify({ reason: "First rejection." }),
    });
    const res = await app.request(`/admin/partners/${sampleOrg.id}/reject`, {
      method: "POST",
      headers: { ...adminHeader, ...JSON_CT },
      body: JSON.stringify({ reason: "Second rejection." }),
    });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, "invalid_transition");
  });

  test("rejected org appears in ?status=rejected list", async () => {
    const app = await getApp();
    await app.request("/admin/partners", {
      method: "POST",
      headers: { ...adminHeader, ...JSON_CT },
      body: JSON.stringify(sampleOrg),
    });
    await app.request(`/admin/partners/${sampleOrg.id}/reject`, {
      method: "POST",
      headers: { ...adminHeader, ...JSON_CT },
      body: JSON.stringify({ reason: "Test rejection." }),
    });
    const res = await app.request("/admin/partners?status=rejected", { headers: adminHeader });
    const { orgs } = await res.json();
    assert.ok(orgs.some((o: { id: string }) => o.id === sampleOrg.id));
  });
});

// ─── Submission review queue ─────────────────────────────────────────────────

async function seedSubmission(app: { request: Function }, sub = sampleSubmission) {
  const { getPartnerSubmissionRepo } = await import("@truerate/core");
  const repo = await getPartnerSubmissionRepo();
  await repo.create(sub);
}

describe("submission review queue", () => {
  test("GET /admin/submissions — returns submitted submissions by default", async () => {
    const app = await getApp();
    await seedSubmission(app);
    const res = await app.request("/admin/submissions", { headers: adminHeader });
    assert.equal(res.status, 200);
    const { submissions, count } = await res.json();
    assert.ok(Array.isArray(submissions));
    assert.equal(count, submissions.length);
    assert.ok(submissions.some((s: { id: string }) => s.id === sampleSubmission.id));
  });

  test("GET /admin/submissions?status=approved — empty before any approvals", async () => {
    const app = await getApp();
    await seedSubmission(app);
    const res = await app.request("/admin/submissions?status=approved", { headers: adminHeader });
    assert.equal(res.status, 200);
    const { submissions } = await res.json();
    assert.equal(submissions.length, 0);
  });

  test("GET /admin/submissions/:id — returns a specific submission", async () => {
    const app = await getApp();
    await seedSubmission(app);
    const res = await app.request(`/admin/submissions/${sampleSubmission.id}`, { headers: adminHeader });
    assert.equal(res.status, 200);
    const { submission } = await res.json();
    assert.equal(submission.id, sampleSubmission.id);
    assert.equal(submission.source, "partner");
  });

  test("GET /admin/submissions/:id — 404 for unknown submission", async () => {
    const app = await getApp();
    const res = await app.request("/admin/submissions/does-not-exist", { headers: adminHeader });
    assert.equal(res.status, 404);
    assert.equal((await res.json()).error, "not_found");
  });

  test("submission response surfaces source (scraped vs partner)", async () => {
    const app = await getApp();
    const scrapedSub = { ...sampleSubmission, id: "sub-scraped-1", source: "scraped" as const };
    await seedSubmission(app, scrapedSub);
    const res = await app.request(`/admin/submissions/${scrapedSub.id}`, { headers: adminHeader });
    const { submission } = await res.json();
    assert.equal(submission.source, "scraped");
  });
});

// ─── Submission approve ───────────────────────────────────────────────────────

describe("submission approve", () => {
  test("POST /admin/submissions/:id/approve — approves a submitted submission", async () => {
    const app = await getApp();
    await seedSubmission(app);

    const res = await app.request(`/admin/submissions/${sampleSubmission.id}/approve`, {
      method: "POST",
      headers: { ...adminHeader, ...JSON_CT },
      body: JSON.stringify({ publishedProgramId: "partner-prog-test-v1", adminId: "admin-user-1" }),
    });
    assert.equal(res.status, 200);
    const { submission } = await res.json();
    assert.equal(submission.status, "approved");
    assert.equal(submission.publishedProgramId, "partner-prog-test-v1");
    assert.equal(submission.approvedBy, "admin-user-1");
  });

  test("POST /admin/submissions/:id/approve — auto-generates programId when not provided", async () => {
    const app = await getApp();
    await seedSubmission(app);
    const res = await app.request(`/admin/submissions/${sampleSubmission.id}/approve`, {
      method: "POST",
      headers: { ...adminHeader, ...JSON_CT },
      body: JSON.stringify({ adminId: "admin-user-auto" }),
    });
    assert.equal(res.status, 200);
    const { submission } = await res.json();
    assert.equal(submission.status, "approved");
    assert.ok(submission.publishedProgramId, "publishedProgramId auto-generated");
    assert.ok(submission.publishedProgramId.startsWith("partner-"), "uses partner- prefix");
  });

  test("POST /admin/submissions/:id/approve — 404 for unknown submission", async () => {
    const app = await getApp();
    const res = await app.request("/admin/submissions/does-not-exist/approve", {
      method: "POST",
      headers: { ...adminHeader, ...JSON_CT },
      body: JSON.stringify({ publishedProgramId: "prog-1" }),
    });
    assert.equal(res.status, 404);
    assert.equal((await res.json()).error, "submission_not_found");
  });

  test("POST /admin/submissions/:id/approve — 400 on invalid_transition (already approved)", async () => {
    const app = await getApp();
    await seedSubmission(app);
    await app.request(`/admin/submissions/${sampleSubmission.id}/approve`, {
      method: "POST",
      headers: { ...adminHeader, ...JSON_CT },
      body: JSON.stringify({ publishedProgramId: "prog-1" }),
    });
    const res = await app.request(`/admin/submissions/${sampleSubmission.id}/approve`, {
      method: "POST",
      headers: { ...adminHeader, ...JSON_CT },
      body: JSON.stringify({ publishedProgramId: "prog-2" }),
    });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, "invalid_transition");
  });

  test("approved submission appears in ?status=approved list", async () => {
    const app = await getApp();
    await seedSubmission(app);
    await app.request(`/admin/submissions/${sampleSubmission.id}/approve`, {
      method: "POST",
      headers: { ...adminHeader, ...JSON_CT },
      body: JSON.stringify({ publishedProgramId: "prog-listed" }),
    });
    const res = await app.request("/admin/submissions?status=approved", { headers: adminHeader });
    const { submissions } = await res.json();
    assert.ok(submissions.some((s: { id: string }) => s.id === sampleSubmission.id));
  });

  test("approved submission response contains no price fields", async () => {
    const app = await getApp();
    await seedSubmission(app);
    const res = await app.request(`/admin/submissions/${sampleSubmission.id}/approve`, {
      method: "POST",
      headers: { ...adminHeader, ...JSON_CT },
      body: JSON.stringify({ publishedProgramId: "prog-price-check" }),
    });
    const raw = JSON.stringify(await res.json());
    assert.ok(!raw.includes("memberPrice"), "no memberPrice");
    assert.ok(!raw.includes("finalPrice"), "no finalPrice");
    assert.ok(!raw.includes("nightlyAmount"), "no nightlyAmount");
    assert.ok(!raw.includes("totalAmount"), "no totalAmount");
  });
});

// ─── Submission reject ────────────────────────────────────────────────────────

describe("submission reject", () => {
  test("POST /admin/submissions/:id/reject — rejects a submitted submission with a reason", async () => {
    const app = await getApp();
    await seedSubmission(app);

    const res = await app.request(`/admin/submissions/${sampleSubmission.id}/reject`, {
      method: "POST",
      headers: { ...adminHeader, ...JSON_CT },
      body: JSON.stringify({ reason: "Benefits description is incomplete.", adminId: "admin-user-2" }),
    });
    assert.equal(res.status, 200);
    const { submission } = await res.json();
    assert.equal(submission.status, "rejected");
    assert.equal(submission.rejectReason, "Benefits description is incomplete.");
    assert.equal(submission.rejectedBy, "admin-user-2");
    assert.ok(!submission.publishedProgramId, "no publishedProgramId on rejection");
  });

  test("POST /admin/submissions/:id/reject — 400 without reason", async () => {
    const app = await getApp();
    await seedSubmission(app);
    const res = await app.request(`/admin/submissions/${sampleSubmission.id}/reject`, {
      method: "POST",
      headers: { ...adminHeader, ...JSON_CT },
      body: JSON.stringify({ reason: "" }),
    });
    assert.equal(res.status, 400);
  });

  test("POST /admin/submissions/:id/reject — 404 for unknown submission", async () => {
    const app = await getApp();
    const res = await app.request("/admin/submissions/does-not-exist/reject", {
      method: "POST",
      headers: { ...adminHeader, ...JSON_CT },
      body: JSON.stringify({ reason: "bad data" }),
    });
    assert.equal(res.status, 404);
    assert.equal((await res.json()).error, "submission_not_found");
  });

  test("POST /admin/submissions/:id/reject — 400 on invalid_transition (already rejected)", async () => {
    const app = await getApp();
    await seedSubmission(app);
    await app.request(`/admin/submissions/${sampleSubmission.id}/reject`, {
      method: "POST",
      headers: { ...adminHeader, ...JSON_CT },
      body: JSON.stringify({ reason: "First rejection." }),
    });
    const res = await app.request(`/admin/submissions/${sampleSubmission.id}/reject`, {
      method: "POST",
      headers: { ...adminHeader, ...JSON_CT },
      body: JSON.stringify({ reason: "Second rejection." }),
    });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, "invalid_transition");
  });

  test("rejected submission appears in ?status=rejected list", async () => {
    const app = await getApp();
    await seedSubmission(app);
    await app.request(`/admin/submissions/${sampleSubmission.id}/reject`, {
      method: "POST",
      headers: { ...adminHeader, ...JSON_CT },
      body: JSON.stringify({ reason: "Test rejection." }),
    });
    const res = await app.request("/admin/submissions?status=rejected", { headers: adminHeader });
    const { submissions } = await res.json();
    assert.ok(submissions.some((s: { id: string }) => s.id === sampleSubmission.id));
  });

  test("rejection response contains no price fields", async () => {
    const app = await getApp();
    await seedSubmission(app);
    const res = await app.request(`/admin/submissions/${sampleSubmission.id}/reject`, {
      method: "POST",
      headers: { ...adminHeader, ...JSON_CT },
      body: JSON.stringify({ reason: "Price check test." }),
    });
    const raw = JSON.stringify(await res.json());
    assert.ok(!raw.includes("memberPrice"), "no memberPrice");
    assert.ok(!raw.includes("finalPrice"), "no finalPrice");
    assert.ok(!raw.includes("nightlyAmount"), "no nightlyAmount");
  });
});

// ─── Auto-publish to catalog on approve ──────────────────────────────────────

describe("approve publishes to catalog", () => {
  test("approve creates and publishes a catalog entry with partner-submission provenance", async () => {
    const app = await getApp();
    await seedSubmission(app);

    const res = await app.request(`/admin/submissions/${sampleSubmission.id}/approve`, {
      method: "POST",
      headers: { ...adminHeader, ...JSON_CT },
      body: JSON.stringify({ adminId: "admin-catalog-check" }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();

    // Submission is linked to the published program
    assert.equal(body.submission.status, "approved");
    assert.ok(body.submission.publishedProgramId, "publishedProgramId set");

    // catalogEntry returned in response
    assert.ok(body.catalogEntry, "catalogEntry in response");
    assert.equal(body.catalogEntry.status, "published");
    assert.equal(body.catalogEntry.provenance.source, "partner-submission");
    assert.equal(body.catalogEntry.provenance.submittedBy, sampleSubmission.orgId);
    assert.equal(body.catalogEntry.name, sampleSubmission.programDraft.name);
    assert.equal(body.catalogEntry.region, sampleSubmission.programDraft.region);
    assert.equal(body.catalogEntry.isCurrent, true);
  });

  test("approve with explicit publishedProgramId uses that id for the catalog entry", async () => {
    const app = await getApp();
    await seedSubmission(app);

    const customProgramId = "partner-custom-program-id";
    const res = await app.request(`/admin/submissions/${sampleSubmission.id}/approve`, {
      method: "POST",
      headers: { ...adminHeader, ...JSON_CT },
      body: JSON.stringify({ publishedProgramId: customProgramId, adminId: "admin-user-1" }),
    });
    assert.equal(res.status, 200);
    const { submission, catalogEntry } = await res.json();
    assert.equal(submission.publishedProgramId, customProgramId);
    assert.equal(catalogEntry.programId, customProgramId);
    assert.equal(catalogEntry.status, "published");
  });

  test("catalog entry published on approve is discoverable via GET /admin/catalog/:id", async () => {
    const app = await getApp();
    await seedSubmission(app);

    const approveRes = await app.request(`/admin/submissions/${sampleSubmission.id}/approve`, {
      method: "POST",
      headers: { ...adminHeader, ...JSON_CT },
      body: JSON.stringify({ adminId: "admin-discover" }),
    });
    const { submission } = await approveRes.json();
    const programId = submission.publishedProgramId;

    const catalogRes = await app.request(`/admin/catalog/${programId}`, { headers: adminHeader });
    assert.equal(catalogRes.status, 200);
    const { entry } = await catalogRes.json();
    assert.equal(entry.status, "published");
    assert.equal(entry.provenance.source, "partner-submission");
  });

  test("catalog entry contains no price fields", async () => {
    const app = await getApp();
    await seedSubmission(app);

    const res = await app.request(`/admin/submissions/${sampleSubmission.id}/approve`, {
      method: "POST",
      headers: { ...adminHeader, ...JSON_CT },
      body: JSON.stringify({ adminId: "admin-price-guard" }),
    });
    assert.equal(res.status, 200);
    const raw = JSON.stringify(await res.json());
    assert.ok(!raw.includes("memberPrice"), "no memberPrice");
    assert.ok(!raw.includes("finalPrice"), "no finalPrice");
    assert.ok(!raw.includes("nightlyAmount"), "no nightlyAmount");
    assert.ok(!raw.includes("totalAmount"), "no totalAmount");
  });
});

// ─── Submission edit ──────────────────────────────────────────────────────────

describe("submission edit", () => {
  test("PUT /admin/submissions/:id — edits programDraft of a submitted submission", async () => {
    const app = await getApp();
    await seedSubmission(app);

    const updatedDraft = {
      ...sampleSubmission.programDraft,
      name: "Updated Loyalty Program Name",
      region: "DE",
    };
    const res = await app.request(`/admin/submissions/${sampleSubmission.id}`, {
      method: "PUT",
      headers: { ...adminHeader, ...JSON_CT },
      body: JSON.stringify({ programDraft: updatedDraft }),
    });
    assert.equal(res.status, 200);
    const { submission } = await res.json();
    assert.equal(submission.programDraft.name, "Updated Loyalty Program Name");
    assert.equal(submission.programDraft.region, "DE");
    assert.ok(submission.updatedAt > sampleSubmission.updatedAt, "updatedAt advanced");
  });

  test("PUT /admin/submissions/:id — 401 without admin secret", async () => {
    const app = await getApp();
    await seedSubmission(app);
    const res = await app.request(`/admin/submissions/${sampleSubmission.id}`, {
      method: "PUT",
      headers: { ...JSON_CT },
      body: JSON.stringify({ programDraft: sampleSubmission.programDraft }),
    });
    assert.equal(res.status, 401);
  });

  test("PUT /admin/submissions/:id — 404 for unknown submission", async () => {
    const app = await getApp();
    const res = await app.request("/admin/submissions/does-not-exist", {
      method: "PUT",
      headers: { ...adminHeader, ...JSON_CT },
      body: JSON.stringify({ programDraft: sampleSubmission.programDraft }),
    });
    assert.equal(res.status, 404);
  });

  test("PUT /admin/submissions/:id — 400 when already approved", async () => {
    const app = await getApp();
    await seedSubmission(app);
    await app.request(`/admin/submissions/${sampleSubmission.id}/approve`, {
      method: "POST",
      headers: { ...adminHeader, ...JSON_CT },
      body: JSON.stringify({ adminId: "admin-user-1" }),
    });
    const res = await app.request(`/admin/submissions/${sampleSubmission.id}`, {
      method: "PUT",
      headers: { ...adminHeader, ...JSON_CT },
      body: JSON.stringify({ programDraft: sampleSubmission.programDraft }),
    });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, "invalid_transition");
  });

  test("PUT /admin/submissions/:id — 400 with price field in draft", async () => {
    const app = await getApp();
    await seedSubmission(app);
    const draftWithPrice = {
      ...sampleSubmission.programDraft,
      memberPrice: 99,
    };
    const res = await app.request(`/admin/submissions/${sampleSubmission.id}`, {
      method: "PUT",
      headers: { ...adminHeader, ...JSON_CT },
      body: JSON.stringify({ programDraft: draftWithPrice }),
    });
    assert.equal(res.status, 400);
  });

  test("PUT /admin/submissions/:id — also accepts flat programDraft (no wrapper)", async () => {
    const app = await getApp();
    await seedSubmission(app);
    const res = await app.request(`/admin/submissions/${sampleSubmission.id}`, {
      method: "PUT",
      headers: { ...adminHeader, ...JSON_CT },
      body: JSON.stringify(sampleSubmission.programDraft),
    });
    assert.equal(res.status, 200);
    const { submission } = await res.json();
    assert.equal(submission.programDraft.name, sampleSubmission.programDraft.name);
  });
});

// ─── Mark in-review ───────────────────────────────────────────────────────────

describe("mark in-review", () => {
  test("POST /admin/submissions/:id/mark-in-review — transitions submitted → in_review", async () => {
    const app = await getApp();
    await seedSubmission(app);

    const res = await app.request(`/admin/submissions/${sampleSubmission.id}/mark-in-review`, {
      method: "POST",
      headers: { ...adminHeader, ...JSON_CT },
      body: JSON.stringify({ adminId: "admin-reviewer" }),
    });
    assert.equal(res.status, 200);
    const { submission } = await res.json();
    assert.equal(submission.status, "in_review");
  });

  test("POST /admin/submissions/:id/mark-in-review — 401 without admin secret", async () => {
    const app = await getApp();
    await seedSubmission(app);
    const res = await app.request(`/admin/submissions/${sampleSubmission.id}/mark-in-review`, {
      method: "POST",
      headers: { ...JSON_CT },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 401);
  });

  test("POST /admin/submissions/:id/mark-in-review — 404 for unknown submission", async () => {
    const app = await getApp();
    const res = await app.request("/admin/submissions/does-not-exist/mark-in-review", {
      method: "POST",
      headers: { ...adminHeader, ...JSON_CT },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 404);
  });

  test("POST /admin/submissions/:id/mark-in-review — 400 when already in_review", async () => {
    const app = await getApp();
    await seedSubmission(app);
    await app.request(`/admin/submissions/${sampleSubmission.id}/mark-in-review`, {
      method: "POST",
      headers: { ...adminHeader, ...JSON_CT },
      body: JSON.stringify({}),
    });
    const res = await app.request(`/admin/submissions/${sampleSubmission.id}/mark-in-review`, {
      method: "POST",
      headers: { ...adminHeader, ...JSON_CT },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, "invalid_transition");
  });

  test("in_review submission can be approved and published", async () => {
    const app = await getApp();
    await seedSubmission(app);

    await app.request(`/admin/submissions/${sampleSubmission.id}/mark-in-review`, {
      method: "POST",
      headers: { ...adminHeader, ...JSON_CT },
      body: JSON.stringify({}),
    });

    const res = await app.request(`/admin/submissions/${sampleSubmission.id}/approve`, {
      method: "POST",
      headers: { ...adminHeader, ...JSON_CT },
      body: JSON.stringify({ adminId: "admin-final" }),
    });
    assert.equal(res.status, 200);
    const { submission, catalogEntry } = await res.json();
    assert.equal(submission.status, "approved");
    assert.equal(catalogEntry.status, "published");
  });

  test("in_review submission appears in ?status=in_review list", async () => {
    const app = await getApp();
    await seedSubmission(app);
    await app.request(`/admin/submissions/${sampleSubmission.id}/mark-in-review`, {
      method: "POST",
      headers: { ...adminHeader, ...JSON_CT },
      body: JSON.stringify({}),
    });

    const res = await app.request("/admin/submissions?status=in_review", { headers: adminHeader });
    assert.equal(res.status, 200);
    const { submissions } = await res.json();
    assert.ok(submissions.some((s: { id: string }) => s.id === sampleSubmission.id));
  });
});
