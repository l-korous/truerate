import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { normalizeUser } from "../src/db.js";
import { USER_SCHEMA_VERSION } from "../src/types.js";
import type { User } from "../src/types.js";

// ─── normalizeUser ───────────────────────────────────────────────────────────

function makeRawUser(over: Partial<User> = {}): User {
  return {
    id: randomUUID(),
    email: "test@example.com",
    passwordHash: "x",
    memberships: [],
    createdAt: new Date().toISOString(),
    market: "cz",
    currency: "EUR",
    ...over,
  };
}

test("normalizeUser: v0 document (no schemaVersion) gets schemaVersion stamped", () => {
  const raw = makeRawUser(); // no schemaVersion field
  assert.equal(raw.schemaVersion, undefined, "precondition: raw doc has no schemaVersion");

  const normalized = normalizeUser(raw);
  assert.equal(normalized.schemaVersion, USER_SCHEMA_VERSION);
});

test("normalizeUser: v0 document preserves all existing fields", () => {
  const raw = makeRawUser({
    email: "alice@example.com",
    market: "de",
    currency: "EUR",
    activationMilestones: { signup: "2025-01-01T00:00:00.000Z" },
  });

  const normalized = normalizeUser(raw);
  assert.equal(normalized.id, raw.id);
  assert.equal(normalized.email, raw.email);
  assert.equal(normalized.market, raw.market);
  assert.equal(normalized.currency, raw.currency);
  assert.deepEqual(normalized.activationMilestones, raw.activationMilestones);
});

test("normalizeUser: document at current version is returned unchanged", () => {
  const raw = makeRawUser({ schemaVersion: USER_SCHEMA_VERSION });

  const normalized = normalizeUser(raw);
  assert.strictEqual(normalized, raw, "same object reference — no allocation needed");
});

test("normalizeUser: document at a future version is returned unchanged", () => {
  const raw = makeRawUser({ schemaVersion: USER_SCHEMA_VERSION + 99 });

  const normalized = normalizeUser(raw);
  assert.strictEqual(normalized, raw);
  assert.equal(normalized.schemaVersion, USER_SCHEMA_VERSION + 99);
});

test("normalizeUser: does not mutate the original object", () => {
  const raw = makeRawUser(); // v0, no schemaVersion
  const rawBefore = { ...raw };

  normalizeUser(raw);

  // original is unchanged
  assert.equal(raw.schemaVersion, rawBefore.schemaVersion);
});

test("normalizeUser: v0 → current produces expected schemaVersion value", () => {
  const normalized = normalizeUser(makeRawUser());
  assert.equal(typeof normalized.schemaVersion, "number");
  assert.ok(
    (normalized.schemaVersion as number) >= 1,
    "normalized document has a positive schemaVersion",
  );
});

// ─── USER_SCHEMA_VERSION constant ────────────────────────────────────────────

test("USER_SCHEMA_VERSION is a positive integer", () => {
  assert.equal(typeof USER_SCHEMA_VERSION, "number");
  assert.ok(Number.isInteger(USER_SCHEMA_VERSION));
  assert.ok(USER_SCHEMA_VERSION >= 1);
});
