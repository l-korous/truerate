import { test } from "node:test";
import assert from "node:assert/strict";

// Inline the scrubContext logic to test it without browser dependencies.
const SCRUB = /password|token|secret|key|email|price|amount|nightly|total|credit|card|auth/i;
function scrubContext(ctx: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(ctx).filter(([k]) => !SCRUB.test(k)));
}

test("extension scrubContext removes token and password", () => {
  assert.deepEqual(scrubContext({ token: "abc", password: "pw", url: "/x" }), { url: "/x" });
});

test("extension scrubContext removes price/amount fields", () => {
  assert.deepEqual(scrubContext({ nightly: 100, totalAmount: 200, source: "web" }), { source: "web" });
});

test("extension scrubContext keeps safe context fields", () => {
  const ctx = { lineno: 5, colno: 10, filename: "content.js" };
  assert.deepEqual(scrubContext(ctx), ctx);
});

test("extension scrubContext is case-insensitive", () => {
  assert.deepEqual(scrubContext({ AUTH: "x", Secret: "y", ok: true }), { ok: true });
});
