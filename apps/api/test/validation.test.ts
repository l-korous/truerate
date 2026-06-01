/**
 * Zod validation tests for all API endpoints.
 * Covers: invalid payloads → 400 with structured error detail, valid payloads → success.
 */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

before(() => {
  process.env.TRUERATE_INMEMORY = "true";
  process.env.TRUERATE_JWT_SECRET = "test-secret-please-ignore";
  process.env.TRUERATE_CRED_KEY = randomBytes(32).toString("base64");
});

async function getApp() {
  const { app } = await import("../src/app.js");
  return app;
}

const rnd = () => `v${Math.random().toString(36).slice(2)}@example.com`;

async function registerUser(app: Awaited<ReturnType<typeof getApp>>) {
  const email = rnd();
  const res = await app.request("/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "validPass1", market: "cz" }),
  });
  assert.equal(res.status, 200);
  const { token } = await res.json();
  return { token, email };
}
const authed = (token: string) => ({ "Content-Type": "application/json", Authorization: `Bearer ${token}` });

// --- POST /auth/register -------------------------------------------------------

test("register: rejects missing email", async () => {
  const app = await getApp();
  const res = await app.request("/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: "validPass1" }),
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error, "validation_failed");
  assert.ok(Array.isArray(body.issues));
});

test("register: rejects invalid email format", async () => {
  const app = await getApp();
  const res = await app.request("/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "not-an-email", password: "validPass1" }),
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error, "validation_failed");
});

test("register: rejects short password (< 8 chars)", async () => {
  const app = await getApp();
  const res = await app.request("/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: rnd(), password: "short" }),
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error, "validation_failed");
  assert.ok(body.issues.some((i: any) => /8 character/.test(i.message)));
});

test("register: rejects non-JSON body", async () => {
  const app = await getApp();
  const res = await app.request("/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "not json",
  });
  assert.equal(res.status, 400);
});

test("register: accepts valid payload", async () => {
  const app = await getApp();
  const res = await app.request("/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: rnd(), password: "validPass1", market: "de" }),
  });
  assert.equal(res.status, 200);
});

// --- POST /auth/login ----------------------------------------------------------

test("login: rejects missing email", async () => {
  const app = await getApp();
  const res = await app.request("/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: "validPass1" }),
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error, "validation_failed");
});

test("login: rejects missing password", async () => {
  const app = await getApp();
  const res = await app.request("/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: rnd() }),
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error, "validation_failed");
});

test("login: rejects non-email in email field", async () => {
  const app = await getApp();
  const res = await app.request("/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "notanemail", password: "anything" }),
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error, "validation_failed");
});

// --- POST /memberships ---------------------------------------------------------

test("memberships: rejects empty body", async () => {
  const app = await getApp();
  const { token } = await registerUser(app);
  const res = await app.request("/memberships", {
    method: "POST", headers: authed(token),
    body: JSON.stringify({}),
  });
  assert.equal(res.status, 400);
});

test("memberships: rejects custom membership with empty benefits array", async () => {
  const app = await getApp();
  const { token } = await registerUser(app);
  const res = await app.request("/memberships", {
    method: "POST", headers: authed(token),
    body: JSON.stringify({ label: "My Hotel", benefits: [] }),
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error, "validation_failed");
});

test("memberships: rejects custom benefit with invalid kind", async () => {
  const app = await getApp();
  const { token } = await registerUser(app);
  const res = await app.request("/memberships", {
    method: "POST", headers: authed(token),
    body: JSON.stringify({
      label: "My Hotel",
      benefits: [{ scope: "property", value: { kind: "invalidKind", percentOff: 0.1 } }],
    }),
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error, "validation_failed");
});

test("memberships: rejects benefit with invalid scope", async () => {
  const app = await getApp();
  const { token } = await registerUser(app);
  const res = await app.request("/memberships", {
    method: "POST", headers: authed(token),
    body: JSON.stringify({
      label: "My Hotel",
      benefits: [{ scope: "notAScope", value: { kind: "percentDiscount", percentOff: 0.1 } }],
    }),
  });
  assert.equal(res.status, 400);
});

test("memberships: accepts valid catalog membership", async () => {
  const app = await getApp();
  const { token } = await registerUser(app);
  const res = await app.request("/memberships", {
    method: "POST", headers: authed(token),
    body: JSON.stringify({ programId: "booking_genius", tier: "Level 2", attributes: {} }),
  });
  assert.equal(res.status, 200);
});

test("memberships: accepts valid custom membership", async () => {
  const app = await getApp();
  const { token } = await registerUser(app);
  const res = await app.request("/memberships", {
    method: "POST", headers: authed(token),
    body: JSON.stringify({
      label: "Hotel PECR",
      benefits: [{
        scope: "property",
        match: { domains: ["pecr.cz"] },
        value: { kind: "percentDiscount", percentOff: 0.15 },
      }],
    }),
  });
  assert.equal(res.status, 200);
});

// --- POST /search/hotels -------------------------------------------------------

test("search/hotels: rejects missing location", async () => {
  const app = await getApp();
  const { token } = await registerUser(app);
  const res = await app.request("/search/hotels", {
    method: "POST", headers: authed(token),
    body: JSON.stringify({ checkIn: "2026-07-10", checkOut: "2026-07-12" }),
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error, "validation_failed");
});

test("search/hotels: rejects non-ISO date for checkIn", async () => {
  const app = await getApp();
  const { token } = await registerUser(app);
  const res = await app.request("/search/hotels", {
    method: "POST", headers: authed(token),
    body: JSON.stringify({ location: "Prague", checkIn: "July 10 2026", checkOut: "2026-07-12" }),
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error, "validation_failed");
  assert.ok(body.issues.some((i: any) => /YYYY-MM-DD/.test(i.message)));
});

test("search/hotels: rejects non-ISO date for checkOut", async () => {
  const app = await getApp();
  const { token } = await registerUser(app);
  const res = await app.request("/search/hotels", {
    method: "POST", headers: authed(token),
    body: JSON.stringify({ location: "Prague", checkIn: "2026-07-10", checkOut: "12/07/2026" }),
  });
  assert.equal(res.status, 400);
});

test("search/hotels: rejects limit > 20", async () => {
  const app = await getApp();
  const { token } = await registerUser(app);
  const res = await app.request("/search/hotels", {
    method: "POST", headers: authed(token),
    body: JSON.stringify({ location: "Prague", checkIn: "2026-07-10", checkOut: "2026-07-12", limit: 99 }),
  });
  assert.equal(res.status, 400);
});

test("search/hotels: accepts valid minimal payload", async () => {
  const app = await getApp();
  const { token } = await registerUser(app);
  const res = await app.request("/search/hotels", {
    method: "POST", headers: authed(token),
    body: JSON.stringify({ location: "Vienna", checkIn: "2026-08-01", checkOut: "2026-08-03" }),
  });
  assert.equal(res.status, 200);
});

// --- POST /benefits/match ------------------------------------------------------

test("benefits/match: rejects missing domain", async () => {
  const app = await getApp();
  const { token } = await registerUser(app);
  const res = await app.request("/benefits/match", {
    method: "POST", headers: authed(token),
    body: JSON.stringify({ property: { name: "Hotel X" } }),
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error, "validation_failed");
});

test("benefits/match: rejects empty domain string", async () => {
  const app = await getApp();
  const { token } = await registerUser(app);
  const res = await app.request("/benefits/match", {
    method: "POST", headers: authed(token),
    body: JSON.stringify({ domain: "" }),
  });
  assert.equal(res.status, 400);
});

test("benefits/match: accepts minimal valid payload (domain only)", async () => {
  const app = await getApp();
  const { token } = await registerUser(app);
  const res = await app.request("/benefits/match", {
    method: "POST", headers: authed(token),
    body: JSON.stringify({ domain: "booking.com" }),
  });
  assert.equal(res.status, 200);
});

test("benefits/match: validates structured error includes path info", async () => {
  const app = await getApp();
  const { token } = await registerUser(app);
  const res = await app.request("/benefits/match", {
    method: "POST", headers: authed(token),
    body: JSON.stringify({}),
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error, "validation_failed");
  assert.ok(Array.isArray(body.issues) && body.issues.length > 0);
  assert.ok(body.issues[0].path !== undefined);
  assert.ok(body.issues[0].message !== undefined);
});
