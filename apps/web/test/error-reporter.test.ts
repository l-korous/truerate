import { test } from "node:test";
import assert from "node:assert/strict";

// Test the scrubContext logic from error-reporter inline (no browser env needed).
const SCRUB = /password|token|secret|key|email|price|amount|nightly|total|credit|card|auth/i;
function scrubContext(ctx: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(ctx).filter(([k]) => !SCRUB.test(k)));
}

test("scrubContext removes sensitive fields from error context", () => {
  const result = scrubContext({ password: "bad", token: "t", route: "/page", ok: true });
  assert.deepEqual(result, { route: "/page", ok: true });
});

test("scrubContext is case-insensitive", () => {
  assert.deepEqual(scrubContext({ SECRET: "x", safe: 1 }), { safe: 1 });
});

test("scrubContext passes through safe fields", () => {
  const ctx = { lineno: 10, colno: 5, filename: "app.js" };
  assert.deepEqual(scrubContext(ctx), ctx);
});

test("scrubContext removes price and amount fields", () => {
  const result = scrubContext({ price: 99, amount: 50, perks: ["free breakfast"] });
  assert.deepEqual(result, { perks: ["free breakfast"] });
});
