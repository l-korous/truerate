import { test, before } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

// Per-IP signup abuse control: at most 5 sign-ups/hour AND 10/24h from one IP.
// (See apps/api/src/rate-limit.ts — signupRateLimit.)

before(() => {
  process.env.TRUERATE_INMEMORY = "true";
  process.env.TRUERATE_JWT_SECRET = "test-secret-signup";
  process.env.TRUERATE_CRED_KEY = randomBytes(32).toString("base64");
  // Keep the GLOBAL limiter far out of the way so it can't mask the signup cap.
  process.env.RATE_LIMIT_MAX = "100000";
});

async function getApp() {
  const { app } = await import("../src/app.js");
  return app;
}

let seq = 0;
const uniqEmail = () => `signup-rl-${Date.now()}-${seq++}@example.com`;

function register(app: { request: (p: string, i: RequestInit) => Promise<Response> }, ip: string) {
  return app.request("/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify({ email: uniqEmail(), password: "pw123456", market: "cz" }),
  });
}

test("blocks the 6th signup within an hour from one IP (default cap 5)", async () => {
  const app = await getApp();
  const { __setSignupLimitsForTest } = await import("../src/rate-limit.js");
  __setSignupLimitsForTest(5, 100); // 5/hour; daily set high so it can't interfere
  const ip = "203.0.113.1";

  for (let i = 0; i < 5; i++) {
    const r = await register(app, ip);
    assert.equal(r.status, 200, `signup ${i + 1} of 5 should pass`);
  }
  const blocked = await register(app, ip);
  assert.equal(blocked.status, 429, "6th signup in the hour must be blocked");
  const body = (await blocked.json()) as { error: string; retryAfter: number };
  assert.equal(body.error, "signup_rate_limited");
  assert.ok(body.retryAfter > 0, "retryAfter seconds present");
  assert.ok(blocked.headers.get("Retry-After"), "Retry-After header present");
});

test("signup counters are independent per source IP", async () => {
  const app = await getApp();
  const { __setSignupLimitsForTest } = await import("../src/rate-limit.js");
  __setSignupLimitsForTest(2, 100);
  const a = "203.0.113.2";
  const b = "203.0.113.3";

  await register(app, a);
  await register(app, a);
  assert.equal((await register(app, a)).status, 429, "IP A blocked after its 2 are used");
  assert.equal((await register(app, b)).status, 200, "IP B is unaffected by IP A's limit");
});

test("enforces the 24h cap independently of the hourly cap", async () => {
  const app = await getApp();
  const { __setSignupLimitsForTest } = await import("../src/rate-limit.js");
  __setSignupLimitsForTest(100, 3); // hourly out of the way; daily = 3
  const ip = "203.0.113.4";

  for (let i = 0; i < 3; i++) {
    assert.equal((await register(app, ip)).status, 200, `daily signup ${i + 1} of 3 should pass`);
  }
  const blocked = await register(app, ip);
  assert.equal(blocked.status, 429, "4th signup in 24h must be blocked by the daily cap");
  assert.equal(((await blocked.json()) as { error: string }).error, "signup_rate_limited");
});

test("XFF chain uses the first (client) IP", async () => {
  const app = await getApp();
  const { __setSignupLimitsForTest } = await import("../src/rate-limit.js");
  __setSignupLimitsForTest(1, 100);
  // Two requests whose XFF chains share the FIRST hop but differ downstream:
  // both must be attributed to the same client IP, so the 2nd is blocked.
  const r1 = await app.request("/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": "198.51.100.7, 10.0.0.1" },
    body: JSON.stringify({ email: uniqEmail(), password: "pw123456", market: "cz" }),
  });
  assert.equal(r1.status, 200);
  const r2 = await app.request("/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": "198.51.100.7, 172.16.0.9" },
    body: JSON.stringify({ email: uniqEmail(), password: "pw123456", market: "cz" }),
  });
  assert.equal(r2.status, 429, "same client IP (first XFF hop) is rate-limited");
});
