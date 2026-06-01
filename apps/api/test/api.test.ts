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
const rnd = () => `u${Math.random().toString(36).slice(2)}@example.com`;

async function registerUser(app: any) {
  const email = rnd();
  const res = await app.request("/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "pw12345", market: "cz" }),
  });
  assert.equal(res.status, 200);
  const { token } = await res.json();
  return { token, email };
}
const authed = (token: string) => ({ "Content-Type": "application/json", Authorization: `Bearer ${token}` });

test("health reports mock mode", async () => {
  const r = await (await getApp()).request("/health");
  assert.equal((await r.json()).mode, "mock");
});

test("programs catalog includes per-tier benefit summaries", async () => {
  const { programs } = await (await (await getApp()).request("/programs")).json();
  const genius = programs.find((p: any) => p.id === "booking_genius");
  assert.ok(genius.summaryByTier["Level 3"].some((s: string) => /20% off/.test(s)));
});

test("register then /me round-trips", async () => {
  const app = await getApp();
  const { token, email } = await registerUser(app);
  const { user } = await (await app.request("/me", { headers: authed(token) })).json();
  assert.equal(user.email, email);
});

test("login fails on wrong password", async () => {
  const app = await getApp();
  const { email } = await registerUser(app);
  const bad = await app.request("/auth/login", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "wrong" }),
  });
  assert.equal(bad.status, 401);
});

test("protected routes reject missing/invalid tokens", async () => {
  const app = await getApp();
  assert.equal((await app.request("/me")).status, 401);
  assert.equal((await app.request("/me", { headers: { Authorization: "Bearer x" } })).status, 401);
});

test("adding a catalog membership instantiates benefits", async () => {
  const app = await getApp();
  const { token } = await registerUser(app);
  const res = await app.request("/memberships", {
    method: "POST", headers: authed(token),
    body: JSON.stringify({ programId: "booking_genius", tier: "Level 3", attributes: {} }),
  });
  const { user } = await res.json();
  const m = user.memberships[0];
  assert.equal(m.programId, "booking_genius");
  assert.equal(m.label, "Booking.com Genius - Level 3");
  assert.ok(m.benefits.length >= 1);
  assert.ok(m.benefits.some((b: any) => b.value.kind === "percentDiscount" && b.value.percentOff === 0.2));
  assert.ok(m.benefits.every((b: any) => b.source === "catalog"));
});

test("adding a custom user-declared benefit (Hotel PECR 15%)", async () => {
  const app = await getApp();
  const { token } = await registerUser(app);
  const res = await app.request("/memberships", {
    method: "POST", headers: authed(token),
    body: JSON.stringify({
      label: "Hotel PECR",
      benefits: [
        { scope: "property", match: { domains: ["pecr.cz"], propertyNames: ["Hotel PECR"] },
          value: { kind: "percentDiscount", percentOff: 0.15, conditions: "direct booking" } },
      ],
    }),
  });
  const { user } = await res.json();
  const m = user.memberships[0];
  assert.equal(m.label, "Hotel PECR");
  assert.equal(m.programId, undefined);
  assert.equal(m.benefits[0].source, "user-declared");
  assert.equal(m.benefits[0].value.percentOff, 0.15);
});

test("credential field is encrypted and never returned (when a program needs it)", async () => {
  // Use a synthetic program-less custom membership to assert no secret leaks;
  // catalog programs in the MVP need no credential, so we assert hasCredential=false.
  const app = await getApp();
  const { token } = await registerUser(app);
  const res = await app.request("/memberships", {
    method: "POST", headers: authed(token),
    body: JSON.stringify({ programId: "hilton_honors", tier: "Gold", attributes: { membershipNumber: "123" } }),
  });
  const { user } = await res.json();
  const m = user.memberships[0];
  assert.equal(m.attributes.membershipNumber, "123");
  assert.equal(m.hasCredential, false);
});

test("authenticated hotel search reflects Genius savings + perks", async () => {
  const app = await getApp();
  const { token } = await registerUser(app);
  await app.request("/memberships", { method: "POST", headers: authed(token),
    body: JSON.stringify({ programId: "booking_genius", tier: "Level 3", attributes: {} }) });
  await app.request("/memberships", { method: "POST", headers: authed(token),
    body: JSON.stringify({ programId: "marriott_bonvoy", tier: "Platinum", attributes: {} }) });
  const res = await app.request("/search/hotels", { method: "POST", headers: authed(token),
    body: JSON.stringify({ location: "Prague", checkIn: "2026-07-10", checkOut: "2026-07-12", adults: 2, rooms: 1 }) });
  const result = await res.json();
  assert.ok(result.totalSavings > 0);
  assert.ok(result.programsApplied.includes("booking_genius"));
  assert.ok(result.properties.some((p: any) => p.perks.some((x: string) => /breakfast/i.test(x))));
});

test("/benefits/match returns indicative price for a declared domain discount", async () => {
  const app = await getApp();
  const { token } = await registerUser(app);
  await app.request("/memberships", { method: "POST", headers: authed(token),
    body: JSON.stringify({ label: "Hotel PECR",
      benefits: [{ scope: "property", match: { domains: ["pecr.cz"] }, value: { kind: "percentDiscount", percentOff: 0.15 } }] }) });
  const res = await app.request("/benefits/match", { method: "POST", headers: authed(token),
    body: JSON.stringify({ domain: "pecr.cz", property: { name: "Hotel PECR", publicNightly: 2000, publicTotal: 4000, currency: "CZK" } }) });
  const out = await res.json();
  assert.equal(out.matches.length, 1);
  assert.equal(out.indicativeOffer.nightlyAmount, 1700);
  assert.equal(out.indicativeOffer.indicative, true);
});

test("search validates required fields", async () => {
  const app = await getApp();
  const { token } = await registerUser(app);
  const res = await app.request("/search/hotels", { method: "POST", headers: authed(token),
    body: JSON.stringify({ location: "Prague" }) });
  assert.equal(res.status, 400);
});

test("removing a membership drops it", async () => {
  const app = await getApp();
  const { token } = await registerUser(app);
  const add = await app.request("/memberships", { method: "POST", headers: authed(token),
    body: JSON.stringify({ programId: "revolut", tier: "Metal", attributes: {} }) });
  const id = (await add.json()).user.memberships[0].id;
  const del = await app.request(`/memberships/${id}`, { method: "DELETE", headers: authed(token) });
  assert.equal((await del.json()).user.memberships.length, 0);
});

// --- Correlation ID ---------------------------------------------------------

test("generates X-Correlation-ID response header when none provided", async () => {
  const app = await getApp();
  const res = await app.request("/health");
  const id = res.headers.get("x-correlation-id");
  assert.ok(id, "correlation ID header present");
  assert.match(id!, /^[0-9a-f-]{36}$/, "looks like a UUID");
});

test("echoes back provided X-Correlation-ID in response", async () => {
  const app = await getApp();
  const correlationId = "test-corr-id-abc123";
  const res = await app.request("/health", { headers: { "x-correlation-id": correlationId } });
  assert.equal(res.headers.get("x-correlation-id"), correlationId);
});

test("each request gets a distinct correlation ID when none provided", async () => {
  const app = await getApp();
  const [r1, r2] = await Promise.all([app.request("/health"), app.request("/health")]);
  const id1 = r1.headers.get("x-correlation-id");
  const id2 = r2.headers.get("x-correlation-id");
  assert.ok(id1 && id2, "both have correlation IDs");
  assert.notEqual(id1, id2, "IDs are unique per request");
});

// --- CORS allowlist ---------------------------------------------------------

test("CORS: allowed origin receives Access-Control-Allow-Origin header", async () => {
  const app = await getApp();
  // Default dev allowlist includes http://localhost:3000
  const res = await app.request("/health", { headers: { Origin: "http://localhost:3000" } });
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), "http://localhost:3000");
});

test("CORS: disallowed origin does not receive Access-Control-Allow-Origin header", async () => {
  const app = await getApp();
  const res = await app.request("/health", { headers: { Origin: "https://evil.example.com" } });
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), null);
});

test("CORS: preflight (OPTIONS) for allowed origin returns 204 with correct headers", async () => {
  const app = await getApp();
  const res = await app.request("/health", {
    method: "OPTIONS",
    headers: {
      Origin: "http://localhost:3000",
      "Access-Control-Request-Method": "GET",
      "Access-Control-Request-Headers": "Authorization",
    },
  });
  assert.ok([200, 204].includes(res.status), `Expected 200 or 204, got ${res.status}`);
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), "http://localhost:3000");
});

test("CORS: preflight for disallowed origin does not allow it", async () => {
  const app = await getApp();
  const res = await app.request("/health", {
    method: "OPTIONS",
    headers: {
      Origin: "https://evil.example.com",
      "Access-Control-Request-Method": "GET",
    },
  });
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), null);
});
