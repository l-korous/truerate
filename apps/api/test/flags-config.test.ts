// Feature flags and app config tests for issue #78.
//
// Covers:
//   - GET /flags — public read, no auth
//   - GET /config — public read, no auth
//   - Admin CRUD for /admin/flags (auth guard, create, toggle, delete, audit)
//   - Admin CRUD for /admin/config (auth guard, create, update, delete, audit)
//   - Key validation (rejects uppercase, spaces)
//   - Conflict detection (duplicate key)
//   - Audit entries created on all state changes

import { test, before, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

const ADMIN_SECRET = "test-admin-secret-flags-78";

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
  const { resetAppFlags, resetAppConfig, resetAppAudit } = await import("../src/app.js");
  const { resetFeatureFlagRepo, resetAppConfigRepo, resetAuditRepo } = await import("@truerate/core");
  const { apiLimiter } = await import("../src/rate-limit.js");
  resetAppFlags();
  resetAppConfig();
  resetAppAudit();
  resetFeatureFlagRepo();
  resetAppConfigRepo();
  resetAuditRepo();
  apiLimiter.reset("ip:unknown");
});

const adminHeader = { "x-admin-secret": ADMIN_SECRET };
const actorHeader = { "x-admin-secret": ADMIN_SECRET, "x-admin-actor": "tester@truerate.io" };
const JSON_CT = { "Content-Type": "application/json" };

const sampleFlag = {
  key: "mcp.hints.enabled",
  label: "MCP hints",
  enabled: false,
  description: "Show contextual hints in MCP responses",
  environment: "all",
};

const sampleConfig = {
  key: "catalog.staleness.warn_months",
  label: "Catalog staleness warning threshold",
  value: "6",
  description: "Months after which a catalog entry is considered stale",
};

// ─── Public endpoints ─────────────────────────────────────────────────────────

describe("Public endpoints", () => {
  test("GET /flags — 200 with empty list initially", async () => {
    const app = await getApp();
    const res = await app.request("/flags");
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.flags));
    assert.equal(body.count, 0);
  });

  test("GET /config — 200 with empty list initially", async () => {
    const app = await getApp();
    const res = await app.request("/config");
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.config));
    assert.equal(body.count, 0);
  });

  test("GET /flags — returns flag after admin creates it", async () => {
    const app = await getApp();
    await app.request("/admin/flags", {
      method: "POST",
      headers: { ...adminHeader, ...JSON_CT },
      body: JSON.stringify(sampleFlag),
    });
    const res = await app.request("/flags");
    const body = await res.json();
    assert.equal(body.count, 1);
    assert.equal(body.flags[0].key, sampleFlag.key);
  });

  test("GET /config — returns entry after admin creates it", async () => {
    const app = await getApp();
    await app.request("/admin/config", {
      method: "POST",
      headers: { ...adminHeader, ...JSON_CT },
      body: JSON.stringify(sampleConfig),
    });
    const res = await app.request("/config");
    const body = await res.json();
    assert.equal(body.count, 1);
    assert.equal(body.config[0].key, sampleConfig.key);
  });
});

// ─── Feature flag admin: auth guard ──────────────────────────────────────────

describe("Feature flags: auth guard", () => {
  test("GET /admin/flags — 401 without secret", async () => {
    const app = await getApp();
    const res = await app.request("/admin/flags");
    assert.equal(res.status, 401);
  });

  test("POST /admin/flags — 401 without secret", async () => {
    const app = await getApp();
    const res = await app.request("/admin/flags", {
      method: "POST",
      headers: JSON_CT,
      body: JSON.stringify(sampleFlag),
    });
    assert.equal(res.status, 401);
  });

  test("PUT /admin/flags/:key — 401 without secret", async () => {
    const app = await getApp();
    const res = await app.request(`/admin/flags/${sampleFlag.key}`, {
      method: "PUT",
      headers: JSON_CT,
      body: JSON.stringify(sampleFlag),
    });
    assert.equal(res.status, 401);
  });

  test("DELETE /admin/flags/:key — 401 without secret", async () => {
    const app = await getApp();
    const res = await app.request(`/admin/flags/${sampleFlag.key}`, { method: "DELETE" });
    assert.equal(res.status, 401);
  });
});

// ─── Feature flag CRUD ────────────────────────────────────────────────────────

describe("Feature flags: CRUD", () => {
  test("GET /admin/flags — 200 with empty list", async () => {
    const app = await getApp();
    const res = await app.request("/admin/flags", { headers: adminHeader });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.flags));
    assert.equal(body.count, 0);
  });

  test("POST /admin/flags — creates a flag", async () => {
    const app = await getApp();
    const res = await app.request("/admin/flags", {
      method: "POST",
      headers: { ...adminHeader, ...JSON_CT },
      body: JSON.stringify(sampleFlag),
    });
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.flag.key, sampleFlag.key);
    assert.equal(body.flag.enabled, false);
    assert.equal(typeof body.flag.updatedAt, "string");
  });

  test("POST /admin/flags — 409 if key already exists", async () => {
    const app = await getApp();
    await app.request("/admin/flags", {
      method: "POST",
      headers: { ...adminHeader, ...JSON_CT },
      body: JSON.stringify(sampleFlag),
    });
    const res = await app.request("/admin/flags", {
      method: "POST",
      headers: { ...adminHeader, ...JSON_CT },
      body: JSON.stringify(sampleFlag),
    });
    assert.equal(res.status, 409);
    const body = await res.json();
    assert.equal(body.error, "conflict");
  });

  test("POST /admin/flags — 400 for invalid key format", async () => {
    const app = await getApp();
    const res = await app.request("/admin/flags", {
      method: "POST",
      headers: { ...adminHeader, ...JSON_CT },
      body: JSON.stringify({ ...sampleFlag, key: "UPPER_CASE.Key" }),
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error, "validation_failed");
  });

  test("GET /admin/flags/:key — 200 returns flag", async () => {
    const app = await getApp();
    await app.request("/admin/flags", {
      method: "POST",
      headers: { ...adminHeader, ...JSON_CT },
      body: JSON.stringify(sampleFlag),
    });
    const res = await app.request(`/admin/flags/${sampleFlag.key}`, { headers: adminHeader });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.flag.key, sampleFlag.key);
  });

  test("GET /admin/flags/:key — 404 for missing flag", async () => {
    const app = await getApp();
    const res = await app.request("/admin/flags/not.a.flag", { headers: adminHeader });
    assert.equal(res.status, 404);
  });

  test("PUT /admin/flags/:key — toggles enabled state and returns updated flag", async () => {
    const app = await getApp();
    await app.request("/admin/flags", {
      method: "POST",
      headers: { ...adminHeader, ...JSON_CT },
      body: JSON.stringify(sampleFlag),
    });
    const res = await app.request(`/admin/flags/${sampleFlag.key}`, {
      method: "PUT",
      headers: { ...adminHeader, ...JSON_CT },
      body: JSON.stringify({ ...sampleFlag, enabled: true }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.flag.enabled, true);
  });

  test("PUT /admin/flags/:key — 400 if key in body mismatches URL", async () => {
    const app = await getApp();
    await app.request("/admin/flags", {
      method: "POST",
      headers: { ...adminHeader, ...JSON_CT },
      body: JSON.stringify(sampleFlag),
    });
    const res = await app.request(`/admin/flags/${sampleFlag.key}`, {
      method: "PUT",
      headers: { ...adminHeader, ...JSON_CT },
      body: JSON.stringify({ ...sampleFlag, key: "different.key" }),
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error, "validation_failed");
  });

  test("PUT /admin/flags/:key — 404 for missing flag", async () => {
    const app = await getApp();
    const res = await app.request("/admin/flags/no.such.flag", {
      method: "PUT",
      headers: { ...adminHeader, ...JSON_CT },
      body: JSON.stringify({ ...sampleFlag, key: "no.such.flag" }),
    });
    assert.equal(res.status, 404);
  });

  test("DELETE /admin/flags/:key — 204 removes flag", async () => {
    const app = await getApp();
    await app.request("/admin/flags", {
      method: "POST",
      headers: { ...adminHeader, ...JSON_CT },
      body: JSON.stringify(sampleFlag),
    });
    const del = await app.request(`/admin/flags/${sampleFlag.key}`, {
      method: "DELETE",
      headers: adminHeader,
    });
    assert.equal(del.status, 204);

    const get = await app.request(`/admin/flags/${sampleFlag.key}`, { headers: adminHeader });
    assert.equal(get.status, 404);
  });

  test("DELETE /admin/flags/:key — 404 if flag does not exist", async () => {
    const app = await getApp();
    const res = await app.request("/admin/flags/no.such.flag", {
      method: "DELETE",
      headers: adminHeader,
    });
    assert.equal(res.status, 404);
  });
});

// ─── Feature flag audit ───────────────────────────────────────────────────────

describe("Feature flags: audit", () => {
  test("create records admin.flag.create audit entry", async () => {
    const app = await getApp();
    await app.request("/admin/flags", {
      method: "POST",
      headers: { ...actorHeader, ...JSON_CT },
      body: JSON.stringify(sampleFlag),
    });
    const audit = await app.request("/admin/audit?targetType=flag", { headers: adminHeader });
    const body = await audit.json();
    assert.ok(body.entries.length >= 1);
    const entry = body.entries.find((e: { action: string }) => e.action === "admin.flag.create");
    assert.ok(entry, "audit entry for create not found");
    assert.equal(entry.actor, "tester@truerate.io");
    assert.equal(entry.targetId, sampleFlag.key);
  });

  test("update records admin.flag.update with before/after", async () => {
    const app = await getApp();
    await app.request("/admin/flags", {
      method: "POST",
      headers: { ...actorHeader, ...JSON_CT },
      body: JSON.stringify(sampleFlag),
    });
    await app.request(`/admin/flags/${sampleFlag.key}`, {
      method: "PUT",
      headers: { ...actorHeader, ...JSON_CT },
      body: JSON.stringify({ ...sampleFlag, enabled: true }),
    });
    const audit = await app.request(`/admin/audit?targetId=${sampleFlag.key}`, { headers: adminHeader });
    const body = await audit.json();
    const updateEntry = body.entries.find((e: { action: string }) => e.action === "admin.flag.update");
    assert.ok(updateEntry, "audit entry for update not found");
    assert.equal(updateEntry.before.enabled, false);
    assert.equal(updateEntry.after.enabled, true);
  });

  test("delete records admin.flag.delete with before state", async () => {
    const app = await getApp();
    await app.request("/admin/flags", {
      method: "POST",
      headers: { ...actorHeader, ...JSON_CT },
      body: JSON.stringify(sampleFlag),
    });
    await app.request(`/admin/flags/${sampleFlag.key}`, {
      method: "DELETE",
      headers: actorHeader,
    });
    const audit = await app.request(`/admin/audit?targetId=${sampleFlag.key}`, { headers: adminHeader });
    const body = await audit.json();
    const deleteEntry = body.entries.find((e: { action: string }) => e.action === "admin.flag.delete");
    assert.ok(deleteEntry, "audit entry for delete not found");
    assert.equal(deleteEntry.before.key, sampleFlag.key);
  });
});

// ─── App config admin: auth guard ────────────────────────────────────────────

describe("App config: auth guard", () => {
  test("GET /admin/config — 401 without secret", async () => {
    const app = await getApp();
    const res = await app.request("/admin/config");
    assert.equal(res.status, 401);
  });

  test("POST /admin/config — 401 without secret", async () => {
    const app = await getApp();
    const res = await app.request("/admin/config", {
      method: "POST",
      headers: JSON_CT,
      body: JSON.stringify(sampleConfig),
    });
    assert.equal(res.status, 401);
  });
});

// ─── App config CRUD ──────────────────────────────────────────────────────────

describe("App config: CRUD", () => {
  test("GET /admin/config — 200 with empty list", async () => {
    const app = await getApp();
    const res = await app.request("/admin/config", { headers: adminHeader });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.config));
    assert.equal(body.count, 0);
  });

  test("POST /admin/config — creates a config entry", async () => {
    const app = await getApp();
    const res = await app.request("/admin/config", {
      method: "POST",
      headers: { ...adminHeader, ...JSON_CT },
      body: JSON.stringify(sampleConfig),
    });
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.config.key, sampleConfig.key);
    assert.equal(body.config.value, sampleConfig.value);
  });

  test("POST /admin/config — 409 if key already exists", async () => {
    const app = await getApp();
    await app.request("/admin/config", {
      method: "POST",
      headers: { ...adminHeader, ...JSON_CT },
      body: JSON.stringify(sampleConfig),
    });
    const res = await app.request("/admin/config", {
      method: "POST",
      headers: { ...adminHeader, ...JSON_CT },
      body: JSON.stringify(sampleConfig),
    });
    assert.equal(res.status, 409);
  });

  test("POST /admin/config — 400 for invalid key format", async () => {
    const app = await getApp();
    const res = await app.request("/admin/config", {
      method: "POST",
      headers: { ...adminHeader, ...JSON_CT },
      body: JSON.stringify({ ...sampleConfig, key: "Invalid Key!" }),
    });
    assert.equal(res.status, 400);
  });

  test("GET /admin/config/:key — returns config entry", async () => {
    const app = await getApp();
    await app.request("/admin/config", {
      method: "POST",
      headers: { ...adminHeader, ...JSON_CT },
      body: JSON.stringify(sampleConfig),
    });
    const res = await app.request(`/admin/config/${sampleConfig.key}`, { headers: adminHeader });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.config.key, sampleConfig.key);
    assert.equal(body.config.value, sampleConfig.value);
  });

  test("GET /admin/config/:key — 404 for missing key", async () => {
    const app = await getApp();
    const res = await app.request("/admin/config/no.such.key", { headers: adminHeader });
    assert.equal(res.status, 404);
  });

  test("PUT /admin/config/:key — updates value", async () => {
    const app = await getApp();
    await app.request("/admin/config", {
      method: "POST",
      headers: { ...adminHeader, ...JSON_CT },
      body: JSON.stringify(sampleConfig),
    });
    const res = await app.request(`/admin/config/${sampleConfig.key}`, {
      method: "PUT",
      headers: { ...adminHeader, ...JSON_CT },
      body: JSON.stringify({ ...sampleConfig, value: "12" }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.config.value, "12");
  });

  test("PUT /admin/config/:key — 400 if key in body mismatches URL", async () => {
    const app = await getApp();
    await app.request("/admin/config", {
      method: "POST",
      headers: { ...adminHeader, ...JSON_CT },
      body: JSON.stringify(sampleConfig),
    });
    const res = await app.request(`/admin/config/${sampleConfig.key}`, {
      method: "PUT",
      headers: { ...adminHeader, ...JSON_CT },
      body: JSON.stringify({ ...sampleConfig, key: "different.key" }),
    });
    assert.equal(res.status, 400);
  });

  test("PUT /admin/config/:key — 404 for missing key", async () => {
    const app = await getApp();
    const res = await app.request("/admin/config/no.such.key", {
      method: "PUT",
      headers: { ...adminHeader, ...JSON_CT },
      body: JSON.stringify({ ...sampleConfig, key: "no.such.key" }),
    });
    assert.equal(res.status, 404);
  });

  test("DELETE /admin/config/:key — 204 removes entry", async () => {
    const app = await getApp();
    await app.request("/admin/config", {
      method: "POST",
      headers: { ...adminHeader, ...JSON_CT },
      body: JSON.stringify(sampleConfig),
    });
    const del = await app.request(`/admin/config/${sampleConfig.key}`, {
      method: "DELETE",
      headers: adminHeader,
    });
    assert.equal(del.status, 204);

    const get = await app.request(`/admin/config/${sampleConfig.key}`, { headers: adminHeader });
    assert.equal(get.status, 404);
  });

  test("DELETE /admin/config/:key — 404 if entry does not exist", async () => {
    const app = await getApp();
    const res = await app.request("/admin/config/no.such.key", {
      method: "DELETE",
      headers: adminHeader,
    });
    assert.equal(res.status, 404);
  });
});

// ─── App config audit ─────────────────────────────────────────────────────────

describe("App config: audit", () => {
  test("create records admin.config.create audit entry", async () => {
    const app = await getApp();
    await app.request("/admin/config", {
      method: "POST",
      headers: { ...actorHeader, ...JSON_CT },
      body: JSON.stringify(sampleConfig),
    });
    const audit = await app.request("/admin/audit?targetType=config", { headers: adminHeader });
    const body = await audit.json();
    const entry = body.entries.find((e: { action: string }) => e.action === "admin.config.create");
    assert.ok(entry, "audit entry for create not found");
    assert.equal(entry.actor, "tester@truerate.io");
    assert.equal(entry.targetId, sampleConfig.key);
  });

  test("update records admin.config.update with before/after values", async () => {
    const app = await getApp();
    await app.request("/admin/config", {
      method: "POST",
      headers: { ...actorHeader, ...JSON_CT },
      body: JSON.stringify(sampleConfig),
    });
    await app.request(`/admin/config/${sampleConfig.key}`, {
      method: "PUT",
      headers: { ...actorHeader, ...JSON_CT },
      body: JSON.stringify({ ...sampleConfig, value: "12" }),
    });
    const audit = await app.request(`/admin/audit?targetId=${sampleConfig.key}`, { headers: adminHeader });
    const body = await audit.json();
    const updateEntry = body.entries.find((e: { action: string }) => e.action === "admin.config.update");
    assert.ok(updateEntry, "audit entry for update not found");
    assert.equal(updateEntry.before.value, "6");
    assert.equal(updateEntry.after.value, "12");
  });

  test("delete records admin.config.delete with before state", async () => {
    const app = await getApp();
    await app.request("/admin/config", {
      method: "POST",
      headers: { ...actorHeader, ...JSON_CT },
      body: JSON.stringify(sampleConfig),
    });
    await app.request(`/admin/config/${sampleConfig.key}`, {
      method: "DELETE",
      headers: actorHeader,
    });
    const audit = await app.request(`/admin/audit?targetId=${sampleConfig.key}`, { headers: adminHeader });
    const body = await audit.json();
    const deleteEntry = body.entries.find((e: { action: string }) => e.action === "admin.config.delete");
    assert.ok(deleteEntry, "audit entry for delete not found");
    assert.equal(deleteEntry.before.key, sampleConfig.key);
  });
});
