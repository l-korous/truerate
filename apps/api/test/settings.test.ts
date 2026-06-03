import { test, before } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

before(() => {
  process.env.TRUERATE_INMEMORY = "true";
  process.env.TRUERATE_JWT_SECRET = "test-secret-please-ignore";
  process.env.TRUERATE_CRED_KEY = randomBytes(32).toString("base64");
});

async function getApp() {
  const { app, resetAppCatalog } = await import("../src/app.js");
  resetAppCatalog();
  return app;
}
const rnd = () => `s${Math.random().toString(36).slice(2)}@example.com`;

async function registerUser(app: Awaited<ReturnType<typeof getApp>>) {
  const email = rnd();
  const res = await app.request("/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "pw123456", market: "cz" }),
  });
  assert.equal(res.status, 200);
  const { token } = await res.json() as { token: string };
  return { token, email };
}
const authed = (token: string) => ({ "Content-Type": "application/json", Authorization: `Bearer ${token}` });

// ── PATCH /me — update settings ────────────────────────────────────────────

test("PATCH /me: update market to 'us' changes currency to USD", async () => {
  const app = await getApp();
  const { token } = await registerUser(app);

  const res = await app.request("/me", {
    method: "PATCH",
    headers: authed(token),
    body: JSON.stringify({ market: "us" }),
  });
  assert.equal(res.status, 200);
  const { user } = await res.json() as { user: { market: string; currency: string } };
  assert.equal(user.market, "us");
  assert.equal(user.currency, "USD");
});

test("PATCH /me: update market to 'pl' changes currency to PLN", async () => {
  const app = await getApp();
  const { token } = await registerUser(app);

  const res = await app.request("/me", {
    method: "PATCH",
    headers: authed(token),
    body: JSON.stringify({ market: "pl" }),
  });
  assert.equal(res.status, 200);
  const { user } = await res.json() as { user: { market: string; currency: string } };
  assert.equal(user.market, "pl");
  assert.equal(user.currency, "PLN");
});

test("PATCH /me: settings persist across /me reads", async () => {
  const app = await getApp();
  const { token } = await registerUser(app);

  await app.request("/me", {
    method: "PATCH",
    headers: authed(token),
    body: JSON.stringify({ market: "de" }),
  });

  const meRes = await app.request("/me", { headers: authed(token) });
  assert.equal(meRes.status, 200);
  const { user } = await meRes.json() as { user: { market: string; currency: string } };
  assert.equal(user.market, "de");
  assert.equal(user.currency, "EUR");
});

test("PATCH /me: unsupported market returns 400", async () => {
  const app = await getApp();
  const { token } = await registerUser(app);

  const res = await app.request("/me", {
    method: "PATCH",
    headers: authed(token),
    body: JSON.stringify({ market: "zz" }),
  });
  assert.equal(res.status, 400);
});

test("PATCH /me: empty body is a no-op (200, unchanged)", async () => {
  const app = await getApp();
  const { token } = await registerUser(app);

  const res = await app.request("/me", {
    method: "PATCH",
    headers: authed(token),
    body: JSON.stringify({}),
  });
  assert.equal(res.status, 200);
  const { user } = await res.json() as { user: { market: string; currency: string } };
  assert.equal(user.market, "cz");
  assert.equal(user.currency, "EUR");
});

test("PATCH /me: requires auth", async () => {
  const app = await getApp();
  const res = await app.request("/me", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ market: "us" }),
  });
  assert.equal(res.status, 401);
});

test("PATCH /me: response user has no price fields", async () => {
  const app = await getApp();
  const { token } = await registerUser(app);

  const res = await app.request("/me", {
    method: "PATCH",
    headers: authed(token),
    body: JSON.stringify({ market: "us" }),
  });
  const body = await res.json() as { user: Record<string, unknown> };
  const userKeys = Object.keys(body.user);
  const pricePattern = /price|nightly|total|amount_off|member_price/i;
  for (const k of userKeys) {
    assert.ok(!pricePattern.test(k), `price-related key in response: ${k}`);
  }
});
