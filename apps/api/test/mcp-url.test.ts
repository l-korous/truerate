import { test, before } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

// Per-user MCP URL endpoints (issue #82): issue/rotate (POST), status (GET),
// revoke (DELETE). The raw token/URL is returned ONCE at issue time and never
// re-exposed; only its hash is stored.

before(() => {
  process.env.TRUERATE_INMEMORY = "true";
  process.env.TRUERATE_JWT_SECRET = "test-secret-please-ignore";
  process.env.TRUERATE_CRED_KEY = randomBytes(32).toString("base64");
  process.env.ADMIN_SECRET = "test-admin-secret";
  process.env.MCP_PUBLIC_URL = "https://mcp.test.example";
});

async function getApp() {
  const { app } = await import("../src/app.js");
  return app;
}
const rnd = () => `u${Math.random().toString(36).slice(2)}@example.com`;
async function registerUser(app: Awaited<ReturnType<typeof getApp>>): Promise<string> {
  const res = await app.request("/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: rnd(), password: "pw123456", market: "cz" }),
  });
  assert.equal(res.status, 200);
  return (await res.json()).token as string;
}
const authed = (token: string) => ({ "Content-Type": "application/json", Authorization: `Bearer ${token}` });
const funnel = (app: Awaited<ReturnType<typeof getApp>>) =>
  app.request("/admin/funnel/activation", { headers: { "x-admin-secret": "test-admin-secret" } }).then((r) => r.json());

test("POST /me/mcp-url requires auth", async () => {
  const app = await getApp();
  assert.equal((await app.request("/me/mcp-url", { method: "POST" })).status, 401);
});

test("POST /me/mcp-url issues an opaque token + path-form URL", async () => {
  const app = await getApp();
  const token = await registerUser(app);
  const res = await app.request("/me/mcp-url", { method: "POST", headers: authed(token) });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.match(body.token, /^[A-Za-z0-9_-]+$/, "opaque token");
  assert.equal(body.url, `https://mcp.test.example/u/${body.token}/mcp`);
  assert.ok(body.createdAt, "createdAt present");
});

test("POST rotates: a second issue returns a fresh token/url", async () => {
  const app = await getApp();
  const token = await registerUser(app);
  const first = await (await app.request("/me/mcp-url", { method: "POST", headers: authed(token) })).json();
  const second = await (await app.request("/me/mcp-url", { method: "POST", headers: authed(token) })).json();
  assert.notEqual(first.token, second.token, "rotation issues a fresh token");
  assert.notEqual(first.url, second.url);
});

test("GET /me/mcp-url reports status without leaking the token/hash", async () => {
  const app = await getApp();
  const token = await registerUser(app);
  const pre = await (await app.request("/me/mcp-url", { headers: authed(token) })).json();
  assert.equal(pre.active, false, "inactive before issuing");

  await app.request("/me/mcp-url", { method: "POST", headers: authed(token) });
  const post = await (await app.request("/me/mcp-url", { headers: authed(token) })).json();
  assert.equal(post.active, true);
  assert.ok(post.createdAt, "exposes createdAt");
  const str = JSON.stringify(post);
  assert.ok(!str.includes("hash"), "never exposes the stored hash");
  assert.ok(!("token" in post), "never re-exposes the raw token");
});

test("DELETE /me/mcp-url revokes the token", async () => {
  const app = await getApp();
  const token = await registerUser(app);
  await app.request("/me/mcp-url", { method: "POST", headers: authed(token) });
  assert.equal((await app.request("/me/mcp-url", { method: "DELETE", headers: authed(token) })).status, 204);
  const post = await (await app.request("/me/mcp-url", { headers: authed(token) })).json();
  assert.equal(post.active, false, "inactive after revoke");
});

test("issuing an MCP URL marks the mcp_url_obtained milestone", async () => {
  const app = await getApp();
  const token = await registerUser(app);
  const before = await funnel(app);
  await app.request("/me/mcp-url", { method: "POST", headers: authed(token) });
  const after = await funnel(app);
  assert.ok(after.funnel.mcp_url_obtained >= before.funnel.mcp_url_obtained + 1);
});
