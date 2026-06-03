import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

const ADMIN_SECRET = "test-admin-secret-78";

before(() => {
  process.env.TRUERATE_INMEMORY = "true";
  process.env.TRUERATE_JWT_SECRET = "flags-test-secret";
  process.env.TRUERATE_CRED_KEY = randomBytes(32).toString("base64");
  process.env.ADMIN_SECRET = ADMIN_SECRET;
});

async function getApp() {
  const { app } = await import("../src/app.js");
  return app;
}

beforeEach(async () => {
  const { resetAppFlags } = await import("../src/app.js");
  const { resetFeatureFlagRepo, resetAppConfigRepo } = await import("@truerate/core");
  resetAppFlags();
  resetFeatureFlagRepo();
  resetAppConfigRepo();
});

const adminHeader = { "x-admin-secret": ADMIN_SECRET };
const JSON_CT = { "Content-Type": "application/json" };
const HEADERS = { ...adminHeader, ...JSON_CT };

// ─── Auth guard ──────────────────────────────────────────────────────────────

test("GET /admin/flags — 401 without admin secret", async () => {
  const app = await getApp();
  const res = await app.request("/admin/flags");
  assert.equal(res.status, 401);
  assert.equal((await res.json()).error, "unauthorized");
});

test("GET /admin/config — 401 without admin secret", async () => {
  const app = await getApp();
  const res = await app.request("/admin/config");
  assert.equal(res.status, 401);
  assert.equal((await res.json()).error, "unauthorized");
});

// ─── Feature flags: create ───────────────────────────────────────────────────

test("POST /admin/flags — creates a flag", async () => {
  const app = await getApp();
  const res = await app.request("/admin/flags", {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({ key: "extension.genius_aware", enabled: true, description: "Genius-aware extension mode" }),
  });
  assert.equal(res.status, 201);
  const { flag } = await res.json();
  assert.equal(flag.key, "extension.genius_aware");
  assert.equal(flag.enabled, true);
  assert.equal(flag.id, "extension.genius_aware");
  assert.ok(flag.createdAt);
  assert.ok(flag.updatedAt);
  assert.equal(flag.updatedBy, "admin");
});

test("POST /admin/flags — 400 for invalid key format", async () => {
  const app = await getApp();
  const res = await app.request("/admin/flags", {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({ key: "UPPER CASE INVALID!", enabled: false, description: "bad" }),
  });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, "validation_failed");
});

test("POST /admin/flags — 409 when key already exists", async () => {
  const app = await getApp();
  const payload = JSON.stringify({ key: "dupe.flag", enabled: false, description: "x" });
  await app.request("/admin/flags", { method: "POST", headers: HEADERS, body: payload });
  const res = await app.request("/admin/flags", { method: "POST", headers: HEADERS, body: payload });
  assert.equal(res.status, 409);
  assert.equal((await res.json()).error, "already_exists");
});

// ─── Feature flags: list ─────────────────────────────────────────────────────

test("GET /admin/flags — lists all flags", async () => {
  const app = await getApp();
  await app.request("/admin/flags", {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({ key: "flag.a", enabled: true, description: "a" }),
  });
  await app.request("/admin/flags", {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({ key: "flag.b", enabled: false, description: "b" }),
  });
  const res = await app.request("/admin/flags", { headers: adminHeader });
  assert.equal(res.status, 200);
  const { flags, count } = await res.json();
  assert.equal(count, 2);
  assert.ok(Array.isArray(flags));
});

test("GET /admin/flags?environment=production — filters by environment", async () => {
  const app = await getApp();
  await app.request("/admin/flags", {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({ key: "flag.prod", enabled: true, description: "prod only", environment: "production" }),
  });
  await app.request("/admin/flags", {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({ key: "flag.global", enabled: true, description: "global" }),
  });
  const res = await app.request("/admin/flags?environment=production", { headers: adminHeader });
  const { flags } = await res.json();
  // Both the prod-scoped flag and the global flag (no environment) should appear
  assert.ok(flags.length >= 1);
  assert.ok(flags.some((f: { key: string }) => f.key === "flag.prod"));
});

// ─── Feature flags: get ──────────────────────────────────────────────────────

test("GET /admin/flags/:key — returns the flag", async () => {
  const app = await getApp();
  await app.request("/admin/flags", {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({ key: "mcp.v2", enabled: false, description: "MCP v2 rollout" }),
  });
  const res = await app.request("/admin/flags/mcp.v2", { headers: adminHeader });
  assert.equal(res.status, 200);
  const { flag } = await res.json();
  assert.equal(flag.key, "mcp.v2");
  assert.equal(flag.enabled, false);
});

test("GET /admin/flags/:key — 404 for unknown key", async () => {
  const app = await getApp();
  const res = await app.request("/admin/flags/does.not.exist", { headers: adminHeader });
  assert.equal(res.status, 404);
  assert.equal((await res.json()).error, "not_found");
});

// ─── Feature flags: update ───────────────────────────────────────────────────

test("PUT /admin/flags/:key — updates description and enabled", async () => {
  const app = await getApp();
  await app.request("/admin/flags", {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({ key: "update.me", enabled: false, description: "original" }),
  });
  const res = await app.request("/admin/flags/update.me", {
    method: "PUT",
    headers: HEADERS,
    body: JSON.stringify({ enabled: true, description: "updated" }),
  });
  assert.equal(res.status, 200);
  const { flag } = await res.json();
  assert.equal(flag.enabled, true);
  assert.equal(flag.description, "updated");
  assert.equal(flag.key, "update.me");
});

test("PUT /admin/flags/:key — 404 for unknown key", async () => {
  const app = await getApp();
  const res = await app.request("/admin/flags/missing.key", {
    method: "PUT",
    headers: HEADERS,
    body: JSON.stringify({ enabled: true }),
  });
  assert.equal(res.status, 404);
});

// ─── Feature flags: toggle ───────────────────────────────────────────────────

test("POST /admin/flags/:key/toggle — flips enabled state", async () => {
  const app = await getApp();
  await app.request("/admin/flags", {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({ key: "toggle.me", enabled: false, description: "toggleable" }),
  });
  const res = await app.request("/admin/flags/toggle.me/toggle", {
    method: "POST",
    headers: adminHeader,
  });
  assert.equal(res.status, 200);
  const { flag } = await res.json();
  assert.equal(flag.enabled, true, "enabled should be flipped to true");

  // Toggle back
  const res2 = await app.request("/admin/flags/toggle.me/toggle", {
    method: "POST",
    headers: adminHeader,
  });
  assert.equal((await res2.json()).flag.enabled, false, "enabled should be flipped back to false");
});

test("POST /admin/flags/:key/toggle — 404 for unknown flag", async () => {
  const app = await getApp();
  const res = await app.request("/admin/flags/ghost.flag/toggle", {
    method: "POST",
    headers: adminHeader,
  });
  assert.equal(res.status, 404);
});

// ─── Feature flags: delete ───────────────────────────────────────────────────

test("DELETE /admin/flags/:key — deletes the flag", async () => {
  const app = await getApp();
  await app.request("/admin/flags", {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({ key: "delete.me", enabled: true, description: "to be deleted" }),
  });
  const delRes = await app.request("/admin/flags/delete.me", {
    method: "DELETE",
    headers: adminHeader,
  });
  assert.equal(delRes.status, 204);

  // Confirm gone
  const getRes = await app.request("/admin/flags/delete.me", { headers: adminHeader });
  assert.equal(getRes.status, 404);
});

test("DELETE /admin/flags/:key — 404 for unknown key", async () => {
  const app = await getApp();
  const res = await app.request("/admin/flags/ghost.key", {
    method: "DELETE",
    headers: adminHeader,
  });
  assert.equal(res.status, 404);
});

// ─── App config: create ──────────────────────────────────────────────────────

test("POST /admin/config — creates a config entry", async () => {
  const app = await getApp();
  const res = await app.request("/admin/config", {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({ key: "mcp.max_results", value: "20", description: "Max results returned by MCP" }),
  });
  assert.equal(res.status, 201);
  const { entry } = await res.json();
  assert.equal(entry.key, "mcp.max_results");
  assert.equal(entry.value, "20");
  assert.equal(entry.id, "mcp.max_results");
  assert.ok(entry.createdAt);
  assert.equal(entry.updatedBy, "admin");
});

test("POST /admin/config — 400 for invalid key format", async () => {
  const app = await getApp();
  const res = await app.request("/admin/config", {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({ key: "BAD KEY!", value: "v", description: "d" }),
  });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, "validation_failed");
});

test("POST /admin/config — 409 when key already exists", async () => {
  const app = await getApp();
  const payload = JSON.stringify({ key: "dupe.config", value: "x", description: "d" });
  await app.request("/admin/config", { method: "POST", headers: HEADERS, body: payload });
  const res = await app.request("/admin/config", { method: "POST", headers: HEADERS, body: payload });
  assert.equal(res.status, 409);
  assert.equal((await res.json()).error, "already_exists");
});

// ─── App config: list ────────────────────────────────────────────────────────

test("GET /admin/config — lists all config entries", async () => {
  const app = await getApp();
  await app.request("/admin/config", {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({ key: "config.a", value: "1", description: "a" }),
  });
  await app.request("/admin/config", {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({ key: "config.b", value: "2", description: "b" }),
  });
  const res = await app.request("/admin/config", { headers: adminHeader });
  assert.equal(res.status, 200);
  const { entries, count } = await res.json();
  assert.equal(count, 2);
  assert.ok(Array.isArray(entries));
});

// ─── App config: get ─────────────────────────────────────────────────────────

test("GET /admin/config/:key — returns the config entry", async () => {
  const app = await getApp();
  await app.request("/admin/config", {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({ key: "ext.rate_limit", value: "100", description: "Extension rate limit" }),
  });
  const res = await app.request("/admin/config/ext.rate_limit", { headers: adminHeader });
  assert.equal(res.status, 200);
  const { entry } = await res.json();
  assert.equal(entry.key, "ext.rate_limit");
  assert.equal(entry.value, "100");
});

test("GET /admin/config/:key — 404 for unknown key", async () => {
  const app = await getApp();
  const res = await app.request("/admin/config/no.such.key", { headers: adminHeader });
  assert.equal(res.status, 404);
  assert.equal((await res.json()).error, "not_found");
});

// ─── App config: update ──────────────────────────────────────────────────────

test("PUT /admin/config/:key — updates the value", async () => {
  const app = await getApp();
  await app.request("/admin/config", {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({ key: "search.limit", value: "10", description: "search limit" }),
  });
  const res = await app.request("/admin/config/search.limit", {
    method: "PUT",
    headers: HEADERS,
    body: JSON.stringify({ value: "50" }),
  });
  assert.equal(res.status, 200);
  const { entry } = await res.json();
  assert.equal(entry.value, "50");
  assert.equal(entry.description, "search limit", "unchanged fields preserved");
});

test("PUT /admin/config/:key — 404 for unknown key", async () => {
  const app = await getApp();
  const res = await app.request("/admin/config/missing", {
    method: "PUT",
    headers: HEADERS,
    body: JSON.stringify({ value: "x" }),
  });
  assert.equal(res.status, 404);
});

// ─── App config: delete ──────────────────────────────────────────────────────

test("DELETE /admin/config/:key — deletes the entry", async () => {
  const app = await getApp();
  await app.request("/admin/config", {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({ key: "remove.me", value: "gone", description: "to delete" }),
  });
  const delRes = await app.request("/admin/config/remove.me", {
    method: "DELETE",
    headers: adminHeader,
  });
  assert.equal(delRes.status, 204);

  const getRes = await app.request("/admin/config/remove.me", { headers: adminHeader });
  assert.equal(getRes.status, 404);
});

test("DELETE /admin/config/:key — 404 for unknown key", async () => {
  const app = await getApp();
  const res = await app.request("/admin/config/ghost.config", {
    method: "DELETE",
    headers: adminHeader,
  });
  assert.equal(res.status, 404);
});

// ─── No price fields in config values ────────────────────────────────────────

test("POST /admin/config — config value is opaque string; no price field restriction applies", async () => {
  // Config values are strings; a value like "120" does not imply a price
  const app = await getApp();
  const res = await app.request("/admin/config", {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({ key: "billing.threshold", value: "120", description: "billing threshold in account units" }),
  });
  // This is fine — the value is a plain string, not a price field
  assert.equal(res.status, 201);
});
