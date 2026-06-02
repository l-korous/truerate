import { test, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

before(() => {
  process.env.TRUERATE_INMEMORY = "true";
  process.env.TRUERATE_JWT_SECRET = "test-secret-rl";
  process.env.TRUERATE_CRED_KEY = randomBytes(32).toString("base64");
  // Very low limit so tests run fast
  process.env.RATE_LIMIT_MAX = "3";
  process.env.RATE_LIMIT_WINDOW_MS = "60000";
});

// Reset the limiter state between tests so hits don't bleed across.
afterEach(async () => {
  const { apiLimiter } = await import("../src/rate-limit.js");
  // Reset all keys by calling the internal reset exposed for tests.
  // We brute-force reset expected keys used in each test.
  apiLimiter.reset("ip:unknown");
  apiLimiter.reset("ip:1.2.3.4");
  for (let i = 0; i < 20; i++) {
    apiLimiter.reset(`uid:user-rl-${i}`);
  }
});

async function getApp() {
  const { app } = await import("../src/app.js");
  return app;
}

test("requests under the limit pass through (IP path)", async () => {
  const app = await getApp();
  for (let i = 0; i < 3; i++) {
    const r = await app.request("/health");
    assert.equal(r.status, 200, `request ${i + 1} should pass`);
  }
});

test("request over the limit returns 429 (IP path)", async () => {
  const app = await getApp();
  // Exhaust the limit
  for (let i = 0; i < 3; i++) await app.request("/health");
  const r = await app.request("/health");
  assert.equal(r.status, 429);
  const body = await r.json();
  assert.equal(body.error, "rate_limit_exceeded");
});

test("429 response includes Retry-After and X-RateLimit headers", async () => {
  const app = await getApp();
  for (let i = 0; i < 3; i++) await app.request("/health");
  const r = await app.request("/health");
  assert.equal(r.status, 429);
  assert.ok(r.headers.get("Retry-After"), "Retry-After header present");
  assert.ok(r.headers.get("X-RateLimit-Limit"), "X-RateLimit-Limit header present");
  assert.ok(r.headers.get("X-RateLimit-Remaining") === "0", "remaining is 0 when blocked");
  assert.ok(r.headers.get("X-RateLimit-Reset"), "X-RateLimit-Reset header present");
});

test("X-RateLimit-Remaining decrements with each request", async () => {
  const app = await getApp();
  const r1 = await app.request("/health");
  assert.equal(r1.headers.get("X-RateLimit-Remaining"), "2");
  const r2 = await app.request("/health");
  assert.equal(r2.headers.get("X-RateLimit-Remaining"), "1");
  const r3 = await app.request("/health");
  assert.equal(r3.headers.get("X-RateLimit-Remaining"), "0");
});

test("authenticated users are keyed by userId (separate from IP limit)", async () => {
  // Register two different users and confirm they each get their own counter.
  const app = await getApp();

  const rnd = () => `rl${Math.random().toString(36).slice(2)}@example.com`;
  const reg = async (email: string) => {
    const r = await app.request("/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "pw123456", market: "cz" }),
    });
    return ((await r.json()) as { token: string }).token;
  };

  const token1 = await reg(rnd());
  const token2 = await reg(rnd());

  // Exhaust limit for user1
  for (let i = 0; i < 3; i++) {
    await app.request("/me", { headers: { Authorization: `Bearer ${token1}` } });
  }
  const blocked = await app.request("/me", { headers: { Authorization: `Bearer ${token1}` } });
  assert.equal(blocked.status, 429, "user1 should be rate-limited");

  // user2 should still be under the limit
  const ok = await app.request("/me", { headers: { Authorization: `Bearer ${token2}` } });
  assert.notEqual(ok.status, 429, "user2 should not be blocked by user1's limit");
});
