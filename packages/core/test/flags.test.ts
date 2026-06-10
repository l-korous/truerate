import { test, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";

beforeEach(() => {
  process.env.TRUERATE_INMEMORY = "true";
});

async function getFlagRepo() {
  const { resetFeatureFlagRepo, getFeatureFlagRepo } = await import("../src/flags.js");
  resetFeatureFlagRepo();
  return getFeatureFlagRepo();
}

async function getConfigRepo() {
  const { resetAppConfigRepo, getAppConfigRepo } = await import("../src/flags.js");
  resetAppConfigRepo();
  return getAppConfigRepo();
}

// ─── FeatureFlagRepo ──────────────────────────────────────────────────────────

describe("FeatureFlagRepo (in-memory)", () => {
  test("list returns empty initially", async () => {
    const repo = await getFlagRepo();
    const flags = await repo.list();
    assert.deepEqual(flags, []);
  });

  test("upsert creates a flag and list returns it", async () => {
    const repo = await getFlagRepo();
    const flag = await repo.upsert({
      key: "test.flag",
      label: "Test flag",
      enabled: false,
      updatedAt: "2026-01-01T00:00:00.000Z",
      updatedBy: "admin",
    });
    assert.equal(flag.key, "test.flag");
    assert.equal(flag.enabled, false);

    const flags = await repo.list();
    assert.equal(flags.length, 1);
    assert.equal(flags[0].key, "test.flag");
  });

  test("get returns null for missing flag", async () => {
    const repo = await getFlagRepo();
    const result = await repo.get("nonexistent");
    assert.equal(result, null);
  });

  test("get returns flag after upsert", async () => {
    const repo = await getFlagRepo();
    await repo.upsert({ key: "my.flag", label: "My flag", enabled: true, updatedAt: "2026-01-01T00:00:00.000Z", updatedBy: "admin" });
    const flag = await repo.get("my.flag");
    assert.ok(flag);
    assert.equal(flag.enabled, true);
  });

  test("upsert updates an existing flag", async () => {
    const repo = await getFlagRepo();
    await repo.upsert({ key: "toggle.me", label: "Toggle me", enabled: false, updatedAt: "2026-01-01T00:00:00.000Z", updatedBy: "admin" });
    await repo.upsert({ key: "toggle.me", label: "Toggle me", enabled: true, updatedAt: "2026-01-02T00:00:00.000Z", updatedBy: "alice" });

    const flag = await repo.get("toggle.me");
    assert.ok(flag);
    assert.equal(flag.enabled, true);
    assert.equal(flag.updatedBy, "alice");
  });

  test("delete removes a flag", async () => {
    const repo = await getFlagRepo();
    await repo.upsert({ key: "to.delete", label: "To delete", enabled: true, updatedAt: "2026-01-01T00:00:00.000Z", updatedBy: "admin" });
    await repo.delete("to.delete");
    const flag = await repo.get("to.delete");
    assert.equal(flag, null);
    const flags = await repo.list();
    assert.equal(flags.length, 0);
  });

  test("delete of nonexistent key does not throw", async () => {
    const repo = await getFlagRepo();
    await assert.doesNotReject(() => repo.delete("does.not.exist"));
  });

  test("list returns flags sorted by key", async () => {
    const repo = await getFlagRepo();
    await repo.upsert({ key: "z.flag", label: "Z", enabled: true, updatedAt: "2026-01-01T00:00:00.000Z", updatedBy: "admin" });
    await repo.upsert({ key: "a.flag", label: "A", enabled: false, updatedAt: "2026-01-01T00:00:00.000Z", updatedBy: "admin" });
    await repo.upsert({ key: "m.flag", label: "M", enabled: true, updatedAt: "2026-01-01T00:00:00.000Z", updatedBy: "admin" });

    const flags = await repo.list();
    assert.deepEqual(flags.map((f) => f.key), ["a.flag", "m.flag", "z.flag"]);
  });
});

// ─── AppConfigRepo ────────────────────────────────────────────────────────────

describe("AppConfigRepo (in-memory)", () => {
  test("list returns empty initially", async () => {
    const repo = await getConfigRepo();
    const config = await repo.list();
    assert.deepEqual(config, []);
  });

  test("upsert creates a config entry and list returns it", async () => {
    const repo = await getConfigRepo();
    const entry = await repo.upsert({
      key: "catalog.staleness.warn_months",
      label: "Catalog staleness warning threshold (months)",
      value: "6",
      updatedAt: "2026-01-01T00:00:00.000Z",
      updatedBy: "admin",
    });
    assert.equal(entry.key, "catalog.staleness.warn_months");
    assert.equal(entry.value, "6");

    const config = await repo.list();
    assert.equal(config.length, 1);
    assert.equal(config[0].key, "catalog.staleness.warn_months");
  });

  test("get returns null for missing key", async () => {
    const repo = await getConfigRepo();
    const result = await repo.get("nonexistent");
    assert.equal(result, null);
  });

  test("get returns entry after upsert", async () => {
    const repo = await getConfigRepo();
    await repo.upsert({ key: "my.config", label: "My config", value: "42", updatedAt: "2026-01-01T00:00:00.000Z", updatedBy: "admin" });
    const entry = await repo.get("my.config");
    assert.ok(entry);
    assert.equal(entry.value, "42");
  });

  test("upsert updates an existing config entry", async () => {
    const repo = await getConfigRepo();
    await repo.upsert({ key: "editable", label: "Editable", value: "old", updatedAt: "2026-01-01T00:00:00.000Z", updatedBy: "admin" });
    await repo.upsert({ key: "editable", label: "Editable", value: "new", updatedAt: "2026-01-02T00:00:00.000Z", updatedBy: "alice" });

    const entry = await repo.get("editable");
    assert.ok(entry);
    assert.equal(entry.value, "new");
    assert.equal(entry.updatedBy, "alice");
  });

  test("delete removes a config entry", async () => {
    const repo = await getConfigRepo();
    await repo.upsert({ key: "to.delete", label: "To delete", value: "x", updatedAt: "2026-01-01T00:00:00.000Z", updatedBy: "admin" });
    await repo.delete("to.delete");
    const entry = await repo.get("to.delete");
    assert.equal(entry, null);
    const config = await repo.list();
    assert.equal(config.length, 0);
  });

  test("list returns entries sorted by key", async () => {
    const repo = await getConfigRepo();
    await repo.upsert({ key: "z.config", label: "Z", value: "z", updatedAt: "2026-01-01T00:00:00.000Z", updatedBy: "admin" });
    await repo.upsert({ key: "a.config", label: "A", value: "a", updatedAt: "2026-01-01T00:00:00.000Z", updatedBy: "admin" });

    const config = await repo.list();
    assert.deepEqual(config.map((c) => c.key), ["a.config", "z.config"]);
  });
});
