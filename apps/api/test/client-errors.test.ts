import { test, before } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { scrubContext } from "../src/app.js";

before(() => {
  process.env.TRUERATE_INMEMORY = "true";
  process.env.TRUERATE_JWT_SECRET = "test-secret-please-ignore";
  process.env.TRUERATE_CRED_KEY = randomBytes(32).toString("base64");
});

async function getApp() {
  const { app } = await import("../src/app.js");
  return app;
}

// --- scrubContext unit tests -------------------------------------------------

test("scrubContext removes password fields", () => {
  const result = scrubContext({ password: "secret", foo: "bar" });
  assert.deepEqual(result, { foo: "bar" });
});

test("scrubContext removes token fields", () => {
  const result = scrubContext({ token: "abc", authToken: "xyz", ok: true });
  assert.deepEqual(result, { ok: true });
});

test("scrubContext removes price-related fields", () => {
  const result = scrubContext({ price: 100, nightly: 50, totalAmount: 200, label: "Genius" });
  assert.deepEqual(result, { label: "Genius" });
});

test("scrubContext is case-insensitive for field names", () => {
  const result = scrubContext({ Password: "x", TOKEN: "y", safe: "z" });
  assert.deepEqual(result, { safe: "z" });
});

test("scrubContext passes through unrelated fields", () => {
  const ctx = { source: "web", route: "/hotel/paris", lineno: 42 };
  assert.deepEqual(scrubContext(ctx), ctx);
});

// --- POST /client-errors endpoint tests -------------------------------------

test("POST /client-errors accepts a valid web error payload and returns 204", async () => {
  const app = await getApp();
  const res = await app.request("/client-errors", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      source: "web",
      message: "TypeError: Cannot read properties of undefined",
      stack: "TypeError: ...\n  at foo.js:10",
      url: "https://example.com/page",
    }),
  });
  assert.equal(res.status, 204);
});

test("POST /client-errors accepts extension-background source", async () => {
  const app = await getApp();
  const res = await app.request("/client-errors", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source: "extension-background", message: "SW crashed" }),
  });
  assert.equal(res.status, 204);
});

test("POST /client-errors accepts extension-content and extension-popup sources", async () => {
  const app = await getApp();
  for (const source of ["extension-content", "extension-popup"]) {
    const res = await app.request("/client-errors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source, message: "click handler threw" }),
    });
    assert.equal(res.status, 204, `expected 204 for source=${source}`);
  }
});

test("POST /client-errors returns 400 for missing message", async () => {
  const app = await getApp();
  const res = await app.request("/client-errors", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source: "web" }),
  });
  assert.equal(res.status, 400);
});

test("POST /client-errors returns 400 for unknown source", async () => {
  const app = await getApp();
  const res = await app.request("/client-errors", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source: "native-app", message: "bad source" }),
  });
  assert.equal(res.status, 400);
});

test("POST /client-errors strips context fields matching SCRUB_PATTERN", async () => {
  const lines: string[] = [];
  const origErr = process.stderr.write.bind(process.stderr);
  (process.stderr as any).write = (chunk: string) => { lines.push(chunk); return true; };
  try {
    const app = await getApp();
    await app.request("/client-errors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source: "web",
        message: "err",
        context: { password: "s3cr3t", route: "/page" },
      }),
    });
    const logged = lines.map((l) => { try { return JSON.parse(l); } catch { return null; } }).find(Boolean);
    assert.ok(logged, "something logged to stderr");
    const ctx = logged.clientContext as Record<string, unknown>;
    assert.equal(ctx.password, undefined, "password must not appear in log");
    assert.equal(ctx.route, "/page", "non-sensitive field preserved");
  } finally {
    (process.stderr as any).write = origErr;
  }
});

test("POST /client-errors truncates oversized message and stack", async () => {
  const lines: string[] = [];
  const origErr = process.stderr.write.bind(process.stderr);
  (process.stderr as any).write = (chunk: string) => { lines.push(chunk); return true; };
  try {
    const app = await getApp();
    await app.request("/client-errors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source: "web",
        message: "x".repeat(1000),
        stack: "s".repeat(5000),
      }),
    });
    const logged = lines.map((l) => { try { return JSON.parse(l); } catch { return null; } }).find(Boolean);
    assert.ok(logged.clientMessage.length <= 500, "message truncated");
    assert.ok(logged.clientStack.length <= 2000, "stack truncated");
  } finally {
    (process.stderr as any).write = origErr;
  }
});
