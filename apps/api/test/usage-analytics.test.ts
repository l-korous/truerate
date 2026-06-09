import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { resetUsageRepo } from "@truerate/core";

before(() => {
  process.env.TRUERATE_INMEMORY = "true";
  process.env.TRUERATE_JWT_SECRET = "test-secret-usage";
  process.env.TRUERATE_CRED_KEY = randomBytes(32).toString("base64");
  process.env.ADMIN_SECRET = "test-admin-secret";
  // Keep limiters out of the way.
  process.env.RATE_LIMIT_MAX = "100000";
});

beforeEach(() => resetUsageRepo());

async function getApp() {
  const { app } = await import("../src/app.js");
  return app;
}
const rnd = () => `usage${Math.random().toString(36).slice(2)}@example.com`;
const authed = (t: string) => ({ "Content-Type": "application/json", Authorization: `Bearer ${t}` });

async function setupUserWithGenius(app: Awaited<ReturnType<typeof getApp>>) {
  const reg = await app.request("/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: rnd(), password: "pw123456", market: "cz" }),
  });
  const { token } = (await reg.json()) as { token: string };
  await app.request("/memberships", {
    method: "POST",
    headers: authed(token),
    body: JSON.stringify({ programId: "booking_genius", tier: "Level 3", attributes: {} }),
  });
  return token;
}

async function getUsage(app: Awaited<ReturnType<typeof getApp>>, query = "", secret = "test-admin-secret") {
  return app.request(`/admin/analytics/usage${query}`, { headers: { "x-admin-secret": secret } });
}

// Fire-and-forget emission → poll until the report shows events (or give up).
async function waitForUsage(app: Awaited<ReturnType<typeof getApp>>, query = "") {
  for (let i = 0; i < 40; i++) {
    const r = await getUsage(app, query);
    const body = (await r.json()) as { total: number };
    if (body.total > 0) return body;
    await new Promise((res) => setTimeout(res, 10));
  }
  return (await (await getUsage(app, query)).json()) as { total: number };
}

test("GET /admin/analytics/usage requires the admin secret", async () => {
  const app = await getApp();
  assert.equal((await app.request("/admin/analytics/usage")).status, 401);
  assert.equal((await getUsage(app, "", "wrong")).status, 401);
  assert.equal((await getUsage(app)).status, 200);
});

test("/benefits/match records provider + perk usage (extension channel)", async () => {
  const app = await getApp();
  const token = await setupUserWithGenius(app);

  const match = await app.request("/benefits/match", {
    method: "POST",
    headers: authed(token),
    body: JSON.stringify({ domain: "booking.com" }),
  });
  assert.equal(match.status, 200);

  const report = (await waitForUsage(app)) as {
    total: number;
    byProvider: { key: string; count: number }[];
    byPerk: { key: string; count: number }[];
    byCountry: { key: string; count: number }[];
  };
  assert.ok(report.total > 0, "usage events recorded");
  assert.ok(
    report.byProvider.some((b) => b.key === "booking_genius"),
    "booking_genius surfaced in provider usage",
  );
  assert.ok(report.byPerk.length > 0, "at least one perk surfaced");
  assert.ok(
    report.byCountry.some((b) => b.key === "CZ"),
    "country attributed from the user's market",
  );
});

test("channel filter isolates extension vs mcp", async () => {
  const app = await getApp();
  const token = await setupUserWithGenius(app);
  await app.request("/benefits/match", {
    method: "POST",
    headers: authed(token),
    body: JSON.stringify({ domain: "booking.com" }),
  });
  await waitForUsage(app);

  const ext = (await (await getUsage(app, "?channel=extension")).json()) as { total: number };
  const mcp = (await (await getUsage(app, "?channel=mcp")).json()) as { total: number };
  assert.ok(ext.total > 0, "extension events present");
  assert.equal(mcp.total, 0, "no mcp events from the extension path");
});

test("usage report never contains price/money fields (rule #1)", async () => {
  const app = await getApp();
  const token = await setupUserWithGenius(app);
  await app.request("/benefits/match", {
    method: "POST",
    headers: authed(token),
    body: JSON.stringify({ domain: "booking.com" }),
  });
  await waitForUsage(app);
  const raw = await (await getUsage(app)).text();
  for (const k of ["price", "amountOff", "percentOff", "memberPrice", "savings", "currency", "nightly"]) {
    assert.ok(!raw.includes(`"${k}"`), `usage report must not contain '${k}'`);
  }
});

test("seed-demo populates realistic usage (admin only)", async () => {
  const app = await getApp();
  // No admin secret → 401.
  assert.equal((await app.request("/admin/analytics/seed-demo?count=10", { method: "POST" })).status, 401);
  // With the secret → seeds the requested count.
  const r = await app.request("/admin/analytics/seed-demo?count=400", {
    method: "POST",
    headers: { "x-admin-secret": "test-admin-secret" },
  });
  assert.equal(r.status, 200);
  assert.equal(((await r.json()) as { seeded: number }).seeded, 400);
  // The leaderboard reflects it across multiple providers + countries.
  const agg = (await (await getUsage(app)).json()) as { total: number; byProvider: unknown[]; byCountry: unknown[] };
  assert.ok(agg.total >= 400, "events recorded");
  assert.ok(agg.byProvider.length > 1, "multiple providers");
  assert.ok(agg.byCountry.length > 1, "multiple countries");
});
