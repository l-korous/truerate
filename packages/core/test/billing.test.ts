import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  getSubscriptionRepo,
  resetSubscriptionRepo,
  mapStripeStatus,
  subscriptionEntitled,
  isEntitled,
  trialDaysRemaining,
  DEFAULT_TRIAL_DAYS,
} from "../src/billing.js";

beforeEach(() => {
  process.env.TRUERATE_INMEMORY = "true";
  resetSubscriptionRepo();
});

test("mapStripeStatus maps Stripe states to our lifecycle", () => {
  assert.equal(mapStripeStatus("trialing"), "trialing");
  assert.equal(mapStripeStatus("active"), "active");
  assert.equal(mapStripeStatus("past_due"), "past_due");
  assert.equal(mapStripeStatus("unpaid"), "past_due");
  assert.equal(mapStripeStatus("canceled"), "canceled");
  assert.equal(mapStripeStatus("incomplete_expired"), "canceled");
  assert.equal(mapStripeStatus("incomplete"), "none");
});

test("subscriptionEntitled: only trial + active use paid features", () => {
  assert.equal(subscriptionEntitled("trialing"), true);
  assert.equal(subscriptionEntitled("active"), true);
  for (const s of ["past_due", "canceled", "none"] as const) assert.equal(subscriptionEntitled(s), false);
});

test("SubscriptionRepo: upsert + get + lookup by Stripe IDs + update", async () => {
  const repo = await getSubscriptionRepo();
  await repo.upsert({
    hotelId: "h1",
    status: "trialing",
    stripeCustomerId: "cus_1",
    stripeSubscriptionId: "sub_1",
    updatedAt: new Date().toISOString(),
  });
  assert.equal((await repo.get("h1"))?.status, "trialing");
  assert.equal((await repo.byStripeCustomer("cus_1"))?.hotelId, "h1");
  assert.equal((await repo.bySubscription("sub_1"))?.hotelId, "h1");
  assert.equal(await repo.get("nope"), null);

  // A subsequent subscription.updated → active.
  const cur = await repo.get("h1");
  await repo.upsert({ ...cur!, status: "active" });
  assert.equal((await repo.get("h1"))?.status, "active");
});

test("DEFAULT_TRIAL_DAYS is 90", () => {
  assert.equal(DEFAULT_TRIAL_DAYS, 90);
});

test("isEntitled: null/undefined/none → false", () => {
  assert.equal(isEntitled(null), false);
  assert.equal(isEntitled(undefined), false);
  assert.equal(isEntitled({ hotelId: "h", status: "none", updatedAt: "" }), false);
  assert.equal(isEntitled({ hotelId: "h", status: "canceled", updatedAt: "" }), false);
  assert.equal(isEntitled({ hotelId: "h", status: "past_due", updatedAt: "" }), false);
});

test("isEntitled: active → always true", () => {
  assert.equal(isEntitled({ hotelId: "h", status: "active", updatedAt: "" }), true);
});

test("isEntitled: trialing without trialEndsAt → true (unlimited trial)", () => {
  assert.equal(isEntitled({ hotelId: "h", status: "trialing", updatedAt: "" }), true);
});

test("isEntitled: trialing with future trialEndsAt → true", () => {
  const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  assert.equal(isEntitled({ hotelId: "h", status: "trialing", trialEndsAt: future, updatedAt: "" }), true);
});

test("isEntitled: trialing with past trialEndsAt → false (trial expired)", () => {
  const past = new Date(Date.now() - 1000).toISOString();
  assert.equal(isEntitled({ hotelId: "h", status: "trialing", trialEndsAt: past, updatedAt: "" }), false);
});

test("trialDaysRemaining: null for non-trialing or missing trialEndsAt", () => {
  assert.equal(trialDaysRemaining({ hotelId: "h", status: "active", updatedAt: "" }), null);
  assert.equal(trialDaysRemaining({ hotelId: "h", status: "trialing", updatedAt: "" }), null);
});

test("trialDaysRemaining: rounds up, clamps to 0 for expired", () => {
  const sevenDays = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const days = trialDaysRemaining({ hotelId: "h", status: "trialing", trialEndsAt: sevenDays, updatedAt: "" });
  assert.ok(days !== null && days >= 7 && days <= 8, `expected ~7, got ${days}`);

  const past = new Date(Date.now() - 1000).toISOString();
  assert.equal(trialDaysRemaining({ hotelId: "h", status: "trialing", trialEndsAt: past, updatedAt: "" }), 0);
});

test("SubscriptionRepo.listExpiringSoon: returns only trialing within window", async () => {
  const repo = await getSubscriptionRepo();
  const soon = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();   // 5d from now
  const later = new Date(Date.now() + 40 * 24 * 60 * 60 * 1000).toISOString(); // 40d from now
  const past = new Date(Date.now() - 1000).toISOString();                       // expired

  await Promise.all([
    repo.upsert({ hotelId: "expiring-soon", status: "trialing", trialEndsAt: soon, updatedAt: "" }),
    repo.upsert({ hotelId: "expiring-later", status: "trialing", trialEndsAt: later, updatedAt: "" }),
    repo.upsert({ hotelId: "already-expired", status: "trialing", trialEndsAt: past, updatedAt: "" }),
    repo.upsert({ hotelId: "active-no-trial", status: "active", updatedAt: "" }),
  ]);

  const within7 = await repo.listExpiringSoon(7);
  assert.ok(within7.some((s) => s.hotelId === "expiring-soon"), "should include 5d expiry in 7d window");
  assert.ok(!within7.some((s) => s.hotelId === "expiring-later"), "should exclude 40d expiry from 7d window");
  assert.ok(!within7.some((s) => s.hotelId === "already-expired"), "should exclude past expiry");
  assert.ok(!within7.some((s) => s.hotelId === "active-no-trial"), "should exclude non-trialing");

  const within30 = await repo.listExpiringSoon(30);
  assert.ok(within30.some((s) => s.hotelId === "expiring-soon"));
  assert.ok(!within30.some((s) => s.hotelId === "expiring-later"), "40d is still outside 30d window");
});
