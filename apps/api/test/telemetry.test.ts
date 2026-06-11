/**
 * Smoke tests: verify that telemetry wiring compiles and behaves correctly
 * when no connection string is configured (the common CI/test environment).
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

before(() => {
  process.env.TRUERATE_INMEMORY = "true";
  process.env.TRUERATE_JWT_SECRET = "test-secret-please-ignore";
  process.env.TRUERATE_CRED_KEY = randomBytes(32).toString("base64");
  // Ensure telemetry is disabled in tests — no APPLICATIONINSIGHTS_CONNECTION_STRING.
  delete process.env.APPLICATIONINSIGHTS_CONNECTION_STRING;
});

after(async () => {
  const { _resetTelemetry } = await import("@truerate/core");
  _resetTelemetry();
});

test("app starts without telemetry when no connection string is set", async () => {
  // Importing app.ts triggers the telemetry call in index.ts indirectly;
  // here we just verify app.ts can be imported and the /health route works.
  const { app } = await import("../src/app.js");
  const res = await app.request("/health");
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok("ok" in body || "mode" in body, "health returns expected fields");
});

test("telemetry import does not throw in test environment", async () => {
  const { setupTelemetry, _resetTelemetry } = await import("@truerate/core");
  _resetTelemetry();
  assert.doesNotThrow(() => setupTelemetry("truerate-api"));
  _resetTelemetry();
});
