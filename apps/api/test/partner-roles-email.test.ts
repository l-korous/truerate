// Partner roles/permissions + email notifications tests (issue #138).
//
// Covers:
//   - Owner-only member management (add, remove, update role)
//   - Editor cannot manage members (403)
//   - Notification emails sent on lifecycle events (submitted/approved/rejected)
//   - Notification content contains no price/amount fields

import { test, before, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

const JWT_SECRET = "partner-138-test-secret";
const ADMIN_SECRET = "partner-138-admin-secret";

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
  tiers: ["Silver"],
  fields: [],
  benefits: {
    Silver: [{ scope: "brand", match: { brands: ["Test Hotel"] }, value: { kind: "percentDiscount", percentOff: 0.1 } }],
  },
};

const sampleOrg = {
  name: "Test Hotel Group",
  country: "CZ",
  contactEmail: "partner@testhotel.cz",
};

// ---------------------------------------------------------------------------
// Helper: create org + approve it + return owner auth
// ---------------------------------------------------------------------------

async function createOrgAndApprove(app: { request: Function }, userId: string, email: string) {
  const auth = { Authorization: `Bearer ${await issueToken(userId, email)}` };
  const orgRes = await app.request("/partner/orgs", {
    method: "POST",
    headers: { ...auth, ...JSON_CT },
    body: JSON.stringify(sampleOrg),
  });
  const { org } = await orgRes.json();
  await app.request(`/admin/partners/${org.id}/approve`, {
    method: "POST",
    headers: { ...adminHeader, ...JSON_CT },
    body: JSON.stringify({ adminId: "admin-1" }),
  });
  return { auth, orgId: org.id };
}

// ---------------------------------------------------------------------------
// Member management endpoint auth guards
// ---------------------------------------------------------------------------

describe("partner member management: auth guards", () => {
  test("GET /partner/orgs/:id/members — 401 without token", async () => {
    const app = await getApp();
    const res = await app.request("/partner/orgs/org-fake/members");
    assert.equal(res.status, 401);
  });

  test("POST /partner/orgs/:id/members — 401 without token", async () => {
    const app = await getApp();
    const res = await app.request("/partner/orgs/org-fake/members", {
      method: "POST",
      headers: JSON_CT,
      body: JSON.stringify({ userId: "user-bob", role: "editor" }),
    });
    assert.equal(res.status, 401);
  });

  test("PATCH /partner/orgs/:id/members/:memberId — 401 without token", async () => {
    const app = await getApp();
    const res = await app.request("/partner/orgs/org-fake/members/user-bob", {
      method: "PATCH",
      headers: JSON_CT,
      body: JSON.stringify({ role: "owner" }),
    });
    assert.equal(res.status, 401);
  });

  test("DELETE /partner/orgs/:id/members/:memberId — 401 without token", async () => {
    const app = await getApp();
    const res = await app.request("/partner/orgs/org-fake/members/user-bob", { method: "DELETE" });
    assert.equal(res.status, 401);
  });
});

// ---------------------------------------------------------------------------
// GET /partner/orgs/:id/members
// ---------------------------------------------------------------------------

describe("GET /partner/orgs/:id/members", () => {
  test("returns members for org owner", async () => {
    const app = await getApp();
    const { auth, orgId } = await createOrgAndApprove(app, "user-list-owner", "list-owner@example.com");
    const res = await app.request(`/partner/orgs/${orgId}/members`, { headers: auth });
    assert.equal(res.status, 200);
    const { members, count } = await res.json();
    assert.equal(count, 1);
    assert.equal(members[0].role, "owner");
    assert.equal(members[0].userId, "user-list-owner");
  });

  test("403 for non-member", async () => {
    const app = await getApp();
    const { orgId } = await createOrgAndApprove(app, "user-list-owner2", "list-owner2@example.com");
    const otherAuth = await authHeader("user-stranger", "stranger@example.com");
    const res = await app.request(`/partner/orgs/${orgId}/members`, { headers: otherAuth });
    assert.equal(res.status, 403);
  });

  test("editor can also list members", async () => {
    const app = await getApp();
    const { auth: ownerAuth, orgId } = await createOrgAndApprove(app, "user-list-owner3", "list-owner3@example.com");
    // Owner adds Bob as editor
    await app.request(`/partner/orgs/${orgId}/members`, {
      method: "POST",
      headers: { ...ownerAuth, ...JSON_CT },
      body: JSON.stringify({ userId: "user-editor-list", role: "editor" }),
    });
    const editorAuth = await authHeader("user-editor-list", "editor-list@example.com");
    const res = await app.request(`/partner/orgs/${orgId}/members`, { headers: editorAuth });
    assert.equal(res.status, 200);
    const { members } = await res.json();
    assert.ok(members.some((m: { userId: string }) => m.userId === "user-list-owner3"));
    assert.ok(members.some((m: { userId: string }) => m.userId === "user-editor-list"));
  });
});

// ---------------------------------------------------------------------------
// POST /partner/orgs/:id/members — add a member (owner only)
// ---------------------------------------------------------------------------

describe("POST /partner/orgs/:id/members", () => {
  test("owner can add an editor", async () => {
    const app = await getApp();
    const { auth, orgId } = await createOrgAndApprove(app, "user-add-owner", "add-owner@example.com");
    const res = await app.request(`/partner/orgs/${orgId}/members`, {
      method: "POST",
      headers: { ...auth, ...JSON_CT },
      body: JSON.stringify({ userId: "user-new-editor", role: "editor" }),
    });
    assert.equal(res.status, 201);
    const { member } = await res.json();
    assert.equal(member.userId, "user-new-editor");
    assert.equal(member.role, "editor");
    assert.equal(member.orgId, orgId);
  });

  test("owner can add another owner", async () => {
    const app = await getApp();
    const { auth, orgId } = await createOrgAndApprove(app, "user-add-owner2", "add-owner2@example.com");
    const res = await app.request(`/partner/orgs/${orgId}/members`, {
      method: "POST",
      headers: { ...auth, ...JSON_CT },
      body: JSON.stringify({ userId: "user-co-owner", role: "owner" }),
    });
    assert.equal(res.status, 201);
    const { member } = await res.json();
    assert.equal(member.role, "owner");
  });

  test("editor cannot add a member (403)", async () => {
    const app = await getApp();
    const { auth: ownerAuth, orgId } = await createOrgAndApprove(app, "user-perm-owner", "perm-owner@example.com");
    // Owner adds Bob as editor
    await app.request(`/partner/orgs/${orgId}/members`, {
      method: "POST",
      headers: { ...ownerAuth, ...JSON_CT },
      body: JSON.stringify({ userId: "user-editor-perm", role: "editor" }),
    });
    const editorAuth = await authHeader("user-editor-perm", "editor-perm@example.com");
    const res = await app.request(`/partner/orgs/${orgId}/members`, {
      method: "POST",
      headers: { ...editorAuth, ...JSON_CT },
      body: JSON.stringify({ userId: "user-new-via-editor", role: "editor" }),
    });
    assert.equal(res.status, 403);
  });

  test("non-member cannot add a member (403)", async () => {
    const app = await getApp();
    const { orgId } = await createOrgAndApprove(app, "user-add-owner3", "add-owner3@example.com");
    const strangerAuth = await authHeader("user-stranger-add", "stranger-add@example.com");
    const res = await app.request(`/partner/orgs/${orgId}/members`, {
      method: "POST",
      headers: { ...strangerAuth, ...JSON_CT },
      body: JSON.stringify({ userId: "user-injected", role: "editor" }),
    });
    assert.equal(res.status, 403);
  });

  test("400 on missing userId", async () => {
    const app = await getApp();
    const { auth, orgId } = await createOrgAndApprove(app, "user-add-owner4", "add-owner4@example.com");
    const res = await app.request(`/partner/orgs/${orgId}/members`, {
      method: "POST",
      headers: { ...auth, ...JSON_CT },
      body: JSON.stringify({ role: "editor" }),
    });
    assert.equal(res.status, 400);
  });

  test("400 on invalid role", async () => {
    const app = await getApp();
    const { auth, orgId } = await createOrgAndApprove(app, "user-add-owner5", "add-owner5@example.com");
    const res = await app.request(`/partner/orgs/${orgId}/members`, {
      method: "POST",
      headers: { ...auth, ...JSON_CT },
      body: JSON.stringify({ userId: "user-bad-role", role: "superadmin" }),
    });
    assert.equal(res.status, 400);
  });

  test("400 when adding a user already in the org", async () => {
    const app = await getApp();
    const { auth, orgId } = await createOrgAndApprove(app, "user-dup-owner", "dup-owner@example.com");
    // Try to add the owner again
    const res = await app.request(`/partner/orgs/${orgId}/members`, {
      method: "POST",
      headers: { ...auth, ...JSON_CT },
      body: JSON.stringify({ userId: "user-dup-owner", role: "editor" }),
    });
    assert.equal(res.status, 400);
  });

  test("added member appears in GET /partner/orgs/:id/members", async () => {
    const app = await getApp();
    const { auth, orgId } = await createOrgAndApprove(app, "user-verify-add", "verify-add@example.com");
    await app.request(`/partner/orgs/${orgId}/members`, {
      method: "POST",
      headers: { ...auth, ...JSON_CT },
      body: JSON.stringify({ userId: "user-verify-added", role: "editor" }),
    });
    const listRes = await app.request(`/partner/orgs/${orgId}/members`, { headers: auth });
    const { members } = await listRes.json();
    assert.ok(members.some((m: { userId: string }) => m.userId === "user-verify-added"));
  });
});

// ---------------------------------------------------------------------------
// PATCH /partner/orgs/:id/members/:memberId — update role (owner only)
// ---------------------------------------------------------------------------

describe("PATCH /partner/orgs/:id/members/:memberId", () => {
  test("owner can promote editor to owner", async () => {
    const app = await getApp();
    const { auth: ownerAuth, orgId } = await createOrgAndApprove(app, "user-promote-owner", "promote-owner@example.com");
    await app.request(`/partner/orgs/${orgId}/members`, {
      method: "POST",
      headers: { ...ownerAuth, ...JSON_CT },
      body: JSON.stringify({ userId: "user-to-promote", role: "editor" }),
    });
    const res = await app.request(`/partner/orgs/${orgId}/members/user-to-promote`, {
      method: "PATCH",
      headers: { ...ownerAuth, ...JSON_CT },
      body: JSON.stringify({ role: "owner" }),
    });
    assert.equal(res.status, 200);
    const { member } = await res.json();
    assert.equal(member.role, "owner");
  });

  test("owner can demote co-owner to editor if another owner exists", async () => {
    const app = await getApp();
    const { auth: ownerAuth, orgId } = await createOrgAndApprove(app, "user-demote-owner", "demote-owner@example.com");
    await app.request(`/partner/orgs/${orgId}/members`, {
      method: "POST",
      headers: { ...ownerAuth, ...JSON_CT },
      body: JSON.stringify({ userId: "user-co-owner-demote", role: "owner" }),
    });
    const res = await app.request(`/partner/orgs/${orgId}/members/user-co-owner-demote`, {
      method: "PATCH",
      headers: { ...ownerAuth, ...JSON_CT },
      body: JSON.stringify({ role: "editor" }),
    });
    assert.equal(res.status, 200);
    const { member } = await res.json();
    assert.equal(member.role, "editor");
  });

  test("cannot demote the last owner", async () => {
    const app = await getApp();
    const { auth, orgId } = await createOrgAndApprove(app, "user-last-owner", "last-owner@example.com");
    const res = await app.request(`/partner/orgs/${orgId}/members/user-last-owner`, {
      method: "PATCH",
      headers: { ...auth, ...JSON_CT },
      body: JSON.stringify({ role: "editor" }),
    });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, "invalid_transition");
  });

  test("editor cannot update roles (403)", async () => {
    const app = await getApp();
    const { auth: ownerAuth, orgId } = await createOrgAndApprove(app, "user-patch-owner", "patch-owner@example.com");
    await app.request(`/partner/orgs/${orgId}/members`, {
      method: "POST",
      headers: { ...ownerAuth, ...JSON_CT },
      body: JSON.stringify({ userId: "user-patch-editor", role: "editor" }),
    });
    const editorAuth = await authHeader("user-patch-editor", "patch-editor@example.com");
    const res = await app.request(`/partner/orgs/${orgId}/members/user-patch-owner`, {
      method: "PATCH",
      headers: { ...editorAuth, ...JSON_CT },
      body: JSON.stringify({ role: "editor" }),
    });
    assert.equal(res.status, 403);
  });

  test("400 on invalid role value", async () => {
    const app = await getApp();
    const { auth, orgId } = await createOrgAndApprove(app, "user-patch-owner2", "patch-owner2@example.com");
    const res = await app.request(`/partner/orgs/${orgId}/members/user-patch-owner2`, {
      method: "PATCH",
      headers: { ...auth, ...JSON_CT },
      body: JSON.stringify({ role: "superadmin" }),
    });
    assert.equal(res.status, 400);
  });
});

// ---------------------------------------------------------------------------
// DELETE /partner/orgs/:id/members/:memberId — remove member (owner only)
// ---------------------------------------------------------------------------

describe("DELETE /partner/orgs/:id/members/:memberId", () => {
  test("owner can remove an editor", async () => {
    const app = await getApp();
    const { auth: ownerAuth, orgId } = await createOrgAndApprove(app, "user-del-owner", "del-owner@example.com");
    await app.request(`/partner/orgs/${orgId}/members`, {
      method: "POST",
      headers: { ...ownerAuth, ...JSON_CT },
      body: JSON.stringify({ userId: "user-to-remove", role: "editor" }),
    });
    const res = await app.request(`/partner/orgs/${orgId}/members/user-to-remove`, {
      method: "DELETE",
      headers: ownerAuth,
    });
    assert.equal(res.status, 204);

    const listRes = await app.request(`/partner/orgs/${orgId}/members`, { headers: ownerAuth });
    const { members } = await listRes.json();
    assert.ok(!members.some((m: { userId: string }) => m.userId === "user-to-remove"));
  });

  test("editor cannot remove a member (403)", async () => {
    const app = await getApp();
    const { auth: ownerAuth, orgId } = await createOrgAndApprove(app, "user-del-owner2", "del-owner2@example.com");
    await app.request(`/partner/orgs/${orgId}/members`, {
      method: "POST",
      headers: { ...ownerAuth, ...JSON_CT },
      body: JSON.stringify({ userId: "user-editor-del", role: "editor" }),
    });
    const editorAuth = await authHeader("user-editor-del", "editor-del@example.com");
    const res = await app.request(`/partner/orgs/${orgId}/members/user-del-owner2`, {
      method: "DELETE",
      headers: editorAuth,
    });
    assert.equal(res.status, 403);
  });

  test("cannot remove the last owner", async () => {
    const app = await getApp();
    const { auth, orgId } = await createOrgAndApprove(app, "user-del-last-owner", "del-last-owner@example.com");
    const res = await app.request(`/partner/orgs/${orgId}/members/user-del-last-owner`, {
      method: "DELETE",
      headers: auth,
    });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, "invalid_transition");
  });

  test("403 when non-member tries to remove a member", async () => {
    const app = await getApp();
    const { auth: ownerAuth, orgId } = await createOrgAndApprove(app, "user-del-owner3", "del-owner3@example.com");
    await app.request(`/partner/orgs/${orgId}/members`, {
      method: "POST",
      headers: { ...ownerAuth, ...JSON_CT },
      body: JSON.stringify({ userId: "user-victim", role: "editor" }),
    });
    const strangerAuth = await authHeader("user-stranger-del", "stranger-del@example.com");
    const res = await app.request(`/partner/orgs/${orgId}/members/user-victim`, {
      method: "DELETE",
      headers: strangerAuth,
    });
    assert.equal(res.status, 403);
  });
});

// ---------------------------------------------------------------------------
// Email notifications via MemoryEmailSender
// ---------------------------------------------------------------------------

describe("partner email notifications", () => {
  test("submission_received email is sent when a draft is submitted", async () => {
    const { MemoryEmailSender, PartnerWorkflow, MemoryPartnerOrgRepo, MemoryPartnerSubmissionRepo, MemoryPartnerNotificationRepo } =
      await import("@truerate/core");

    const orgs = new MemoryPartnerOrgRepo();
    const submissions = new MemoryPartnerSubmissionRepo();
    const notifications = new MemoryPartnerNotificationRepo();
    const emailSender = new MemoryEmailSender();
    await orgs.init();
    await submissions.init();

    const workflow = new PartnerWorkflow(orgs, submissions, notifications, emailSender);

    const org = {
      id: "org-email-test",
      name: "Email Test Hotel",
      country: "CZ",
      contactEmail: "partner@emailtest.cz",
      status: "active" as const,
      createdAt: new Date().toISOString(),
    };
    await orgs.createOrg(org);
    await workflow.associateUser("user-email-owner", org.id, "owner");

    const draft = {
      name: "Email Notification Test Program",
      category: "hotel" as const,
      region: "CZ",
      fields: [],
      benefits: {},
    };

    await workflow.createDraft("user-email-owner", org.id, draft, "sub-email-1");
    await workflow.submitForReview("user-email-owner", "sub-email-1");

    assert.equal(emailSender.sent.length, 1);
    const email = emailSender.sent[0];
    assert.equal(email.to, org.contactEmail);
    assert.ok(email.subject.toLowerCase().includes("received") || email.subject.toLowerCase().includes("submission"),
      "Subject should mention submission received");
    assert.ok(email.text.includes(draft.name), "Email body should include program name");
  });

  test("submission_approved email is sent on admin approval", async () => {
    const { MemoryEmailSender, PartnerWorkflow, MemoryPartnerOrgRepo, MemoryPartnerSubmissionRepo, MemoryPartnerNotificationRepo } =
      await import("@truerate/core");

    const orgs = new MemoryPartnerOrgRepo();
    const submissions = new MemoryPartnerSubmissionRepo();
    const notifications = new MemoryPartnerNotificationRepo();
    const emailSender = new MemoryEmailSender();
    await orgs.init();
    await submissions.init();

    const workflow = new PartnerWorkflow(orgs, submissions, notifications, emailSender);
    const org = {
      id: "org-email-approve",
      name: "Approve Hotel",
      country: "CZ",
      contactEmail: "approve@hotel.cz",
      status: "active" as const,
      createdAt: new Date().toISOString(),
    };
    await orgs.createOrg(org);
    await workflow.associateUser("user-approve-email", org.id, "owner");

    const draft = { name: "Approve Email Program", category: "hotel" as const, region: "CZ", fields: [], benefits: {} };
    await workflow.createDraft("user-approve-email", org.id, draft, "sub-approve-email");
    await workflow.submitForReview("user-approve-email", "sub-approve-email");
    emailSender.clear();

    await workflow.approve("sub-approve-email", "prog-published-email");
    assert.equal(emailSender.sent.length, 1);
    const email = emailSender.sent[0];
    assert.equal(email.to, org.contactEmail);
    assert.ok(email.subject.toLowerCase().includes("approved") || email.subject.toLowerCase().includes("submission"),
      "Subject should mention approval");
    assert.ok(email.text.includes(draft.name), "Email body should include program name");
  });

  test("submission_rejected email is sent on admin rejection (with reason)", async () => {
    const { MemoryEmailSender, PartnerWorkflow, MemoryPartnerOrgRepo, MemoryPartnerSubmissionRepo, MemoryPartnerNotificationRepo } =
      await import("@truerate/core");

    const orgs = new MemoryPartnerOrgRepo();
    const submissions = new MemoryPartnerSubmissionRepo();
    const notifications = new MemoryPartnerNotificationRepo();
    const emailSender = new MemoryEmailSender();
    await orgs.init();
    await submissions.init();

    const workflow = new PartnerWorkflow(orgs, submissions, notifications, emailSender);
    const org = {
      id: "org-email-reject",
      name: "Reject Hotel",
      country: "CZ",
      contactEmail: "reject@hotel.cz",
      status: "active" as const,
      createdAt: new Date().toISOString(),
    };
    await orgs.createOrg(org);
    await workflow.associateUser("user-reject-email", org.id, "owner");

    const draft = { name: "Reject Email Program", category: "hotel" as const, region: "CZ", fields: [], benefits: {} };
    await workflow.createDraft("user-reject-email", org.id, draft, "sub-reject-email");
    await workflow.submitForReview("user-reject-email", "sub-reject-email");
    emailSender.clear();

    const rejectReason = "Benefits are incomplete and do not meet catalog standards.";
    await workflow.reject("sub-reject-email", rejectReason);
    assert.equal(emailSender.sent.length, 1);
    const email = emailSender.sent[0];
    assert.equal(email.to, org.contactEmail);
    assert.ok(email.subject.toLowerCase().includes("reject") || email.subject.toLowerCase().includes("not approved") || email.subject.toLowerCase().includes("submission"),
      "Subject should mention rejection");
    assert.ok(email.text.includes(rejectReason), "Email body should include reject reason");
    assert.ok(email.text.includes(draft.name), "Email body should include program name");
  });

  test("email content contains no price or amount fields", async () => {
    const { MemoryEmailSender, PartnerWorkflow, MemoryPartnerOrgRepo, MemoryPartnerSubmissionRepo, MemoryPartnerNotificationRepo } =
      await import("@truerate/core");

    const orgs = new MemoryPartnerOrgRepo();
    const submissions = new MemoryPartnerSubmissionRepo();
    const notifications = new MemoryPartnerNotificationRepo();
    const emailSender = new MemoryEmailSender();
    await orgs.init();
    await submissions.init();

    const workflow = new PartnerWorkflow(orgs, submissions, notifications, emailSender);
    const org = {
      id: "org-email-noprice",
      name: "No Price Hotel",
      country: "CZ",
      contactEmail: "noprice@hotel.cz",
      status: "active" as const,
      createdAt: new Date().toISOString(),
    };
    await orgs.createOrg(org);
    await workflow.associateUser("user-noprice-email", org.id, "owner");

    const draft = { name: "No Price Program", category: "hotel" as const, region: "CZ", fields: [], benefits: {} };
    await workflow.createDraft("user-noprice-email", org.id, draft, "sub-noprice-email");
    await workflow.submitForReview("user-noprice-email", "sub-noprice-email");
    await workflow.approve("sub-noprice-email", "prog-noprice");
    await workflow.createDraft("user-noprice-email", org.id, draft, "sub-noprice-reject");
    await workflow.submitForReview("user-noprice-email", "sub-noprice-reject");
    await workflow.reject("sub-noprice-reject", "No price data needed.");

    for (const email of emailSender.sent) {
      const raw = email.subject + email.text + (email.html ?? "");
      assert.ok(!raw.includes("memberPrice"), "no memberPrice in email");
      assert.ok(!raw.includes("finalPrice"), "no finalPrice in email");
      assert.ok(!raw.includes("nightlyAmount"), "no nightlyAmount in email");
      assert.ok(!raw.includes("totalAmount"), "no totalAmount in email");
      assert.ok(!raw.includes("basePrice"), "no basePrice in email");
    }
  });

  test("no email sent when emailSender is not provided (NoOp)", async () => {
    const { PartnerWorkflow, MemoryPartnerOrgRepo, MemoryPartnerSubmissionRepo, MemoryPartnerNotificationRepo } =
      await import("@truerate/core");

    const orgs = new MemoryPartnerOrgRepo();
    const submissions = new MemoryPartnerSubmissionRepo();
    const notifications = new MemoryPartnerNotificationRepo();
    await orgs.init();
    await submissions.init();

    // No emailSender — workflow degrades gracefully
    const workflow = new PartnerWorkflow(orgs, submissions, notifications);
    const org = {
      id: "org-noop-email",
      name: "NoOp Hotel",
      country: "CZ",
      contactEmail: "noop@hotel.cz",
      status: "active" as const,
      createdAt: new Date().toISOString(),
    };
    await orgs.createOrg(org);
    await workflow.associateUser("user-noop", org.id, "owner");
    const draft = { name: "NoOp Program", category: "hotel" as const, region: "CZ", fields: [], benefits: {} };
    await workflow.createDraft("user-noop", org.id, draft, "sub-noop");
    // Should not throw even without email sender
    await assert.doesNotReject(() => workflow.submitForReview("user-noop", "sub-noop"));

    // Notification still captured in repo
    const notifs = await notifications.listBySubmission("sub-noop");
    assert.equal(notifs.length, 1);
    assert.equal(notifs[0].event, "submission_received");
  });
});

// ---------------------------------------------------------------------------
// Notification payload contains no price fields
// ---------------------------------------------------------------------------

describe("notification payload price-field guard", () => {
  test("submission_received payload contains no price fields", async () => {
    const app = await getApp();
    const { auth, orgId } = await createOrgAndApprove(app, "user-np-owner", "np-owner@example.com");
    const createRes = await app.request("/partner/submissions", {
      method: "POST",
      headers: { ...auth, ...JSON_CT },
      body: JSON.stringify({ ...sampleDraft, orgId }),
    });
    const { submission: created } = await createRes.json();
    await app.request(`/partner/submissions/${created.id}/submit`, { method: "POST", headers: auth });

    const { getPartnerNotificationRepo } = await import("@truerate/core");
    const repo = await getPartnerNotificationRepo();
    const notifs = await repo.listBySubmission(created.id);
    assert.equal(notifs.length, 1);
    for (const n of notifs) {
      const raw = JSON.stringify(n.payload);
      assert.ok(!raw.includes("price"), "no price in payload");
      assert.ok(!raw.includes("amount"), "no amount in payload");
      assert.ok(!raw.includes("nightly"), "no nightly in payload");
    }
  });

  test("submission_approved payload contains no price fields", async () => {
    const app = await getApp();
    const { getPartnerSubmissionRepo, getPartnerNotificationRepo } = await import("@truerate/core");
    const subRepo = await getPartnerSubmissionRepo();
    const sub = {
      id: "sub-notif-approve-np",
      orgId: "org-np-approve",
      submittedByUserId: "user-x",
      status: "submitted" as const,
      source: "partner" as const,
      programDraft: { name: "NP Program", category: "hotel" as const, region: "CZ", fields: [], benefits: {} },
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    await subRepo.create(sub);
    await app.request(`/admin/submissions/${sub.id}/approve`, {
      method: "POST",
      headers: { ...adminHeader, ...JSON_CT },
      body: JSON.stringify({ publishedProgramId: "prog-np" }),
    });

    const notifRepo = await getPartnerNotificationRepo();
    const notifs = await notifRepo.listBySubmission(sub.id);
    assert.ok(notifs.some((n) => n.event === "submission_approved"));
    for (const n of notifs) {
      const raw = JSON.stringify(n.payload);
      assert.ok(!raw.includes("price"), "no price in payload");
      assert.ok(!raw.includes("amount"), "no amount in payload");
      assert.ok(!raw.includes("nightly"), "no nightly in payload");
    }
  });
});
