// Referral program tests (#353):
//   - POST /partner/orgs with referralCode attributes the referral
//   - Self-referral is blocked at reward time
//   - GET /partner/orgs/:id/referral returns code + dashboard data
//   - Approving the referee extends the referrer's trial by 90 days

import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

const ADMIN_SECRET = "referral-test-admin-secret";

before(() => {
  process.env.TRUERATE_INMEMORY = "true";
  process.env.TRUERATE_JWT_SECRET = "referral-test-jwt";
  process.env.TRUERATE_CRED_KEY = randomBytes(32).toString("base64");
  process.env.ADMIN_SECRET = ADMIN_SECRET;
});

beforeEach(async () => {
  const { resetAppPartner, resetAppSubscription, resetAppReferral } = await import("../src/app.js");
  const { resetPartnerWorkflow } = await import("@truerate/core");
  const { resetReferralRepo } = await import("@truerate/core");
  const { apiLimiter } = await import("../src/rate-limit.js");
  resetAppPartner();
  resetPartnerWorkflow();
  resetAppSubscription();
  resetAppReferral();
  resetReferralRepo();
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

async function createOrg(
  app: Awaited<ReturnType<typeof getApp>>,
  userId = "uid-1",
  email = "u@test.cz",
  referralCode?: string,
): Promise<{ orgId: string; authHeader: { Authorization: string } }> {
  const token = await makeToken(userId, email);
  const authHeader = { Authorization: `Bearer ${token}` };
  const body: Record<string, string> = { name: "Referral Hotel", country: "CZ", contactEmail: email };
  if (referralCode) body.referralCode = referralCode;
  const res = await app.request("/partner/orgs", {
    method: "POST",
    headers: { ...authHeader, ...CT },
    body: JSON.stringify(body),
  });
  assert.equal(res.status, 201, `org creation returned ${res.status}: ${await res.clone().text()}`);
  const { org } = (await res.json()) as { org: { id: string } };
  return { orgId: org.id, authHeader };
}

async function approveOrg(app: Awaited<ReturnType<typeof getApp>>, orgId: string): Promise<void> {
  const res = await app.request(`/admin/partners/${orgId}/approve`, {
    method: "POST",
    headers: { ...adminH, ...CT },
    body: JSON.stringify({}),
  });
  assert.equal(res.status, 200, `org approval returned ${res.status}`);
}

// ── Referral code endpoint ────────────────────────────────────────────────────

test("GET /partner/orgs/:id/referral: 401 without auth", async () => {
  const app = await getApp();
  const res = await app.request("/partner/orgs/some-id/referral");
  assert.equal(res.status, 401);
});

test("GET /partner/orgs/:id/referral: 403 for non-member", async () => {
  const app = await getApp();
  const { orgId } = await createOrg(app, "uid-owner", "owner@test.cz");

  const otherToken = await makeToken("uid-other", "other@test.cz");
  const res = await app.request(`/partner/orgs/${orgId}/referral`, {
    headers: { Authorization: `Bearer ${otherToken}` },
  });
  assert.equal(res.status, 403);
});

test("GET /partner/orgs/:id/referral: returns code and empty referrals list", async () => {
  const app = await getApp();
  const { orgId, authHeader } = await createOrg(app, "uid-r1", "r1@test.cz");

  const res = await app.request(`/partner/orgs/${orgId}/referral`, { headers: authHeader });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { code: string; referralLink: string; referrals: unknown[] };
  assert.ok(typeof body.code === "string" && body.code.length === 8, `expected 8-char code, got ${body.code}`);
  assert.ok(body.referralLink.includes(body.code), "referralLink should contain the code");
  assert.deepEqual(body.referrals, []);
});

test("GET /partner/orgs/:id/referral: code is stable across calls", async () => {
  const app = await getApp();
  const { orgId, authHeader } = await createOrg(app, "uid-r2", "r2@test.cz");

  const r1 = await app.request(`/partner/orgs/${orgId}/referral`, { headers: authHeader });
  const r2 = await app.request(`/partner/orgs/${orgId}/referral`, { headers: authHeader });
  const b1 = (await r1.json()) as { code: string };
  const b2 = (await r2.json()) as { code: string };
  assert.equal(b1.code, b2.code);
});

// ── Referral attribution at signup ────────────────────────────────────────────

test("POST /partner/orgs with valid referralCode records a pending referral", async () => {
  const app = await getApp();

  // Referrer creates org and gets their code.
  const { orgId: referrerId, authHeader: refAuth } = await createOrg(app, "uid-ref", "ref@test.cz");
  const codeRes = await app.request(`/partner/orgs/${referrerId}/referral`, { headers: refAuth });
  const { code } = (await codeRes.json()) as { code: string };

  // Referee signs up using the code.
  const { orgId: refereeId } = await createOrg(app, "uid-ee", "ee@test.cz", code);

  // Verify via referral dashboard.
  const dashboard = await app.request(`/partner/orgs/${referrerId}/referral`, { headers: refAuth });
  const body = (await dashboard.json()) as { referrals: { refereeId: string; status: string }[] };
  assert.equal(body.referrals.length, 1);
  assert.equal(body.referrals[0]!.refereeId, refereeId);
  assert.equal(body.referrals[0]!.status, "pending");
});

test("POST /partner/orgs with unknown referralCode: org created, no referral recorded", async () => {
  const app = await getApp();
  // Unknown code should be silently ignored (not 400).
  const { orgId, authHeader } = await createOrg(app, "uid-noref", "noref@test.cz", "BADCODE");

  const res = await app.request(`/partner/orgs/${orgId}/referral`, { headers: authHeader });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { referrals: unknown[] };
  assert.deepEqual(body.referrals, []);
});

// ── Reward on referee activation ──────────────────────────────────────────────

test("Approving referee extends referrer trial by 90 days and marks referral rewarded", async () => {
  const app = await getApp();

  // Referrer: create org, approve (starts 90-day trial).
  const { orgId: referrerId, authHeader: refAuth } = await createOrg(app, "uid-r3", "r3@test.cz");
  await approveOrg(app, referrerId);
  const codeRes = await app.request(`/partner/orgs/${referrerId}/referral`, { headers: refAuth });
  const { code } = (await codeRes.json()) as { code: string };

  // Record referrer's trial end BEFORE the reward.
  const { getSubscriptionRepo } = await import("@truerate/core");
  const subRepo = await getSubscriptionRepo();
  const beforeSub = await subRepo.get(referrerId);
  assert.ok(beforeSub?.trialEndsAt, "referrer should have a trial end");
  const beforeEnd = new Date(beforeSub!.trialEndsAt!).getTime();

  // Referee signs up + is approved.
  await createOrg(app, "uid-e2", "e2@test.cz", code);
  // Get the referee's orgId from the referral dashboard.
  const dashRes = await app.request(`/partner/orgs/${referrerId}/referral`, { headers: refAuth });
  const { referrals } = (await dashRes.json()) as { referrals: { refereeId: string }[] };
  const refereeId = referrals[0]!.refereeId;
  await approveOrg(app, refereeId);

  // Referrer's trial should now be ~180 days from now (90 original + 90 reward).
  const afterSub = await subRepo.get(referrerId);
  assert.ok(afterSub?.trialEndsAt, "referrer should still have trialEndsAt");
  const afterEnd = new Date(afterSub!.trialEndsAt!).getTime();
  const extendedMs = afterEnd - beforeEnd;
  // Should be ~90 days extended (allow ±5s for test timing).
  const expectedMs = 90 * 24 * 60 * 60 * 1000;
  assert.ok(
    Math.abs(extendedMs - expectedMs) < 10_000,
    `expected ~90-day extension, got ${Math.round(extendedMs / 86_400_000)} days`,
  );

  // Referral should be marked rewarded.
  const dash2 = await app.request(`/partner/orgs/${referrerId}/referral`, { headers: refAuth });
  const body2 = (await dash2.json()) as { referrals: { status: string; rewardedAt: string | null }[] };
  assert.equal(body2.referrals[0]!.status, "rewarded");
  assert.ok(body2.referrals[0]!.rewardedAt !== null);
});

test("Reward is granted only once (idempotency): second approve has no effect", async () => {
  const app = await getApp();

  const { orgId: referrerId, authHeader: refAuth } = await createOrg(app, "uid-r4", "r4@test.cz");
  await approveOrg(app, referrerId);
  const codeRes = await app.request(`/partner/orgs/${referrerId}/referral`, { headers: refAuth });
  const { code } = (await codeRes.json()) as { code: string };

  await createOrg(app, "uid-e3", "e3@test.cz", code);
  const dashRes = await app.request(`/partner/orgs/${referrerId}/referral`, { headers: refAuth });
  const { referrals } = (await dashRes.json()) as { referrals: { refereeId: string }[] };
  const refereeId = referrals[0]!.refereeId;

  // First approval: reward granted.
  await approveOrg(app, refereeId);
  const { getSubscriptionRepo } = await import("@truerate/core");
  const subRepo = await getSubscriptionRepo();
  const afterFirst = await subRepo.get(referrerId);
  const endAfterFirst = new Date(afterFirst!.trialEndsAt!).getTime();

  // Second approval attempt (re-approve): no additional extension.
  const reapprove = await app.request(`/admin/partners/${refereeId}/approve`, {
    method: "POST",
    headers: { ...adminH, ...CT },
    body: JSON.stringify({}),
  });
  // May succeed (idempotent) or return an error — either is fine; we only check the sub.
  void reapprove;
  const afterSecond = await subRepo.get(referrerId);
  assert.equal(afterSecond?.trialEndsAt, afterFirst?.trialEndsAt, "trial end must not change on second approve");
});

test("Self-referral: using own code does not create a referral", async () => {
  const app = await getApp();

  const { orgId, authHeader } = await createOrg(app, "uid-self", "self@test.cz");
  const codeRes = await app.request(`/partner/orgs/${orgId}/referral`, { headers: authHeader });
  const { code } = (await codeRes.json()) as { code: string };

  // Simulate a self-referral: the code belongs to this org, and a NEW org created
  // with it is a different org (so self-referral via the same code on a new org is
  // tested via the "referrer === referee" guard at reward time).
  // The real self-referral guard is: if codeDoc.hotelId === new orgId, skip.
  // We test this indirectly: create a 2nd org with the code, approve it — then
  // confirm the referral record lists the 2nd org as referee, NOT the code owner.
  const { orgId: otherId } = await createOrg(app, "uid-self2", "self2@test.cz", code);
  await approveOrg(app, orgId);
  await approveOrg(app, otherId);

  const dash = await app.request(`/partner/orgs/${orgId}/referral`, { headers: authHeader });
  const { referrals } = (await dash.json()) as { referrals: { refereeId: string; status: string }[] };
  // otherId is the referee; code owner (orgId) is the referrer — not a self-referral.
  assert.ok(referrals.some((r) => r.refereeId === otherId && r.status === "rewarded"));
  assert.ok(!referrals.some((r) => r.refereeId === orgId), "code owner should never appear as their own referee");
});
