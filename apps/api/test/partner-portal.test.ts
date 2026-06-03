// Partner self-service portal API tests (issue #129).
//
// Covers:
//   - Auth guard on all partner portal endpoints
//   - Org creation and reverse lookup (GET /partner/orgs/mine)
//   - Draft creation, update, list, and view
//   - Submit-for-review flow
//   - Price-field guard on submission body
//   - Membership enforcement (403 for non-members)

import { test, before, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

const JWT_SECRET = "partner-portal-test-secret";
const ADMIN_SECRET = "portal-admin-secret";

before(() => {
  process.env.TRUERATE_INMEMORY = "true";
  process.env.TRUERATE_JWT_SECRET = JWT_SECRET;
  process.env.TRUERATE_CRED_KEY = randomBytes(32).toString("base64");
  process.env.ADMIN_SECRET = ADMIN_SECRET;
});

async function getApp() {
  const { app } = await import("../src/app.js");
  return app;
}

async function issueToken(userId: string, email: string): Promise<string> {
  const { issueToken } = await import("../src/auth.js");
  return issueToken(userId, email);
}

beforeEach(async () => {
  const { resetAppPartner, resetAppCatalog } = await import("../src/app.js");
  const { resetPartnerWorkflow } = await import("@truerate/core");
  resetAppPartner();
  resetAppCatalog();
  resetPartnerWorkflow();
});

const JSON_CT = { "Content-Type": "application/json" };
const adminHeader = { "x-admin-secret": ADMIN_SECRET };

async function authHeader(userId = "user-alice", email = "alice@example.com") {
  const token = await issueToken(userId, email);
  return { Authorization: `Bearer ${token}` };
}

const sampleDraft = {
  name: "Test Loyalty Program",
  category: "hotel",
  region: "CZ",
  sourceUrl: "https://example.com/loyalty",
  tiers: ["Silver", "Gold"],
  fields: [{ key: "memberNumber", label: "Member Number", type: "text" }],
  benefits: {
    Silver: [{ scope: "brand", match: { brands: ["Test Hotel"] }, value: { kind: "percentDiscount", percentOff: 0.1 } }],
    Gold: [{ scope: "brand", match: { brands: ["Test Hotel"] }, value: { kind: "percentDiscount", percentOff: 0.15 } }],
  },
};

const sampleOrg = {
  name: "Test Hotel Group",
  country: "CZ",
  contactEmail: "partner@testhotel.cz",
};

// ─── Auth guards ─────────────────────────────────────────────────────────────

describe("partner portal auth guards", () => {
  test("POST /partner/orgs — 401 without token", async () => {
    const app = await getApp();
    const res = await app.request("/partner/orgs", {
      method: "POST",
      headers: JSON_CT,
      body: JSON.stringify(sampleOrg),
    });
    assert.equal(res.status, 401);
  });

  test("GET /partner/orgs/mine — 401 without token", async () => {
    const app = await getApp();
    const res = await app.request("/partner/orgs/mine");
    assert.equal(res.status, 401);
  });

  test("GET /partner/submissions — 401 without token", async () => {
    const app = await getApp();
    const res = await app.request("/partner/submissions");
    assert.equal(res.status, 401);
  });

  test("POST /partner/submissions — 401 without token", async () => {
    const app = await getApp();
    const res = await app.request("/partner/submissions", {
      method: "POST",
      headers: JSON_CT,
      body: JSON.stringify({ ...sampleDraft, orgId: "org-1" }),
    });
    assert.equal(res.status, 401);
  });

  test("PUT /partner/submissions/:id — 401 without token", async () => {
    const app = await getApp();
    const res = await app.request("/partner/submissions/sub-1", {
      method: "PUT",
      headers: JSON_CT,
      body: JSON.stringify(sampleDraft),
    });
    assert.equal(res.status, 401);
  });

  test("POST /partner/submissions/:id/submit — 401 without token", async () => {
    const app = await getApp();
    const res = await app.request("/partner/submissions/sub-1/submit", {
      method: "POST",
      headers: JSON_CT,
    });
    assert.equal(res.status, 401);
  });
});

// ─── Org creation ────────────────────────────────────────────────────────────

describe("partner org creation", () => {
  test("POST /partner/orgs — creates org in pending status, user becomes owner", async () => {
    const app = await getApp();
    const auth = await authHeader("user-alice");
    const res = await app.request("/partner/orgs", {
      method: "POST",
      headers: { ...auth, ...JSON_CT },
      body: JSON.stringify(sampleOrg),
    });
    assert.equal(res.status, 201);
    const { org } = await res.json();
    assert.equal(org.name, sampleOrg.name);
    assert.equal(org.country, sampleOrg.country);
    assert.equal(org.status, "pending");
    assert.ok(org.id, "id is set");
    assert.ok(org.createdAt, "createdAt is set");
  });

  test("POST /partner/orgs — 400 on missing required fields", async () => {
    const app = await getApp();
    const auth = await authHeader();
    const res = await app.request("/partner/orgs", {
      method: "POST",
      headers: { ...auth, ...JSON_CT },
      body: JSON.stringify({ name: "Incomplete" }),
    });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, "validation_failed");
  });

  test("POST /partner/orgs — 400 on invalid email", async () => {
    const app = await getApp();
    const auth = await authHeader();
    const res = await app.request("/partner/orgs", {
      method: "POST",
      headers: { ...auth, ...JSON_CT },
      body: JSON.stringify({ ...sampleOrg, contactEmail: "not-an-email" }),
    });
    assert.equal(res.status, 400);
  });

  test("POST /partner/orgs — 400 on invalid country code", async () => {
    const app = await getApp();
    const auth = await authHeader();
    const res = await app.request("/partner/orgs", {
      method: "POST",
      headers: { ...auth, ...JSON_CT },
      body: JSON.stringify({ ...sampleOrg, country: "CZE" }),
    });
    assert.equal(res.status, 400);
  });
});

// ─── Reverse org lookup ───────────────────────────────────────────────────────

describe("GET /partner/orgs/mine", () => {
  test("returns empty list before creating any org", async () => {
    const app = await getApp();
    const auth = await authHeader("user-new");
    const res = await app.request("/partner/orgs/mine", { headers: auth });
    assert.equal(res.status, 200);
    const { orgs, memberships } = await res.json();
    assert.deepEqual(orgs, []);
    assert.deepEqual(memberships, []);
  });

  test("returns org after creating one", async () => {
    const app = await getApp();
    const auth = await authHeader("user-bob");
    await app.request("/partner/orgs", {
      method: "POST",
      headers: { ...auth, ...JSON_CT },
      body: JSON.stringify(sampleOrg),
    });
    const res = await app.request("/partner/orgs/mine", { headers: auth });
    assert.equal(res.status, 200);
    const { orgs, memberships } = await res.json();
    assert.equal(orgs.length, 1);
    assert.equal(orgs[0].name, sampleOrg.name);
    assert.equal(memberships[0].role, "owner");
  });

  test("different users see only their own orgs", async () => {
    const app = await getApp();
    const authAlice = await authHeader("user-alice-isolated", "alice@isolated.com");
    const authBob = await authHeader("user-bob-isolated", "bob@isolated.com");

    await app.request("/partner/orgs", {
      method: "POST",
      headers: { ...authAlice, ...JSON_CT },
      body: JSON.stringify({ ...sampleOrg, name: "Alice Hotel", contactEmail: "alice@isolated.com" }),
    });

    const resBob = await app.request("/partner/orgs/mine", { headers: authBob });
    const { orgs } = await resBob.json();
    assert.equal(orgs.length, 0, "Bob should not see Alice's org");
  });
});

// ─── Submission CRUD ─────────────────────────────────────────────────────────

async function createOrgAndApprove(app: { request: Function }, userId: string, email: string) {
  const auth = { Authorization: `Bearer ${await issueToken(userId, email)}` };
  const orgRes = await app.request("/partner/orgs", {
    method: "POST",
    headers: { ...auth, ...JSON_CT },
    body: JSON.stringify(sampleOrg),
  });
  const { org } = await orgRes.json();
  // Admin approves the org so user can submit
  await app.request(`/admin/partners/${org.id}/approve`, {
    method: "POST",
    headers: { ...adminHeader, ...JSON_CT },
    body: JSON.stringify({ adminId: "admin-1" }),
  });
  return { auth, orgId: org.id };
}

describe("submission creation", () => {
  test("POST /partner/submissions — creates draft for active org", async () => {
    const app = await getApp();
    const { auth, orgId } = await createOrgAndApprove(app, "user-create", "create@example.com");
    const res = await app.request("/partner/submissions", {
      method: "POST",
      headers: { ...auth, ...JSON_CT },
      body: JSON.stringify({ ...sampleDraft, orgId }),
    });
    assert.equal(res.status, 201);
    const { submission } = await res.json();
    assert.equal(submission.status, "draft");
    assert.equal(submission.programDraft.name, sampleDraft.name);
    assert.equal(submission.orgId, orgId);
    assert.equal(submission.source, "partner");
  });

  test("POST /partner/submissions — also works for pending org (saves as draft)", async () => {
    const app = await getApp();
    const auth = await authHeader("user-pending-draft");
    const orgRes = await app.request("/partner/orgs", {
      method: "POST",
      headers: { ...auth, ...JSON_CT },
      body: JSON.stringify(sampleOrg),
    });
    const { org } = await orgRes.json();
    assert.equal(org.status, "pending");

    const res = await app.request("/partner/submissions", {
      method: "POST",
      headers: { ...auth, ...JSON_CT },
      body: JSON.stringify({ ...sampleDraft, orgId: org.id }),
    });
    assert.equal(res.status, 201);
    const { submission } = await res.json();
    assert.equal(submission.status, "draft");
  });

  test("POST /partner/submissions — 403 when not a member of the org", async () => {
    const app = await getApp();
    const { orgId } = await createOrgAndApprove(app, "user-owner-403", "owner@example.com");
    const authOther = await authHeader("user-other-403", "other@example.com");
    const res = await app.request("/partner/submissions", {
      method: "POST",
      headers: { ...authOther, ...JSON_CT },
      body: JSON.stringify({ ...sampleDraft, orgId }),
    });
    assert.equal(res.status, 403);
  });

  test("POST /partner/submissions — 400 on missing name", async () => {
    const app = await getApp();
    const { auth, orgId } = await createOrgAndApprove(app, "user-missing-name", "missing@example.com");
    const res = await app.request("/partner/submissions", {
      method: "POST",
      headers: { ...auth, ...JSON_CT },
      body: JSON.stringify({ ...sampleDraft, name: "", orgId }),
    });
    assert.equal(res.status, 400);
  });

  test("POST /partner/submissions — rejects price fields (product rule #1)", async () => {
    const app = await getApp();
    const { auth, orgId } = await createOrgAndApprove(app, "user-price-reject", "price@example.com");
    const res = await app.request("/partner/submissions", {
      method: "POST",
      headers: { ...auth, ...JSON_CT },
      body: JSON.stringify({
        ...sampleDraft,
        orgId,
        price: 99,
      }),
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.ok(body.error === "validation_failed");
  });

  test("POST /partner/submissions — rejects nightly rate (product rule #1)", async () => {
    const app = await getApp();
    const { auth, orgId } = await createOrgAndApprove(app, "user-nightly-reject", "nightly@example.com");
    const draftWithPrice = {
      ...sampleDraft,
      orgId,
      benefits: {
        Silver: [{ scope: "brand", value: { kind: "percentDiscount", nightly: 150 } }],
      },
    };
    const res = await app.request("/partner/submissions", {
      method: "POST",
      headers: { ...auth, ...JSON_CT },
      body: JSON.stringify(draftWithPrice),
    });
    assert.equal(res.status, 400);
  });
});

describe("submission list and view", () => {
  test("GET /partner/submissions — lists submissions for user's orgs", async () => {
    const app = await getApp();
    const { auth, orgId } = await createOrgAndApprove(app, "user-list", "list@example.com");
    await app.request("/partner/submissions", {
      method: "POST",
      headers: { ...auth, ...JSON_CT },
      body: JSON.stringify({ ...sampleDraft, orgId }),
    });
    const res = await app.request("/partner/submissions", { headers: auth });
    assert.equal(res.status, 200);
    const { submissions, count } = await res.json();
    assert.equal(count, 1);
    assert.equal(submissions[0].programDraft.name, sampleDraft.name);
  });

  test("GET /partner/submissions — returns empty list for new user", async () => {
    const app = await getApp();
    const auth = await authHeader("user-empty-list", "empty@example.com");
    const res = await app.request("/partner/submissions", { headers: auth });
    assert.equal(res.status, 200);
    const { submissions, count } = await res.json();
    assert.equal(count, 0);
    assert.deepEqual(submissions, []);
  });

  test("GET /partner/submissions/:id — returns submission to member", async () => {
    const app = await getApp();
    const { auth, orgId } = await createOrgAndApprove(app, "user-view", "view@example.com");
    const createRes = await app.request("/partner/submissions", {
      method: "POST",
      headers: { ...auth, ...JSON_CT },
      body: JSON.stringify({ ...sampleDraft, orgId }),
    });
    const { submission: created } = await createRes.json();
    const res = await app.request(`/partner/submissions/${created.id}`, { headers: auth });
    assert.equal(res.status, 200);
    const { submission } = await res.json();
    assert.equal(submission.id, created.id);
  });

  test("GET /partner/submissions/:id — 403 for non-member", async () => {
    const app = await getApp();
    const { orgId } = await createOrgAndApprove(app, "user-view-owner", "viewowner@example.com");
    const ownerAuth = { Authorization: `Bearer ${await issueToken("user-view-owner", "viewowner@example.com")}` };
    const createRes = await app.request("/partner/submissions", {
      method: "POST",
      headers: { ...ownerAuth, ...JSON_CT },
      body: JSON.stringify({ ...sampleDraft, orgId }),
    });
    const { submission: created } = await createRes.json();

    const otherAuth = await authHeader("user-view-other", "viewother@example.com");
    const res = await app.request(`/partner/submissions/${created.id}`, { headers: otherAuth });
    assert.equal(res.status, 403);
  });

  test("GET /partner/submissions/:id — 404 for unknown id", async () => {
    const app = await getApp();
    const auth = await authHeader("user-404-view");
    const res = await app.request("/partner/submissions/does-not-exist", { headers: auth });
    assert.equal(res.status, 404);
  });
});

describe("submission update", () => {
  test("PUT /partner/submissions/:id — updates a draft", async () => {
    const app = await getApp();
    const { auth, orgId } = await createOrgAndApprove(app, "user-update", "update@example.com");
    const createRes = await app.request("/partner/submissions", {
      method: "POST",
      headers: { ...auth, ...JSON_CT },
      body: JSON.stringify({ ...sampleDraft, orgId }),
    });
    const { submission: created } = await createRes.json();

    const updated = { ...sampleDraft, name: "Updated Program Name" };
    const res = await app.request(`/partner/submissions/${created.id}`, {
      method: "PUT",
      headers: { ...auth, ...JSON_CT },
      body: JSON.stringify(updated),
    });
    assert.equal(res.status, 200);
    const { submission } = await res.json();
    assert.equal(submission.programDraft.name, "Updated Program Name");
    assert.equal(submission.status, "draft");
  });

  test("PUT /partner/submissions/:id — 400 when not in draft status", async () => {
    const app = await getApp();
    const { auth, orgId } = await createOrgAndApprove(app, "user-update-submitted", "updsub@example.com");
    const createRes = await app.request("/partner/submissions", {
      method: "POST",
      headers: { ...auth, ...JSON_CT },
      body: JSON.stringify({ ...sampleDraft, orgId }),
    });
    const { submission: created } = await createRes.json();

    // Submit for review
    await app.request(`/partner/submissions/${created.id}/submit`, {
      method: "POST",
      headers: auth,
    });

    const res = await app.request(`/partner/submissions/${created.id}`, {
      method: "PUT",
      headers: { ...auth, ...JSON_CT },
      body: JSON.stringify(sampleDraft),
    });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, "invalid_transition");
  });

  test("PUT /partner/submissions/:id — 403 for non-member", async () => {
    const app = await getApp();
    const { orgId } = await createOrgAndApprove(app, "user-update-owner2", "updown2@example.com");
    const ownerAuth = { Authorization: `Bearer ${await issueToken("user-update-owner2", "updown2@example.com")}` };
    const createRes = await app.request("/partner/submissions", {
      method: "POST",
      headers: { ...ownerAuth, ...JSON_CT },
      body: JSON.stringify({ ...sampleDraft, orgId }),
    });
    const { submission: created } = await createRes.json();

    const otherAuth = await authHeader("user-update-other2", "updother2@example.com");
    const res = await app.request(`/partner/submissions/${created.id}`, {
      method: "PUT",
      headers: { ...otherAuth, ...JSON_CT },
      body: JSON.stringify(sampleDraft),
    });
    assert.equal(res.status, 403);
  });

  test("PUT /partner/submissions/:id — rejects price fields", async () => {
    const app = await getApp();
    const { auth, orgId } = await createOrgAndApprove(app, "user-update-price", "updprice@example.com");
    const createRes = await app.request("/partner/submissions", {
      method: "POST",
      headers: { ...auth, ...JSON_CT },
      body: JSON.stringify({ ...sampleDraft, orgId }),
    });
    const { submission: created } = await createRes.json();

    const res = await app.request(`/partner/submissions/${created.id}`, {
      method: "PUT",
      headers: { ...auth, ...JSON_CT },
      body: JSON.stringify({ ...sampleDraft, totalPrice: 200 }),
    });
    assert.equal(res.status, 400);
  });
});

describe("submit for review", () => {
  test("POST /partner/submissions/:id/submit — moves draft to submitted", async () => {
    const app = await getApp();
    const { auth, orgId } = await createOrgAndApprove(app, "user-submit-flow", "subflow@example.com");
    const createRes = await app.request("/partner/submissions", {
      method: "POST",
      headers: { ...auth, ...JSON_CT },
      body: JSON.stringify({ ...sampleDraft, orgId }),
    });
    const { submission: created } = await createRes.json();
    assert.equal(created.status, "draft");

    const res = await app.request(`/partner/submissions/${created.id}/submit`, {
      method: "POST",
      headers: auth,
    });
    assert.equal(res.status, 200);
    const { submission } = await res.json();
    assert.equal(submission.status, "submitted");
  });

  test("POST /partner/submissions/:id/submit — 400 when already submitted", async () => {
    const app = await getApp();
    const { auth, orgId } = await createOrgAndApprove(app, "user-double-submit", "doublesub@example.com");
    const createRes = await app.request("/partner/submissions", {
      method: "POST",
      headers: { ...auth, ...JSON_CT },
      body: JSON.stringify({ ...sampleDraft, orgId }),
    });
    const { submission: created } = await createRes.json();
    await app.request(`/partner/submissions/${created.id}/submit`, { method: "POST", headers: auth });
    const res = await app.request(`/partner/submissions/${created.id}/submit`, { method: "POST", headers: auth });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, "invalid_transition");
  });

  test("POST /partner/submissions/:id/submit — 403 for non-member", async () => {
    const app = await getApp();
    const { orgId } = await createOrgAndApprove(app, "user-submit-owner", "submitowner@example.com");
    const ownerAuth = { Authorization: `Bearer ${await issueToken("user-submit-owner", "submitowner@example.com")}` };
    const createRes = await app.request("/partner/submissions", {
      method: "POST",
      headers: { ...ownerAuth, ...JSON_CT },
      body: JSON.stringify({ ...sampleDraft, orgId }),
    });
    const { submission: created } = await createRes.json();

    const otherAuth = await authHeader("user-submit-other", "submitother@example.com");
    const res = await app.request(`/partner/submissions/${created.id}/submit`, { method: "POST", headers: otherAuth });
    assert.equal(res.status, 403);
  });

  test("POST /partner/submissions/:id/submit — 404 for unknown submission", async () => {
    const app = await getApp();
    const auth = await authHeader("user-submit-404");
    const res = await app.request("/partner/submissions/does-not-exist/submit", { method: "POST", headers: auth });
    assert.equal(res.status, 404);
  });

  test("submitted submission response contains no price fields", async () => {
    const app = await getApp();
    const { auth, orgId } = await createOrgAndApprove(app, "user-noprice-submit", "noprice@example.com");
    const createRes = await app.request("/partner/submissions", {
      method: "POST",
      headers: { ...auth, ...JSON_CT },
      body: JSON.stringify({ ...sampleDraft, orgId }),
    });
    const { submission: created } = await createRes.json();
    const res = await app.request(`/partner/submissions/${created.id}/submit`, { method: "POST", headers: auth });
    const raw = JSON.stringify(await res.json());
    assert.ok(!raw.includes("memberPrice"), "no memberPrice");
    assert.ok(!raw.includes("finalPrice"), "no finalPrice");
    assert.ok(!raw.includes("nightlyAmount"), "no nightlyAmount");
    assert.ok(!raw.includes("totalAmount"), "no totalAmount");
  });
});
