// Tests CORS behaviour when CORS_EXTENSION_ID is set.  This must run in a
// separate test file so it gets its own module cache and can set env vars
// before app.ts is first imported.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

const TEST_EXT_ID = "abcdefghijklmnopabcdefghijklmnop";

before(() => {
  process.env.TRUERATE_INMEMORY = "true";
  process.env.TRUERATE_JWT_SECRET = "test-secret-please-ignore";
  process.env.TRUERATE_CRED_KEY = randomBytes(32).toString("base64");
  process.env.CORS_ALLOWED_ORIGINS = "https://truerate.app";
  process.env.CORS_EXTENSION_ID = TEST_EXT_ID;
});

async function getApp() {
  const { app } = await import("../src/app.js");
  return app;
}

test("CORS: extension origin is allowed when CORS_EXTENSION_ID is set", async () => {
  const app = await getApp();
  const extOrigin = `chrome-extension://${TEST_EXT_ID}`;
  const res = await app.request("/health", { headers: { Origin: extOrigin } });
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), extOrigin);
});

test("CORS: configured web origin is allowed", async () => {
  const app = await getApp();
  const res = await app.request("/health", { headers: { Origin: "https://truerate.app" } });
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), "https://truerate.app");
});

test("CORS: localhost is not allowed when CORS_ALLOWED_ORIGINS is set explicitly", async () => {
  const app = await getApp();
  // localhost:3000 is only the default; it's not in the explicit list here
  const res = await app.request("/health", { headers: { Origin: "http://localhost:3000" } });
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), null);
});

test("CORS: unknown origin is rejected even when extension is configured", async () => {
  const app = await getApp();
  const res = await app.request("/health", { headers: { Origin: "https://evil.example.com" } });
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), null);
});
