import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  getSubscriptionRepo,
  resetSubscriptionRepo,
  mapStripeStatus,
  subscriptionEntitled,
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
