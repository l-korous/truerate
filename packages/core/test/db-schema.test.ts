import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeUser } from "../src/db.js";
import { USER_SCHEMA_VERSION } from "../src/types.js";
import type { User } from "../src/types.js";

// Minimal valid User fixture — only the required fields.
function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: "u1",
    email: "test@example.com",
    passwordHash: "hash",
    memberships: [],
    createdAt: "2026-01-01T00:00:00Z",
    market: "CZ",
    currency: "CZK",
    ...overrides,
  };
}

test("normalizeUser stamps schemaVersion on a legacy doc (no schemaVersion field)", () => {
  const raw = makeUser(); // no schemaVersion
  const out = normalizeUser(raw);
  assert.equal(out.schemaVersion, USER_SCHEMA_VERSION);
});

test("normalizeUser stamps schemaVersion on a doc at an older version", () => {
  // Simulate a doc written by a previous revision at version 1 (current is 1,
  // so this is a no-op migration — but the path is exercised).
  const raw = makeUser({ schemaVersion: 1 });
  const out = normalizeUser(raw);
  assert.equal(out.schemaVersion, USER_SCHEMA_VERSION);
});

test("normalizeUser preserves all existing User fields", () => {
  const raw = makeUser({
    id: "u-abc",
    email: "user@example.com",
    market: "DE",
    currency: "EUR",
    activationMilestones: { signup: "2026-01-01T00:00:00Z" },
  });
  const out = normalizeUser(raw);
  assert.equal(out.id, "u-abc");
  assert.equal(out.email, "user@example.com");
  assert.equal(out.market, "DE");
  assert.equal(out.currency, "EUR");
  assert.deepEqual(out.activationMilestones, { signup: "2026-01-01T00:00:00Z" });
});

test("normalizeUser does not mutate the input document", () => {
  const raw = makeUser();
  const before = JSON.stringify(raw);
  normalizeUser(raw);
  assert.equal(JSON.stringify(raw), before);
});

test("normalizeUser handles missing activationMilestones (legacy doc)", () => {
  const raw = makeUser(); // activationMilestones absent
  const out = normalizeUser(raw);
  // The field should remain undefined — callers treat absence as all-unset.
  assert.equal(out.activationMilestones, undefined);
});

test("USER_SCHEMA_VERSION is a positive integer", () => {
  assert.equal(typeof USER_SCHEMA_VERSION, "number");
  assert.ok(USER_SCHEMA_VERSION >= 1);
  assert.equal(USER_SCHEMA_VERSION, Math.floor(USER_SCHEMA_VERSION));
});
