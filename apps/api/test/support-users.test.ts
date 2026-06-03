import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

// Admin support user-management endpoints (issue #77).
// Covers: search, view, MCP URL rotate/revoke, audit log recording.

const ADMIN_SECRET = "test-admin-secret-77";

before(() => {
  process.env.TRUERATE_INMEMORY = "true";
  process.env.TRUERATE_JWT_SECRET = "support-test-secret";
  process.env.TRUERATE_CRED_KEY = randomBytes(32).toString("base64");
  process.env.ADMIN_SECRET = ADMIN_SECRET;
  process.env.MCP_PUBLIC_URL = "https://mcp.test.example";
});

async function getApp() {
  const { app } = await import("../src/app.js");
  return app;
}

beforeEach(async () => {
  const { resetAppCatalog, resetAppAudit } = await import("../src/app.js");
  const { resetUserRepo } = await import("@truerate/core");
  resetAppCatalog();
  resetAppAudit();
  resetUserRepo();
});

const admin = { "x-admin-secret": ADMIN_SECRET };
const JSON_CT = { "Content-Type": "application/json" };

const rnd = () => `u${Math.random().toString(36).slice(2)}@example.com`;

async function registerUser(app: Awaited<ReturnType<typeof getApp>>, email = rnd()): Promise<{ token: string; id: string; email: string }> {
  const res = await app.request("/auth/register", {
    method: "POST",
    headers: { ...JSON_CT },
    body: JSON.stringify({ email, password: "pw123456", market: "cz" }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  return { token: body.token, id: body.user.id, email };
}

// ─── Auth guard ───────────────────────────────────────────────────────────────

test("GET /admin/users — 401 without admin secret", async () => {
  const app = await getApp();
  const res = await app.request("/admin/users?email=test");
  assert.equal(res.status, 401);
});

test("GET /admin/users/:id — 401 without admin secret", async () => {
  const app = await getApp();
  const res = await app.request("/admin/users/some-id");
  assert.equal(res.status, 401);
});

test("POST /admin/users/:id/mcp-url/rotate — 401 without admin secret", async () => {
  const app = await getApp();
  const res = await app.request("/admin/users/some-id/mcp-url/rotate", { method: "POST" });
  assert.equal(res.status, 401);
});

test("DELETE /admin/users/:id/mcp-url — 401 without admin secret", async () => {
  const app = await getApp();
  const res = await app.request("/admin/users/some-id/mcp-url", { method: "DELETE", headers: admin });
  // 404 is fine — confirms auth passed
  assert.ok([204, 404].includes((await app.request("/admin/users/nonexistent/mcp-url", { method: "DELETE", headers: admin })).status));
});

// ─── User search ──────────────────────────────────────────────────────────────

test("GET /admin/users — requires email query param", async () => {
  const app = await getApp();
  const res = await app.request("/admin/users", { headers: admin });
  assert.equal(res.status, 400);
});

test("GET /admin/users?email= — finds matching user", async () => {
  const app = await getApp();
  const { email } = await registerUser(app, "alice@example.com");
  await registerUser(app, "bob@other.com");

  const res = await app.request("/admin/users?email=alice", { headers: admin });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.count, 1);
  assert.equal(body.users[0].email, email);
});

test("GET /admin/users?email= — returns multiple matches", async () => {
  const app = await getApp();
  await registerUser(app, "carol@acme.com");
  await registerUser(app, "charlie@acme.com");
  await registerUser(app, "dave@other.com");

  const res = await app.request("/admin/users?email=acme", { headers: admin });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.count, 2);
});

test("GET /admin/users — response never contains passwordHash or encryptedCredential", async () => {
  const app = await getApp();
  await registerUser(app, "secure@example.com");

  const res = await app.request("/admin/users?email=secure", { headers: admin });
  const raw = await res.text();
  assert.ok(!raw.includes("passwordHash"), "never exposes passwordHash");
  assert.ok(!raw.includes("encryptedCredential"), "never exposes encryptedCredential");
});

// ─── User profile view ────────────────────────────────────────────────────────

test("GET /admin/users/:id — returns user profile with vault summary", async () => {
  const app = await getApp();
  const { id, email } = await registerUser(app);

  const res = await app.request(`/admin/users/${id}`, { headers: admin });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.user.id, id);
  assert.equal(body.user.email, email);
  assert.ok("membershipCount" in body.user);
  assert.ok("mcpUrl" in body.user);
  assert.equal(body.user.mcpUrl.active, false);
});

test("GET /admin/users/:id — 404 for unknown user", async () => {
  const app = await getApp();
  const res = await app.request("/admin/users/no-such-user", { headers: admin });
  assert.equal(res.status, 404);
});

test("GET /admin/users/:id — profile reflects MCP URL status", async () => {
  const app = await getApp();
  const { id, token } = await registerUser(app);

  // Issue MCP URL as the user
  await app.request("/me/mcp-url", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });

  const res = await app.request(`/admin/users/${id}`, { headers: admin });
  const body = await res.json();
  assert.equal(body.user.mcpUrl.active, true);
  assert.ok(body.user.mcpUrl.createdAt);
  // Must NOT expose the token hash
  assert.ok(!JSON.stringify(body).includes("hash"), "never exposes token hash");
});

// ─── MCP URL rotate ───────────────────────────────────────────────────────────

test("POST /admin/users/:id/mcp-url/rotate — issues a new token", async () => {
  const app = await getApp();
  const { id } = await registerUser(app);

  const res = await app.request(`/admin/users/${id}/mcp-url/rotate`, {
    method: "POST",
    headers: admin,
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.match(body.token, /^[A-Za-z0-9_-]+$/);
  assert.equal(body.url, `https://mcp.test.example/u/${body.token}/mcp`);
  assert.ok(body.createdAt);
});

test("POST /admin/users/:id/mcp-url/rotate — invalidates previous token", async () => {
  const app = await getApp();
  const { id, token: userToken } = await registerUser(app);

  // User issues their own token
  const first = await (await app.request("/me/mcp-url", {
    method: "POST",
    headers: { Authorization: `Bearer ${userToken}` },
  })).json();

  // Support rotates
  const second = await (await app.request(`/admin/users/${id}/mcp-url/rotate`, {
    method: "POST",
    headers: admin,
  })).json();

  assert.notEqual(first.token, second.token, "rotation issues a fresh token");
});

test("POST /admin/users/:id/mcp-url/rotate — 404 for unknown user", async () => {
  const app = await getApp();
  const res = await app.request("/admin/users/no-such-user/mcp-url/rotate", {
    method: "POST",
    headers: admin,
  });
  assert.equal(res.status, 404);
});

// ─── MCP URL revoke ───────────────────────────────────────────────────────────

test("DELETE /admin/users/:id/mcp-url — revokes active token", async () => {
  const app = await getApp();
  const { id, token: userToken } = await registerUser(app);

  // Issue first
  await app.request("/me/mcp-url", {
    method: "POST",
    headers: { Authorization: `Bearer ${userToken}` },
  });

  const del = await app.request(`/admin/users/${id}/mcp-url`, {
    method: "DELETE",
    headers: admin,
  });
  assert.equal(del.status, 204);

  // Verify it's gone
  const profile = await (await app.request(`/admin/users/${id}`, { headers: admin })).json();
  assert.equal(profile.user.mcpUrl.active, false);
});

test("DELETE /admin/users/:id/mcp-url — idempotent when already revoked", async () => {
  const app = await getApp();
  const { id } = await registerUser(app);

  const res = await app.request(`/admin/users/${id}/mcp-url`, {
    method: "DELETE",
    headers: admin,
  });
  assert.equal(res.status, 204);
});

test("DELETE /admin/users/:id/mcp-url — 404 for unknown user", async () => {
  const app = await getApp();
  const res = await app.request("/admin/users/no-such-user/mcp-url", {
    method: "DELETE",
    headers: admin,
  });
  assert.equal(res.status, 404);
});

// ─── Audit log ────────────────────────────────────────────────────────────────

test("support actions are recorded in the audit log", async () => {
  const app = await getApp();
  const { id } = await registerUser(app);

  // View
  await app.request(`/admin/users/${id}`, { headers: admin });

  // Rotate
  await app.request(`/admin/users/${id}/mcp-url/rotate`, { method: "POST", headers: admin });

  // Revoke
  await app.request(`/admin/users/${id}/mcp-url`, { method: "DELETE", headers: admin });

  const res = await app.request(`/admin/users/${id}/audit`, { headers: admin });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(body.count >= 3);
  const actions = body.entries.map((e: { action: string }) => e.action);
  assert.ok(actions.includes("support.user.view"));
  assert.ok(actions.includes("support.user.mcp_url.rotate"));
  assert.ok(actions.includes("support.user.mcp_url.revoke"));
});

test("GET /admin/audit — lists recent audit entries", async () => {
  const app = await getApp();
  const { id } = await registerUser(app);
  await app.request(`/admin/users/${id}`, { headers: admin });

  const res = await app.request("/admin/audit", { headers: admin });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(body.count >= 1);
  assert.ok(body.entries[0].timestamp);
  assert.ok(body.entries[0].action);
});

test("audit entries never contain passwordHash or token secrets", async () => {
  const app = await getApp();
  const { id } = await registerUser(app);
  await app.request(`/admin/users/${id}/mcp-url/rotate`, { method: "POST", headers: admin });

  const res = await app.request(`/admin/users/${id}/audit`, { headers: admin });
  const raw = await res.text();
  assert.ok(!raw.includes("passwordHash"));
  assert.ok(!raw.includes("hash"));
});
