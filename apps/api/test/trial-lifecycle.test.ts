// Trial lifecycle tests (#352):
//   - Approving a partner org auto-starts a 90-day free trial
//   - GET /partner/orgs/:id/subscription returns entitlement info
//   - POST /admin/billing/reminders sends emails to expiring trials

import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

const ADMIN_SECRET = "trial-test-admin-secret";

before(() => {
  process.env.TRUERATE_INMEMORY = "true";
  process.env.TRUERATE_JWT_SECRET = "trial-test-jwt";
  process.env.TRUERATE_CRED_KEY = randomBytes(32).toString("base64");
  process.env.ADMIN_SECRET = ADMIN_SECRET;
});

beforeEach(async () => {
  const { resetAppPartner, resetAppSubscription } = await import("../src/app.js");
  const { resetPartnerWorkflow } = await import("@truerate/core");
  const { apiLimiter } = await import("../src/rate-limit.js");
  resetAppPartner();
  resetPartnerWorkflow();
  resetAppSubscription();
  apiLimiter.reset("ip:unknown");
});

const adminH = { "x-admin-secret": ADMIN_SECRET };
const CT = { "Content-Type": "application/json" };

async function getApp() {
  const { app } = await import("../src/app.js");
  return app;
}

async function makeToken(userId: string, email: string): Promise<string> {
  const { issueToken } = await import("../src/auth.js");
  return issueToken(userId, email);
}

/** Create an org via user endpoint, returns { orgId, authHeader }. */
async function createOrg(app: Awaited<ReturnType<typeof getApp>>, userId = "uid-1", email = "u@test.cz"): Promise<{ orgId: string; authHeader: { Authorization: string } }> {
  const token = await makeToken(userId, email);
  const authHeader = { Authorization: `Bearer ${token}` };
  const res = await app.request("/partner/orgs", {
    method: "POST",
    headers: { ...authHeader, ...CT },
    body: JSON.stringify({ name: "Trial Hotel Group", country: "CZ", contactEmail: email }),
  });
  assert.equal(res.status, 201, `org creation returned ${res.status}`);
  const { org } = (await res.json()) as { org: { id: string } };
  return { orgId: org.id, authHeader };
}

/** Approve an org via the admin endpoint. */
async function approveOrg(app: Awaited<ReturnType<typeof getApp>>, orgId: string): Promise<void> {
  const res = await app.request(`/admin/partners/${orgId}/approve`, {
    method: "POST",
    headers: { ...adminH, ...CT },
    body: JSON.stringify({}),
  });
  assert.equal(res.status, 200, `org approval returned ${res.status}`);
}

// ── Auto-trial on approval ────────────────────────────────────────────────────

test("approving an org creates a trialing subscription", async () => {
  const app = await getApp();
  const { orgId } = await createOrg(app);
  await approveOrg(app, orgId);

  const { getSubscriptionRepo } = await import("@truerate/core");
  const repo = await getSubscriptionRepo();
  const sub = await repo.get(orgId);

  assert.equal(sub?.status, "trialing");
  assert.ok(sub?.trialEndsAt, "trialEndsAt should be set");

  const daysLeft = (new Date(sub!.trialEndsAt!).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
  assert.ok(daysLeft >= 89 && daysLeft <= 91, `expected ~90 days, got ${daysLeft}`);
});

// ── GET /partner/orgs/:id/subscription ────────────────────────────────────────

test("GET /partner/orgs/:id/subscription: 401 without auth", async () => {
  const app = await getApp();
  const res = await app.request("/partner/orgs/some-id/subscription");
  assert.equal(res.status, 401);
});

test("GET /partner/orgs/:id/subscription: 403 for non-member", async () => {
  const app = await getApp();
  const { orgId } = await createOrg(app, "uid-owner", "owner@test.cz");
  await approveOrg(app, orgId);

  // Different user — not a member.
  const otherToken = await makeToken("uid-other", "other@test.cz");
  const res = await app.request(`/partner/orgs/${orgId}/subscription`, {
    headers: { Authorization: `Bearer ${otherToken}` },
  });
  assert.equal(res.status, 403);
});

test("GET /partner/orgs/:id/subscription: returns trial info for org owner", async () => {
  const app = await getApp();
  const { orgId, authHeader } = await createOrg(app, "uid-owner2", "owner2@test.cz");
  await approveOrg(app, orgId);

  const res = await app.request(`/partner/orgs/${orgId}/subscription`, { headers: authHeader });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { status: string; daysLeft: number | null; entitled: boolean };
  assert.equal(body.status, "trialing");
  assert.ok(typeof body.daysLeft === "number" && body.daysLeft > 0);
  assert.equal(body.entitled, true);
});

test("GET /partner/orgs/:id/subscription: status=none for pending (unapproved) org", async () => {
  const app = await getApp();
  const { orgId, authHeader } = await createOrg(app, "uid-owner3", "owner3@test.cz");
  // Deliberately NOT approving the org.

  const res = await app.request(`/partner/orgs/${orgId}/subscription`, { headers: authHeader });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { status: string; entitled: boolean };
  assert.equal(body.status, "none");
  assert.equal(body.entitled, false);
});

// ── POST /admin/billing/reminders ─────────────────────────────────────────────

test("POST /admin/billing/reminders: 401 without admin secret", async () => {
  const app = await getApp();
  const res = await app.request("/admin/billing/reminders", { method: "POST" });
  assert.equal(res.status, 401);
});

test("POST /admin/billing/reminders: returns empty sent list when no expiring trials", async () => {
  const app = await getApp();
  const res = await app.request("/admin/billing/reminders", {
    method: "POST",
    headers: { ...adminH },
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { sent: unknown[] };
  assert.ok(Array.isArray(body.sent));
  assert.equal(body.sent.length, 0);
});

test("POST /admin/billing/reminders: includes hotels with trial expiring within 7 days", async () => {
  const app = await getApp();
  const { orgId } = await createOrg(app, "uid-exp", "exp@test.cz");

  // Override the trial to expire in 5 days (within the 7-day window).
  const { getSubscriptionRepo } = await import("@truerate/core");
  const subRepo = await getSubscriptionRepo();
  const soon = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();
  await subRepo.upsert({ hotelId: orgId, status: "trialing", trialEndsAt: soon, updatedAt: new Date().toISOString() });

  const res = await app.request("/admin/billing/reminders", {
    method: "POST",
    headers: { ...adminH },
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { sent: { hotelId: string; daysLeft: number }[] };
  assert.ok(body.sent.some((s) => s.hotelId === orgId), "should include the expiring hotel");
});

test("POST /admin/billing/reminders: does not include trials expiring far in the future", async () => {
  const app = await getApp();
  const { orgId } = await createOrg(app, "uid-future", "future@test.cz");
  await approveOrg(app, orgId);
  // Default trial = 90 days, well outside any reminder window.

  const res = await app.request("/admin/billing/reminders", {
    method: "POST",
    headers: { ...adminH },
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { sent: { hotelId: string }[] };
  assert.ok(!body.sent.some((s) => s.hotelId === orgId), "fresh 90-day trial should not trigger a reminder");
});
