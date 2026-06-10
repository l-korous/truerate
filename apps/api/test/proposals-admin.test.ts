// Admin review queue for scraped proposals (issue #106).
//
// Covers:
//   - Auth guards on all /admin/proposals endpoints
//   - Ingest (POST) + list (GET) + view (GET /:id) + edit (PUT /:id)
//   - Approve → catalog publish with scrape-proposal provenance
//   - Reject with reason; rejected proposal removed from pending queue
//   - Price-field guard on all inputs and responses
//   - Endpoints do not expose partner submissions (source filtering)

import { test, before, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

const ADMIN_SECRET = "test-admin-secret-proposals-106";

before(() => {
  process.env.TRUERATE_INMEMORY = "true";
  process.env.TRUERATE_JWT_SECRET = "proposals-admin-test-secret";
  process.env.TRUERATE_CRED_KEY = randomBytes(32).toString("base64");
  process.env.ADMIN_SECRET = ADMIN_SECRET;
});

async function getApp() {
  const { app } = await import("../src/app.js");
  return app;
}

beforeEach(async () => {
  const { resetAppPartner } = await import("../src/app.js");
  const { resetPartnerWorkflow } = await import("@truerate/core");
  const { apiLimiter } = await import("../src/rate-limit.js");
  resetAppPartner();
  resetPartnerWorkflow();
  apiLimiter.reset("ip:unknown");
});

const adminHeader = { "x-admin-secret": ADMIN_SECRET };
const JSON_CT = { "Content-Type": "application/json" };

const sampleDraft = {
  name: "Scraped Hotel Loyalty",
  category: "hotel",
  region: "CZ",
  sourceUrl: "https://example-hotel.cz/loyalty-terms",
  fields: [{ key: "memberNumber", label: "Member Number", type: "text" }],
  benefits: {
    Silver: [
      {
        scope: "brand",
        match: { brands: ["Example Hotel"] },
        value: { kind: "percentDiscount", percentOff: 0.1 },
      },
    ],
  },
};

async function ingestProposal(app: { request: Function }, overrides: Record<string, unknown> = {}) {
  return app.request("/admin/proposals", {
    method: "POST",
    headers: { ...adminHeader, ...JSON_CT },
    body: JSON.stringify({ programDraft: { ...sampleDraft, ...overrides } }),
  });
}

// ─── Auth guards ─────────────────────────────────────────────────────────────

describe("admin proposals auth guards", () => {
  test("POST /admin/proposals — 401 without admin secret", async () => {
    const app = await getApp();
    const res = await app.request("/admin/proposals", {
      method: "POST",
      headers: { ...JSON_CT },
      body: JSON.stringify({ programDraft: sampleDraft }),
    });
    assert.equal(res.status, 401);
    assert.equal((await res.json()).error, "unauthorized");
  });

  test("GET /admin/proposals — 401 without admin secret", async () => {
    const app = await getApp();
    const res = await app.request("/admin/proposals");
    assert.equal(res.status, 401);
    assert.equal((await res.json()).error, "unauthorized");
  });

  test("GET /admin/proposals/:id — 401 without admin secret", async () => {
    const app = await getApp();
    const res = await app.request("/admin/proposals/some-id");
    assert.equal(res.status, 401);
  });

  test("PUT /admin/proposals/:id — 401 without admin secret", async () => {
    const app = await getApp();
    const res = await app.request("/admin/proposals/some-id", {
      method: "PUT",
      headers: { ...JSON_CT },
      body: JSON.stringify({ programDraft: { name: "new" } }),
    });
    assert.equal(res.status, 401);
  });

  test("POST /admin/proposals/:id/approve — 401 without admin secret", async () => {
    const app = await getApp();
    const res = await app.request("/admin/proposals/some-id/approve", {
      method: "POST",
      headers: { ...JSON_CT },
      body: JSON.stringify({ publishedProgramId: "prog-1" }),
    });
    assert.equal(res.status, 401);
  });

  test("POST /admin/proposals/:id/reject — 401 without admin secret", async () => {
    const app = await getApp();
    const res = await app.request("/admin/proposals/some-id/reject", {
      method: "POST",
      headers: { ...JSON_CT },
      body: JSON.stringify({ reason: "bad data" }),
    });
    assert.equal(res.status, 401);
  });
});

// ─── Ingest ──────────────────────────────────────────────────────────────────

describe("proposal ingest (POST /admin/proposals)", () => {
  test("creates a scraped proposal in submitted status", async () => {
    const app = await getApp();
    const res = await ingestProposal(app);
    assert.equal(res.status, 201);
    const { proposal } = await res.json();
    assert.ok(proposal.id, "id assigned");
    assert.equal(proposal.source, "scraped");
    assert.equal(proposal.status, "submitted");
    assert.equal(proposal.programDraft.name, sampleDraft.name);
  });

  test("accepts a client-supplied id", async () => {
    const app = await getApp();
    const res = await app.request("/admin/proposals", {
      method: "POST",
      headers: { ...adminHeader, ...JSON_CT },
      body: JSON.stringify({ id: "scrape-prop-42", programDraft: sampleDraft }),
    });
    assert.equal(res.status, 201);
    const { proposal } = await res.json();
    assert.equal(proposal.id, "scrape-prop-42");
  });

  test("400 when programDraft contains a price field", async () => {
    const app = await getApp();
    const res = await app.request("/admin/proposals", {
      method: "POST",
      headers: { ...adminHeader, ...JSON_CT },
      body: JSON.stringify({ programDraft: { ...sampleDraft, nightlyAmount: 99 } }),
    });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, "price_field_not_allowed");
  });

  test("400 on missing programDraft", async () => {
    const app = await getApp();
    const res = await app.request("/admin/proposals", {
      method: "POST",
      headers: { ...adminHeader, ...JSON_CT },
      body: JSON.stringify({ id: "x" }),
    });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, "validation_failed");
  });

  test("ingest response contains no price fields", async () => {
    const app = await getApp();
    const res = await ingestProposal(app);
    const raw = JSON.stringify(await res.json());
    assert.ok(!raw.includes("memberPrice"), "no memberPrice");
    assert.ok(!raw.includes("finalPrice"), "no finalPrice");
    assert.ok(!raw.includes("nightlyAmount"), "no nightlyAmount");
  });
});

// ─── List ────────────────────────────────────────────────────────────────────

describe("proposal list (GET /admin/proposals)", () => {
  test("returns submitted proposals by default", async () => {
    const app = await getApp();
    await ingestProposal(app);
    const res = await app.request("/admin/proposals", { headers: adminHeader });
    assert.equal(res.status, 200);
    const { proposals, count } = await res.json();
    assert.ok(Array.isArray(proposals));
    assert.equal(count, proposals.length);
    assert.ok(proposals.length >= 1);
    assert.ok(proposals.every((p: { source: string }) => p.source === "scraped"), "all are scraped");
  });

  test("does not include partner submissions", async () => {
    const app = await getApp();
    // Seed a partner submission directly in the repo
    const { getPartnerSubmissionRepo } = await import("@truerate/core");
    const repo = await getPartnerSubmissionRepo();
    await repo.create({
      id: "partner-sub-to-exclude",
      orgId: "org-1",
      submittedByUserId: "user-1",
      status: "submitted",
      source: "partner",
      programDraft: sampleDraft,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    const res = await app.request("/admin/proposals", { headers: adminHeader });
    const { proposals } = await res.json();
    assert.ok(!proposals.some((p: { id: string }) => p.id === "partner-sub-to-exclude"),
      "partner sub excluded from proposals list");
  });

  test("?status=approved — empty before any approvals", async () => {
    const app = await getApp();
    await ingestProposal(app);
    const res = await app.request("/admin/proposals?status=approved", { headers: adminHeader });
    assert.equal(res.status, 200);
    const { proposals } = await res.json();
    assert.equal(proposals.length, 0);
  });
});

// ─── View ─────────────────────────────────────────────────────────────────────

describe("proposal view (GET /admin/proposals/:id)", () => {
  test("returns proposal with provenance and source link", async () => {
    const app = await getApp();
    const ingestRes = await ingestProposal(app);
    const { proposal: ingested } = await ingestRes.json();

    const res = await app.request(`/admin/proposals/${ingested.id}`, { headers: adminHeader });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.proposal.id, ingested.id);
    assert.equal(body.proposal.source, "scraped");
    assert.ok(body.provenance, "provenance present");
    assert.equal(body.provenance.source, "scrape-proposal");
    assert.equal(body.provenance.sourceUrl, sampleDraft.sourceUrl);
  });

  test("404 for unknown id", async () => {
    const app = await getApp();
    const res = await app.request("/admin/proposals/does-not-exist", { headers: adminHeader });
    assert.equal(res.status, 404);
    assert.equal((await res.json()).error, "not_found");
  });

  test("404 for a partner submission id (not a scraped proposal)", async () => {
    const app = await getApp();
    const { getPartnerSubmissionRepo } = await import("@truerate/core");
    const repo = await getPartnerSubmissionRepo();
    await repo.create({
      id: "partner-sub-view-check",
      orgId: "org-1",
      submittedByUserId: "user-1",
      status: "submitted",
      source: "partner",
      programDraft: sampleDraft,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    const res = await app.request("/admin/proposals/partner-sub-view-check", { headers: adminHeader });
    assert.equal(res.status, 404);
  });
});

// ─── Edit ────────────────────────────────────────────────────────────────────

describe("proposal edit (PUT /admin/proposals/:id)", () => {
  test("edits the program draft name", async () => {
    const app = await getApp();
    const ingestRes = await ingestProposal(app);
    const { proposal: ingested } = await ingestRes.json();

    const res = await app.request(`/admin/proposals/${ingested.id}`, {
      method: "PUT",
      headers: { ...adminHeader, ...JSON_CT },
      body: JSON.stringify({ programDraft: { name: "Corrected Name" } }),
    });
    assert.equal(res.status, 200);
    const { proposal } = await res.json();
    assert.equal(proposal.programDraft.name, "Corrected Name");
    assert.equal(proposal.programDraft.region, sampleDraft.region, "other fields preserved");
  });

  test("400 when patch contains a price field", async () => {
    const app = await getApp();
    const ingestRes = await ingestProposal(app);
    const { proposal: ingested } = await ingestRes.json();

    const res = await app.request(`/admin/proposals/${ingested.id}`, {
      method: "PUT",
      headers: { ...adminHeader, ...JSON_CT },
      body: JSON.stringify({ programDraft: { nightlyAmount: 150 } }),
    });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, "price_field_not_allowed");
  });

  test("404 for unknown proposal", async () => {
    const app = await getApp();
    const res = await app.request("/admin/proposals/unknown-id", {
      method: "PUT",
      headers: { ...adminHeader, ...JSON_CT },
      body: JSON.stringify({ programDraft: { name: "x" } }),
    });
    assert.equal(res.status, 404);
  });

  test("400 when proposal already approved", async () => {
    const app = await getApp();
    const ingestRes = await ingestProposal(app);
    const { proposal: ingested } = await ingestRes.json();

    await app.request(`/admin/proposals/${ingested.id}/approve`, {
      method: "POST",
      headers: { ...adminHeader, ...JSON_CT },
      body: JSON.stringify({ publishedProgramId: "prog-edit-guard-106" }),
    });

    const res = await app.request(`/admin/proposals/${ingested.id}`, {
      method: "PUT",
      headers: { ...adminHeader, ...JSON_CT },
      body: JSON.stringify({ programDraft: { name: "Too Late" } }),
    });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, "invalid_transition");
  });
});

// ─── Approve ──────────────────────────────────────────────────────────────────

describe("proposal approve (POST /admin/proposals/:id/approve)", () => {
  test("approves and returns submission + catalogEntry", async () => {
    const app = await getApp();
    const ingestRes = await ingestProposal(app);
    const { proposal: ingested } = await ingestRes.json();

    const res = await app.request(`/admin/proposals/${ingested.id}/approve`, {
      method: "POST",
      headers: { ...adminHeader, ...JSON_CT },
      body: JSON.stringify({ publishedProgramId: "scraped-prog-106-a", adminId: "admin-1" }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.proposal.status, "approved");
    assert.equal(body.proposal.publishedProgramId, "scraped-prog-106-a");
    assert.equal(body.proposal.approvedBy, "admin-1");
    assert.ok(body.catalogEntry, "catalogEntry returned");
    assert.equal(body.catalogEntry.programId, "scraped-prog-106-a");
    assert.equal(body.catalogEntry.status, "published");
    assert.ok(body.catalogEntry.isCurrent);
  });

  test("catalog entry has scrape-proposal provenance", async () => {
    const app = await getApp();
    const ingestRes = await ingestProposal(app);
    const { proposal: ingested } = await ingestRes.json();

    const res = await app.request(`/admin/proposals/${ingested.id}/approve`, {
      method: "POST",
      headers: { ...adminHeader, ...JSON_CT },
      body: JSON.stringify({ publishedProgramId: "scraped-prog-prov-106" }),
    });
    assert.equal(res.status, 200);
    const { catalogEntry } = await res.json();
    assert.equal(catalogEntry.provenance.source, "scrape-proposal");
    assert.equal(catalogEntry.provenance.sourceUrl, sampleDraft.sourceUrl);
  });

  test("published catalog entry carries correct data from the draft", async () => {
    const app = await getApp();
    const ingestRes = await ingestProposal(app);
    const { proposal: ingested } = await ingestRes.json();

    const res = await app.request(`/admin/proposals/${ingested.id}/approve`, {
      method: "POST",
      headers: { ...adminHeader, ...JSON_CT },
      body: JSON.stringify({ publishedProgramId: "scraped-prog-data-106" }),
    });
    const { catalogEntry } = await res.json();
    assert.equal(catalogEntry.name, sampleDraft.name);
    assert.equal(catalogEntry.region, sampleDraft.region);
  });

  test("defaultMatch defaults to program name brand when absent", async () => {
    const app = await getApp();
    const noDraftMatch = { ...sampleDraft };
    delete (noDraftMatch as Record<string, unknown>).defaultMatch;
    const res1 = await app.request("/admin/proposals", {
      method: "POST",
      headers: { ...adminHeader, ...JSON_CT },
      body: JSON.stringify({ programDraft: noDraftMatch }),
    });
    const { proposal: ingested } = await res1.json();

    const res = await app.request(`/admin/proposals/${ingested.id}/approve`, {
      method: "POST",
      headers: { ...adminHeader, ...JSON_CT },
      body: JSON.stringify({ publishedProgramId: "scraped-prog-match-106" }),
    });
    const { catalogEntry } = await res.json();
    assert.deepEqual(catalogEntry.defaultMatch.brands, [sampleDraft.name]);
  });

  test("approved proposal appears in ?status=approved list", async () => {
    const app = await getApp();
    const ingestRes = await ingestProposal(app);
    const { proposal: ingested } = await ingestRes.json();

    await app.request(`/admin/proposals/${ingested.id}/approve`, {
      method: "POST",
      headers: { ...adminHeader, ...JSON_CT },
      body: JSON.stringify({ publishedProgramId: "scraped-prog-list-check" }),
    });

    const listRes = await app.request("/admin/proposals?status=approved", { headers: adminHeader });
    const { proposals } = await listRes.json();
    assert.ok(proposals.some((p: { id: string }) => p.id === ingested.id));
  });

  test("400 without publishedProgramId", async () => {
    const app = await getApp();
    const ingestRes = await ingestProposal(app);
    const { proposal: ingested } = await ingestRes.json();
    const res = await app.request(`/admin/proposals/${ingested.id}/approve`, {
      method: "POST",
      headers: { ...adminHeader, ...JSON_CT },
      body: JSON.stringify({ publishedProgramId: "" }),
    });
    assert.equal(res.status, 400);
  });

  test("404 for unknown proposal", async () => {
    const app = await getApp();
    const res = await app.request("/admin/proposals/does-not-exist/approve", {
      method: "POST",
      headers: { ...adminHeader, ...JSON_CT },
      body: JSON.stringify({ publishedProgramId: "prog-1" }),
    });
    assert.equal(res.status, 404);
  });

  test("400 on invalid_transition (already approved)", async () => {
    const app = await getApp();
    const ingestRes = await ingestProposal(app);
    const { proposal: ingested } = await ingestRes.json();

    await app.request(`/admin/proposals/${ingested.id}/approve`, {
      method: "POST",
      headers: { ...adminHeader, ...JSON_CT },
      body: JSON.stringify({ publishedProgramId: "prog-first" }),
    });
    const res = await app.request(`/admin/proposals/${ingested.id}/approve`, {
      method: "POST",
      headers: { ...adminHeader, ...JSON_CT },
      body: JSON.stringify({ publishedProgramId: "prog-second" }),
    });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, "invalid_transition");
  });

  test("published output contains no price fields", async () => {
    const app = await getApp();
    const ingestRes = await ingestProposal(app);
    const { proposal: ingested } = await ingestRes.json();

    const res = await app.request(`/admin/proposals/${ingested.id}/approve`, {
      method: "POST",
      headers: { ...adminHeader, ...JSON_CT },
      body: JSON.stringify({ publishedProgramId: "scraped-prog-price-check-106" }),
    });
    assert.equal(res.status, 200);
    const raw = JSON.stringify(await res.json());
    assert.ok(!raw.includes("memberPrice"), "no memberPrice");
    assert.ok(!raw.includes("finalPrice"), "no finalPrice");
    assert.ok(!raw.includes("nightlyAmount"), "no nightlyAmount");
    assert.ok(!raw.includes("totalAmount"), "no totalAmount");
  });

  test("approved catalog entry retrievable from catalog admin endpoint", async () => {
    const app = await getApp();
    const ingestRes = await ingestProposal(app);
    const { proposal: ingested } = await ingestRes.json();

    await app.request(`/admin/proposals/${ingested.id}/approve`, {
      method: "POST",
      headers: { ...adminHeader, ...JSON_CT },
      body: JSON.stringify({ publishedProgramId: "scraped-prog-retrieval-106" }),
    });

    const catalogRes = await app.request("/admin/catalog/scraped-prog-retrieval-106", {
      headers: adminHeader,
    });
    assert.equal(catalogRes.status, 200);
    const { entry } = await catalogRes.json();
    assert.equal(entry.status, "published");
    assert.equal(entry.provenance.source, "scrape-proposal");
  });

  test("edit then approve publishes the edited draft", async () => {
    const app = await getApp();
    const ingestRes = await ingestProposal(app);
    const { proposal: ingested } = await ingestRes.json();

    await app.request(`/admin/proposals/${ingested.id}`, {
      method: "PUT",
      headers: { ...adminHeader, ...JSON_CT },
      body: JSON.stringify({ programDraft: { name: "Admin Corrected Name" } }),
    });

    const res = await app.request(`/admin/proposals/${ingested.id}/approve`, {
      method: "POST",
      headers: { ...adminHeader, ...JSON_CT },
      body: JSON.stringify({ publishedProgramId: "scraped-prog-edit-approve-106" }),
    });
    assert.equal(res.status, 200);
    const { catalogEntry } = await res.json();
    assert.equal(catalogEntry.name, "Admin Corrected Name");
  });
});

// ─── Reject ───────────────────────────────────────────────────────────────────

describe("proposal reject (POST /admin/proposals/:id/reject)", () => {
  test("rejects with a reason, records who/when", async () => {
    const app = await getApp();
    const ingestRes = await ingestProposal(app);
    const { proposal: ingested } = await ingestRes.json();

    const res = await app.request(`/admin/proposals/${ingested.id}/reject`, {
      method: "POST",
      headers: { ...adminHeader, ...JSON_CT },
      body: JSON.stringify({ reason: "Incomplete benefit data.", adminId: "admin-2" }),
    });
    assert.equal(res.status, 200);
    const { proposal } = await res.json();
    assert.equal(proposal.status, "rejected");
    assert.equal(proposal.rejectReason, "Incomplete benefit data.");
    assert.equal(proposal.rejectedBy, "admin-2");
    assert.ok(!proposal.publishedProgramId, "no publishedProgramId on rejection");
  });

  test("rejected proposal removed from pending queue (no longer in submitted list)", async () => {
    const app = await getApp();
    const ingestRes = await ingestProposal(app);
    const { proposal: ingested } = await ingestRes.json();

    await app.request(`/admin/proposals/${ingested.id}/reject`, {
      method: "POST",
      headers: { ...adminHeader, ...JSON_CT },
      body: JSON.stringify({ reason: "Poor data quality." }),
    });

    const listRes = await app.request("/admin/proposals", { headers: adminHeader });
    const { proposals } = await listRes.json();
    assert.ok(!proposals.some((p: { id: string }) => p.id === ingested.id),
      "rejected proposal absent from submitted queue");
  });

  test("rejected proposal appears in ?status=rejected list", async () => {
    const app = await getApp();
    const ingestRes = await ingestProposal(app);
    const { proposal: ingested } = await ingestRes.json();

    await app.request(`/admin/proposals/${ingested.id}/reject`, {
      method: "POST",
      headers: { ...adminHeader, ...JSON_CT },
      body: JSON.stringify({ reason: "Test rejection." }),
    });

    const listRes = await app.request("/admin/proposals?status=rejected", { headers: adminHeader });
    const { proposals } = await listRes.json();
    assert.ok(proposals.some((p: { id: string }) => p.id === ingested.id));
  });

  test("400 without reason", async () => {
    const app = await getApp();
    const ingestRes = await ingestProposal(app);
    const { proposal: ingested } = await ingestRes.json();
    const res = await app.request(`/admin/proposals/${ingested.id}/reject`, {
      method: "POST",
      headers: { ...adminHeader, ...JSON_CT },
      body: JSON.stringify({ reason: "" }),
    });
    assert.equal(res.status, 400);
  });

  test("404 for unknown proposal", async () => {
    const app = await getApp();
    const res = await app.request("/admin/proposals/does-not-exist/reject", {
      method: "POST",
      headers: { ...adminHeader, ...JSON_CT },
      body: JSON.stringify({ reason: "bad data" }),
    });
    assert.equal(res.status, 404);
  });

  test("400 on invalid_transition (already rejected)", async () => {
    const app = await getApp();
    const ingestRes = await ingestProposal(app);
    const { proposal: ingested } = await ingestRes.json();

    await app.request(`/admin/proposals/${ingested.id}/reject`, {
      method: "POST",
      headers: { ...adminHeader, ...JSON_CT },
      body: JSON.stringify({ reason: "First rejection." }),
    });
    const res = await app.request(`/admin/proposals/${ingested.id}/reject`, {
      method: "POST",
      headers: { ...adminHeader, ...JSON_CT },
      body: JSON.stringify({ reason: "Second rejection." }),
    });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, "invalid_transition");
  });

  test("rejection response contains no price fields", async () => {
    const app = await getApp();
    const ingestRes = await ingestProposal(app);
    const { proposal: ingested } = await ingestRes.json();

    const res = await app.request(`/admin/proposals/${ingested.id}/reject`, {
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
