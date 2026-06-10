import { test, before } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

// Stripe billing is REWORK-FREE + env-gated: with no Stripe keys set, every
// endpoint is inert (501) and the rest of the app is unaffected. These tests
// lock that in (the live Stripe paths are covered manually with test keys).

before(() => {
  process.env.TRUERATE_INMEMORY = "true";
  process.env.TRUERATE_JWT_SECRET = "billing-test";
  process.env.TRUERATE_CRED_KEY = randomBytes(32).toString("base64");
  process.env.ADMIN_SECRET = "billing-admin";
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_PRICE_ID;
  delete process.env.STRIPE_WEBHOOK_SECRET;
});

async function getApp() {
  const { app } = await import("../src/app.js");
  return app;
}
const adminHeaders = { "Content-Type": "application/json", "x-admin-secret": "billing-admin" };

test("checkout requires admin, then is 501 until Stripe is configured", async () => {
  const app = await getApp();
  // No admin secret → 401 (owner-only action).
  const noauth = await app.request("/billing/checkout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ hotelId: "h1" }),
  });
  assert.equal(noauth.status, 401);
  // Admin, but no Stripe keys → 501 billing_not_configured.
  const r = await app.request("/billing/checkout", {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ hotelId: "h1", email: "a@b.cz" }),
  });
  assert.equal(r.status, 501);
  assert.equal(((await r.json()) as { error: string }).error, "billing_not_configured");
});

test("portal is admin-gated + 501 until configured", async () => {
  const app = await getApp();
  assert.equal((await app.request("/billing/portal", { method: "POST", body: "{}" })).status, 401);
  const r = await app.request("/billing/portal", { method: "POST", headers: adminHeaders, body: JSON.stringify({ customerId: "cus_1" }) });
  assert.equal(r.status, 501);
});

test("stripe webhook is public but 501 until the signing secret is set", async () => {
  const app = await getApp();
  const r = await app.request("/webhooks/stripe", { method: "POST", body: JSON.stringify({ type: "ping" }) });
  assert.equal(r.status, 501);
});
