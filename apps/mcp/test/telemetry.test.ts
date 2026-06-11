/**
 * Smoke tests: telemetry wiring for the MCP service behaves correctly
 * when no connection string is configured (the common CI/test environment).
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

before(() => {
  process.env.TRUERATE_INMEMORY = "true";
  process.env.TRUERATE_JWT_SECRET = "test-secret-please-ignore";
  process.env.TRUERATE_CRED_KEY = randomBytes(32).toString("base64");
  delete process.env.APPLICATIONINSIGHTS_CONNECTION_STRING;
});

after(async () => {
  const { _resetTelemetry } = await import("@truerate/core");
  _resetTelemetry();
});

test("telemetry is disabled and does not throw when no connection string", async () => {
  const { setupTelemetry, _resetTelemetry } = await import("@truerate/core");
  _resetTelemetry();
  assert.doesNotThrow(() => setupTelemetry("truerate-mcp"));
  _resetTelemetry();
});

test("MCP server builds without errors when telemetry is off", async () => {
  const { buildServer } = await import("../src/server.js");
  assert.doesNotThrow(() => buildServer("test-user-id", "test-correlation-id"));
});
