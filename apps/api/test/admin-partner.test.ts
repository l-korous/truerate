// Tests for admin partner-org and submission review routes (#75).
//
// Covers:
//   - RBAC: all admin routes reject missing/invalid x-admin-secret
//   - GET /admin/partners?status=pending — list pending orgs
//   - POST /admin/partners/:id/approve — approve a partner org (records who/when)
//   - POST /admin/partners/:id/reject  — reject a partner org with reason
//   - GET /admin/submissions            — list submission queue (default: submitted)
//   - GET /admin/submissions/:id        — full submission detail
//   - POST /admin/submissions/:id/approve — approve → flows to catalog draft (no prices)
//   - POST /admin/submissions/:id/reject  — reject with reason
//
// All repos are in-memory; no live Cosmos or Entra is required.

import { test, describe, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  MemoryPartnerOrgRepo,
  MemoryPartnerSubmissionRepo,
  MemoryPartnerNotificationRepo,
  PartnerWorkflow,
  type PartnerOrg,
  type PartnerProgramDraft,
  type PartnerSubmission,
} from "@truerate/core";

// ---------------------------------------------------------------------------
// Env setup (must run before any dynamic import of app.ts)
// ---------------------------------------------------------------------------

before(() => {
  process.env.TRUERATE_INMEMORY = "true";
  process.env.TRUERATE_JWT_SECRET = "admin-partner-test-secret";
  process.env.TRUERATE_CRED_KEY = randomBytes(32).toString("base64");
  process.env.ADMIN_SECRET = "test-admin-secret-123";
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getApp() {
  const { app } = await import("../src/app.js");
  return app;
}

function adminHeader() {
  return { "x-admin-secret": "test-admin-secret-123", "Content-Type": "application/json" };
}

const TEST_ORG: PartnerOrg = {
  id: "org-admin-test-hotel",
  name: "Admin Test Hotel Group",
  country: "CZ",
  contactEmail: "partner@admintesthotel.cz",
  status: "pending",
  createdAt: "2026-01-01T00:00:00.000Z",
};

const TEST_ORG_2: PartnerOrg = {
  id: "org-admin-test-hotel-2",
  name: "Second Test Hotel",
  country: "DE",
  contactEmail: "partner@secondhotel.de",
  status: "pending",
  createdAt: "2026-01-02T00:00:00.000Z",
};

const VALID_DRAFT: PartnerProgramDraft = {
  name: "Admin Test Hotel Loyalty",
  category: "hotel",
  region: "CZ",
  sourceUrl: "https://admintesthotel.cz/loyalty",
  tiers: ["Silver", "Gold"],
  fields: [{ key: "membershipNumber", label: "Membership Number", type: "text" }],
  benefits: {
    Silver: [
      {
        scope: "brand",
        match: { brands: ["Admin Test Hotel Group"] },
        value: { kind: "percentDiscount", percentOff: 0.1, conditions: "direct booking only" },
      },
    ],
    Gold: [
      {
        scope: "brand",
        match: { brands: ["Admin Test Hotel Group"] },
        value: { kind: "percentDiscount", percentOff: 0.2, conditions: "direct booking only" },
      },
    ],
  },
};

/** Seed the partner repos with a test org, associate a user, and create + submit a submission. */
async function seedPartnerState(submissionId = "sub-admin-test-1") {
  const orgRepo = new MemoryPartnerOrgRepo();
  const submissionRepo = new MemoryPartnerSubmissionRepo();
  const notificationRepo = new MemoryPartnerNotificationRepo();
  await orgRepo.init();
  await submissionRepo.init();
  const workflow = new PartnerWorkflow(orgRepo, submissionRepo, notificationRepo);

  await orgRepo.createOrg(TEST_ORG);
  await orgRepo.createOrg(TEST_ORG_2);
  await workflow.associateUser("test-owner-user", TEST_ORG.id, "owner");
  await workflow.createDraft("test-owner-user", TEST_ORG.id, VALID_DRAFT, submissionId);
  const submitted = await workflow.submitForReview("test-owner-user", submissionId);
  return { orgRepo, submissionRepo, notificationRepo, workflow, submitted };
}

// ---------------------------------------------------------------------------
// Reset state between tests
// ---------------------------------------------------------------------------

beforeEach(async () => {
  const { resetAppCatalog, resetAppPartnerRepos } = await import("../src/app.js");
  const { resetCatalogRepo } = await import("@truerate/core");
  resetAppCatalog();
  resetAppPartnerRepos();
  resetCatalogRepo();
});

// ---------------------------------------------------------------------------
// RBAC: all admin partner routes reject missing / wrong secret
// ---------------------------------------------------------------------------

describe("admin partner routes: RBAC", () => {
  test("GET /admin/partners returns 401 with no secret", async () => {
    const app = await getApp();
    const res = await app.request("/admin/partners");
    assert.equal(res.status, 401);
    assert.equal((await res.json()).error, "unauthorized");
  });

  test("GET /admin/partners returns 401 with wrong secret", async () => {
    const app = await getApp();
    const res = await app.request("/admin/partners", {
      headers: { "x-admin-secret": "wrong-secret" },
    });
    assert.equal(res.status, 401);
  });

  test("POST /admin/partners/:id/approve returns 401 with no secret", async () => {
    const app = await getApp();
    const res = await app.request("/admin/partners/some-org/approve", { method: "POST", body: "{}" });
    assert.equal(res.status, 401);
  });

  test("POST /admin/partners/:id/reject returns 401 with no secret", async () => {
    const app = await getApp();
    const res = await app.request("/admin/partners/some-org/reject", { method: "POST", body: "{}" });
    assert.equal(res.status, 401);
  });

  test("GET /admin/submissions returns 401 with no secret", async () => {
    const app = await getApp();
    const res = await app.request("/admin/submissions");
    assert.equal(res.status, 401);
  });

  test("GET /admin/submissions/:id returns 401 with no secret", async () => {
    const app = await getApp();
    const res = await app.request("/admin/submissions/some-sub");
    assert.equal(res.status, 401);
  });

  test("POST /admin/submissions/:id/approve returns 401 with no secret", async () => {
    const app = await getApp();
    const res = await app.request("/admin/submissions/some-sub/approve", { method: "POST", body: "{}" });
    assert.equal(res.status, 401);
  });

  test("POST /admin/submissions/:id/reject returns 401 with no secret", async () => {
    const app = await getApp();
    const res = await app.request("/admin/submissions/some-sub/reject", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "test" }),
    });
    assert.equal(res.status, 401);
  });
});

// ---------------------------------------------------------------------------
// GET /admin/partners — list partner orgs by status
// ---------------------------------------------------------------------------

describe("GET /admin/partners", () => {
  test("returns empty array when no orgs exist", async () => {
    const app = await getApp();
    const res = await app.request("/admin/partners", { headers: adminHeader() });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.orgs));
    assert.equal(body.status, "pending");
  });

  test("returns pending orgs seeded via repo", async () => {
    await seedPartnerState();
    const app = await getApp();
    // After seeding, the singletons in the app will be fresh (reset by beforeEach).
    // We need to seed via the app's own singleton path.
    // Instead, create orgs via the partner workflow singletons directly.
    const { getPartnerOrgRepo: getOrgRepo } = await import("@truerate/core");
    const orgRepo = await getOrgRepo();
    await orgRepo.createOrg(TEST_ORG);
    await orgRepo.createOrg(TEST_ORG_2);

    const res = await app.request("/admin/partners", { headers: adminHeader() });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.orgs.length >= 2, "at least 2 pending orgs");
    assert.ok(body.orgs.every((o: PartnerOrg) => o.status === "pending"));
  });

  test("filters by status=active", async () => {
    const { getPartnerOrgRepo: getOrgRepo } = await import("@truerate/core");
    const orgRepo = await getOrgRepo();
    await orgRepo.createOrg({ ...TEST_ORG, status: "active" });
    await orgRepo.createOrg(TEST_ORG_2); // pending

    const app = await getApp();
    const res = await app.request("/admin/partners?status=active", { headers: adminHeader() });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, "active");
    assert.ok(body.orgs.every((o: PartnerOrg) => o.status === "active"));
  });

  test("response contains no price fields", async () => {
    const { getPartnerOrgRepo: getOrgRepo } = await import("@truerate/core");
    const orgRepo = await getOrgRepo();
    await orgRepo.createOrg(TEST_ORG);
    const app = await getApp();
    const res = await app.request("/admin/partners", { headers: adminHeader() });
    const raw = JSON.stringify(await res.json());
    assert.ok(!raw.includes('"price"'), "no price field");
    assert.ok(!raw.includes('"amount"'), "no amount field");
    assert.ok(!raw.includes('"nightly"'), "no nightly field");
  });
});

// ---------------------------------------------------------------------------
// POST /admin/partners/:id/approve
// ---------------------------------------------------------------------------

describe("POST /admin/partners/:id/approve", () => {
  test("approves a pending org and records approvedAt/approvedBy", async () => {
    const { getPartnerOrgRepo: getOrgRepo } = await import("@truerate/core");
    const orgRepo = await getOrgRepo();
    await orgRepo.createOrg(TEST_ORG);

    const app = await getApp();
    const res = await app.request(`/admin/partners/${TEST_ORG.id}/approve`, {
      method: "POST",
      headers: adminHeader(),
      body: "{}",
    });
    assert.equal(res.status, 200);
    const { org } = await res.json();
    assert.equal(org.status, "active");
    assert.ok(org.approvedAt, "approvedAt set");
    assert.equal(org.approvedBy, "admin");
    assert.match(org.approvedAt, /^\d{4}-\d{2}-\d{2}T/, "approvedAt is ISO date");
  });

  test("returns 404 for unknown org", async () => {
    const app = await getApp();
    const res = await app.request("/admin/partners/nonexistent-org/approve", {
      method: "POST",
      headers: adminHeader(),
      body: "{}",
    });
    assert.equal(res.status, 404);
    assert.equal((await res.json()).error, "not_found");
  });

  test("returns 409 when org is already active", async () => {
    const { getPartnerOrgRepo: getOrgRepo } = await import("@truerate/core");
    const orgRepo = await getOrgRepo();
    await orgRepo.createOrg({ ...TEST_ORG, status: "active" });

    const app = await getApp();
    const res = await app.request(`/admin/partners/${TEST_ORG.id}/approve`, {
      method: "POST",
      headers: adminHeader(),
      body: "{}",
    });
    assert.equal(res.status, 409);
  });
});

// ---------------------------------------------------------------------------
// POST /admin/partners/:id/reject
// ---------------------------------------------------------------------------

describe("POST /admin/partners/:id/reject", () => {
  test("rejects a pending org and records rejectedAt/rejectedBy/reason", async () => {
    const { getPartnerOrgRepo: getOrgRepo } = await import("@truerate/core");
    const orgRepo = await getOrgRepo();
    await orgRepo.createOrg(TEST_ORG);

    const app = await getApp();
    const res = await app.request(`/admin/partners/${TEST_ORG.id}/reject`, {
      method: "POST",
      headers: adminHeader(),
      body: JSON.stringify({ reason: "Incomplete contact information." }),
    });
    assert.equal(res.status, 200);
    const { org } = await res.json();
    assert.equal(org.status, "rejected");
    assert.equal(org.rejectReason, "Incomplete contact information.");
    assert.ok(org.rejectedAt, "rejectedAt set");
    assert.equal(org.rejectedBy, "admin");
  });

  test("returns 404 for unknown org", async () => {
    const app = await getApp();
    const res = await app.request("/admin/partners/nonexistent-org/reject", {
      method: "POST",
      headers: adminHeader(),
      body: JSON.stringify({ reason: "test" }),
    });
    assert.equal(res.status, 404);
  });

  test("returns 409 when org is already rejected", async () => {
    const { getPartnerOrgRepo: getOrgRepo } = await import("@truerate/core");
    const orgRepo = await getOrgRepo();
    await orgRepo.createOrg({ ...TEST_ORG, status: "rejected" });

    const app = await getApp();
    const res = await app.request(`/admin/partners/${TEST_ORG.id}/reject`, {
      method: "POST",
      headers: adminHeader(),
      body: JSON.stringify({ reason: "again" }),
    });
    assert.equal(res.status, 409);
  });

  test("reject with empty body defaults to empty reason (no crash)", async () => {
    const { getPartnerOrgRepo: getOrgRepo } = await import("@truerate/core");
    const orgRepo = await getOrgRepo();
    await orgRepo.createOrg({ ...TEST_ORG, id: "org-reject-no-reason" });

    const app = await getApp();
    const res = await app.request("/admin/partners/org-reject-no-reason/reject", {
      method: "POST",
      headers: adminHeader(),
      body: "{}",
    });
    assert.equal(res.status, 200);
    const { org } = await res.json();
    assert.equal(org.status, "rejected");
  });
});

// ---------------------------------------------------------------------------
// GET /admin/submissions
// ---------------------------------------------------------------------------

describe("GET /admin/submissions", () => {
  test("returns empty array when no submissions exist", async () => {
    const app = await getApp();
    const res = await app.request("/admin/submissions", { headers: adminHeader() });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.submissions));
    assert.equal(body.status, "submitted");
  });

  test("returns submitted submissions after seeding", async () => {
    const { getPartnerOrgRepo: getOrgRepo, getPartnerSubmissionRepo: getSubRepo,
      getPartnerNotificationRepo: getNotifRepo, PartnerWorkflow: PW } = await import("@truerate/core");
    const orgRepo = await getOrgRepo();
    const submissionRepo = await getSubRepo();
    const notifRepo = await getNotifRepo();
    const workflow = new PW(orgRepo, submissionRepo, notifRepo);

    await orgRepo.createOrg(TEST_ORG);
    await workflow.associateUser("test-owner", TEST_ORG.id, "owner");
    await workflow.createDraft("test-owner", TEST_ORG.id, VALID_DRAFT, "sub-list-test-1");
    await workflow.submitForReview("test-owner", "sub-list-test-1");

    const app = await getApp();
    const res = await app.request("/admin/submissions", { headers: adminHeader() });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.submissions.length >= 1);
    const sub = body.submissions.find((s: { id: string }) => s.id === "sub-list-test-1");
    assert.ok(sub, "submission found in queue");
    assert.equal(sub.status, "submitted");
    assert.equal(sub.source, "partner-submission");
  });

  test("filters by status=approved", async () => {
    const { getPartnerOrgRepo: getOrgRepo, getPartnerSubmissionRepo: getSubRepo,
      getPartnerNotificationRepo: getNotifRepo, PartnerWorkflow: PW } = await import("@truerate/core");
    const orgRepo = await getOrgRepo();
    const subRepo = await getSubRepo();
    const notifRepo = await getNotifRepo();
    const workflow = new PW(orgRepo, subRepo, notifRepo);

    await orgRepo.createOrg({ ...TEST_ORG, id: "org-filter-test" });
    await workflow.associateUser("filter-owner", "org-filter-test", "owner");
    await workflow.createDraft("filter-owner", "org-filter-test", VALID_DRAFT, "sub-filter-approved");
    await workflow.submitForReview("filter-owner", "sub-filter-approved");
    await workflow.approve("sub-filter-approved", "partner-prog-filter-test-v1");

    const app = await getApp();
    const res = await app.request("/admin/submissions?status=approved", { headers: adminHeader() });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, "approved");
    const found = body.submissions.find((s: { id: string }) => s.id === "sub-filter-approved");
    assert.ok(found, "approved submission is in the approved queue");
  });

  test("response has no price fields", async () => {
    const app = await getApp();
    const res = await app.request("/admin/submissions", { headers: adminHeader() });
    const raw = JSON.stringify(await res.json());
    assert.ok(!raw.includes('"price"'), "no price field");
    assert.ok(!raw.includes('"nightly"'), "no nightly field");
    assert.ok(!raw.includes('"finalPrice"'), "no finalPrice field");
    assert.ok(!raw.includes('"memberPrice"'), "no memberPrice field");
  });
});

// ---------------------------------------------------------------------------
// GET /admin/submissions/:id
// ---------------------------------------------------------------------------

describe("GET /admin/submissions/:id", () => {
  test("returns full submission detail", async () => {
    const { getPartnerOrgRepo: getOrgRepo, getPartnerSubmissionRepo: getSubRepo,
      getPartnerNotificationRepo: getNotifRepo, PartnerWorkflow: PW } = await import("@truerate/core");
    const orgRepo = await getOrgRepo();
    const subRepo = await getSubRepo();
    const notifRepo = await getNotifRepo();
    const workflow = new PW(orgRepo, subRepo, notifRepo);

    await orgRepo.createOrg({ ...TEST_ORG, id: "org-detail-test" });
    await workflow.associateUser("detail-owner", "org-detail-test", "owner");
    await workflow.createDraft("detail-owner", "org-detail-test", VALID_DRAFT, "sub-detail-test");
    await workflow.submitForReview("detail-owner", "sub-detail-test");

    const app = await getApp();
    const res = await app.request("/admin/submissions/sub-detail-test", { headers: adminHeader() });
    assert.equal(res.status, 200);
    const { submission } = await res.json();
    assert.equal(submission.id, "sub-detail-test");
    assert.ok(submission.programDraft, "includes full programDraft");
    assert.equal(submission.programDraft.name, VALID_DRAFT.name);
  });

  test("returns 404 for unknown submission", async () => {
    const app = await getApp();
    const res = await app.request("/admin/submissions/nonexistent-sub", { headers: adminHeader() });
    assert.equal(res.status, 404);
    assert.equal((await res.json()).error, "not_found");
  });
});

// ---------------------------------------------------------------------------
// POST /admin/submissions/:id/approve
// ---------------------------------------------------------------------------

describe("POST /admin/submissions/:id/approve", () => {
  test("approves a submission and creates a catalog draft", async () => {
    const { getPartnerOrgRepo: getOrgRepo, getPartnerSubmissionRepo: getSubRepo,
      getPartnerNotificationRepo: getNotifRepo, PartnerWorkflow: PW } = await import("@truerate/core");
    const orgRepo = await getOrgRepo();
    const subRepo = await getSubRepo();
    const notifRepo = await getNotifRepo();
    const workflow = new PW(orgRepo, subRepo, notifRepo);

    await orgRepo.createOrg({ ...TEST_ORG, id: "org-approve-sub-test" });
    await workflow.associateUser("approve-sub-owner", "org-approve-sub-test", "owner");
    await workflow.createDraft("approve-sub-owner", "org-approve-sub-test", VALID_DRAFT, "sub-approve-api-1");
    await workflow.submitForReview("approve-sub-owner", "sub-approve-api-1");

    const app = await getApp();
    const res = await app.request("/admin/submissions/sub-approve-api-1/approve", {
      method: "POST",
      headers: adminHeader(),
      body: "{}",
    });
    assert.equal(res.status, 200);
    const body = await res.json();

    // Submission is approved with audit fields
    assert.equal(body.submission.status, "approved");
    assert.ok(body.submission.publishedProgramId, "publishedProgramId is set");
    assert.ok(body.submission.approvedAt, "approvedAt is set");
    assert.equal(body.submission.approvedBy, "admin");

    // Catalog draft was created
    assert.ok(body.catalogEntry, "catalogEntry returned");
    assert.equal(body.catalogEntry.name, VALID_DRAFT.name);
    assert.equal(body.catalogEntry.provenance.source, "partner-submission");
    assert.equal(body.catalogEntry.status, "draft");
  });

  test("allows custom publishedProgramId", async () => {
    const { getPartnerOrgRepo: getOrgRepo, getPartnerSubmissionRepo: getSubRepo,
      getPartnerNotificationRepo: getNotifRepo, PartnerWorkflow: PW } = await import("@truerate/core");
    const orgRepo = await getOrgRepo();
    const subRepo = await getSubRepo();
    const notifRepo = await getNotifRepo();
    const workflow = new PW(orgRepo, subRepo, notifRepo);

    await orgRepo.createOrg({ ...TEST_ORG, id: "org-custom-prog-id" });
    await workflow.associateUser("custom-owner", "org-custom-prog-id", "owner");
    await workflow.createDraft("custom-owner", "org-custom-prog-id", VALID_DRAFT, "sub-custom-prog-id");
    await workflow.submitForReview("custom-owner", "sub-custom-prog-id");

    const app = await getApp();
    const res = await app.request("/admin/submissions/sub-custom-prog-id/approve", {
      method: "POST",
      headers: adminHeader(),
      body: JSON.stringify({ publishedProgramId: "my-custom-program-id" }),
    });
    assert.equal(res.status, 200);
    const { submission } = await res.json();
    assert.equal(submission.publishedProgramId, "my-custom-program-id");
  });

  test("returns 404 for unknown submission", async () => {
    const app = await getApp();
    const res = await app.request("/admin/submissions/nonexistent-sub/approve", {
      method: "POST",
      headers: adminHeader(),
      body: "{}",
    });
    assert.equal(res.status, 404);
  });

  test("returns 409 for already-approved submission", async () => {
    const { getPartnerOrgRepo: getOrgRepo, getPartnerSubmissionRepo: getSubRepo,
      getPartnerNotificationRepo: getNotifRepo, PartnerWorkflow: PW } = await import("@truerate/core");
    const orgRepo = await getOrgRepo();
    const subRepo = await getSubRepo();
    const notifRepo = await getNotifRepo();
    const workflow = new PW(orgRepo, subRepo, notifRepo);

    await orgRepo.createOrg({ ...TEST_ORG, id: "org-double-approve" });
    await workflow.associateUser("double-owner", "org-double-approve", "owner");
    await workflow.createDraft("double-owner", "org-double-approve", VALID_DRAFT, "sub-double-approve");
    await workflow.submitForReview("double-owner", "sub-double-approve");
    await workflow.approve("sub-double-approve", "prog-already-approved");

    const app = await getApp();
    const res = await app.request("/admin/submissions/sub-double-approve/approve", {
      method: "POST",
      headers: adminHeader(),
      body: "{}",
    });
    assert.equal(res.status, 409);
  });

  test("catalog entry provenance has no price fields", async () => {
    const { getPartnerOrgRepo: getOrgRepo, getPartnerSubmissionRepo: getSubRepo,
      getPartnerNotificationRepo: getNotifRepo, PartnerWorkflow: PW } = await import("@truerate/core");
    const orgRepo = await getOrgRepo();
    const subRepo = await getSubRepo();
    const notifRepo = await getNotifRepo();
    const workflow = new PW(orgRepo, subRepo, notifRepo);

    await orgRepo.createOrg({ ...TEST_ORG, id: "org-no-price-check" });
    await workflow.associateUser("np-owner", "org-no-price-check", "owner");
    await workflow.createDraft("np-owner", "org-no-price-check", VALID_DRAFT, "sub-no-price-check");
    await workflow.submitForReview("np-owner", "sub-no-price-check");

    const app = await getApp();
    const res = await app.request("/admin/submissions/sub-no-price-check/approve", {
      method: "POST",
      headers: adminHeader(),
      body: "{}",
    });
    assert.equal(res.status, 200);
    const raw = JSON.stringify(await res.json());
    assert.ok(!raw.includes('"price"'), "no price field");
    assert.ok(!raw.includes('"nightly"'), "no nightly field");
    assert.ok(!raw.includes('"finalPrice"'), "no finalPrice field");
    assert.ok(!raw.includes('"memberPrice"'), "no memberPrice field");
  });
});

// ---------------------------------------------------------------------------
// POST /admin/submissions/:id/reject
// ---------------------------------------------------------------------------

describe("POST /admin/submissions/:id/reject", () => {
  test("rejects a submission with a reason and records audit fields", async () => {
    const { getPartnerOrgRepo: getOrgRepo, getPartnerSubmissionRepo: getSubRepo,
      getPartnerNotificationRepo: getNotifRepo, PartnerWorkflow: PW } = await import("@truerate/core");
    const orgRepo = await getOrgRepo();
    const subRepo = await getSubRepo();
    const notifRepo = await getNotifRepo();
    const workflow = new PW(orgRepo, subRepo, notifRepo);

    await orgRepo.createOrg({ ...TEST_ORG, id: "org-reject-sub-test" });
    await workflow.associateUser("reject-sub-owner", "org-reject-sub-test", "owner");
    await workflow.createDraft("reject-sub-owner", "org-reject-sub-test", VALID_DRAFT, "sub-reject-api-1");
    await workflow.submitForReview("reject-sub-owner", "sub-reject-api-1");

    const app = await getApp();
    const res = await app.request("/admin/submissions/sub-reject-api-1/reject", {
      method: "POST",
      headers: adminHeader(),
      body: JSON.stringify({ reason: "Benefit descriptions are too vague." }),
    });
    assert.equal(res.status, 200);
    const { submission } = await res.json();
    assert.equal(submission.status, "rejected");
    assert.equal(submission.rejectReason, "Benefit descriptions are too vague.");
    assert.ok(submission.rejectedAt, "rejectedAt is set");
    assert.equal(submission.rejectedBy, "admin");
  });

  test("returns 400 when reason is missing", async () => {
    const app = await getApp();
    const res = await app.request("/admin/submissions/some-sub/reject", {
      method: "POST",
      headers: adminHeader(),
      body: "{}",
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error, "validation_failed");
  });

  test("returns 404 for unknown submission", async () => {
    const app = await getApp();
    const res = await app.request("/admin/submissions/nonexistent/reject", {
      method: "POST",
      headers: adminHeader(),
      body: JSON.stringify({ reason: "not found" }),
    });
    assert.equal(res.status, 404);
  });

  test("returns 409 when submission is already rejected", async () => {
    const { getPartnerOrgRepo: getOrgRepo, getPartnerSubmissionRepo: getSubRepo,
      getPartnerNotificationRepo: getNotifRepo, PartnerWorkflow: PW } = await import("@truerate/core");
    const orgRepo = await getOrgRepo();
    const subRepo = await getSubRepo();
    const notifRepo = await getNotifRepo();
    const workflow = new PW(orgRepo, subRepo, notifRepo);

    await orgRepo.createOrg({ ...TEST_ORG, id: "org-double-reject" });
    await workflow.associateUser("dr-owner", "org-double-reject", "owner");
    await workflow.createDraft("dr-owner", "org-double-reject", VALID_DRAFT, "sub-double-reject");
    await workflow.submitForReview("dr-owner", "sub-double-reject");
    await workflow.reject("sub-double-reject", "First rejection");

    const app = await getApp();
    const res = await app.request("/admin/submissions/sub-double-reject/reject", {
      method: "POST",
      headers: adminHeader(),
      body: JSON.stringify({ reason: "Second rejection attempt" }),
    });
    assert.equal(res.status, 409);
  });

  test("rejection response has no price fields", async () => {
    const { getPartnerOrgRepo: getOrgRepo, getPartnerSubmissionRepo: getSubRepo,
      getPartnerNotificationRepo: getNotifRepo, PartnerWorkflow: PW } = await import("@truerate/core");
    const orgRepo = await getOrgRepo();
    const subRepo = await getSubRepo();
    const notifRepo = await getNotifRepo();
    const workflow = new PW(orgRepo, subRepo, notifRepo);

    await orgRepo.createOrg({ ...TEST_ORG, id: "org-no-price-reject" });
    await workflow.associateUser("npr-owner", "org-no-price-reject", "owner");
    await workflow.createDraft("npr-owner", "org-no-price-reject", VALID_DRAFT, "sub-no-price-reject");
    await workflow.submitForReview("npr-owner", "sub-no-price-reject");

    const app = await getApp();
    const res = await app.request("/admin/submissions/sub-no-price-reject/reject", {
      method: "POST",
      headers: adminHeader(),
      body: JSON.stringify({ reason: "test rejection for price check" }),
    });
    assert.equal(res.status, 200);
    const raw = JSON.stringify(await res.json());
    assert.ok(!raw.includes('"price"'), "no price field");
    assert.ok(!raw.includes('"nightly"'), "no nightly field");
    assert.ok(!raw.includes('"finalPrice"'), "no finalPrice field");
    assert.ok(!raw.includes('"memberPrice"'), "no memberPrice field");
  });
});
