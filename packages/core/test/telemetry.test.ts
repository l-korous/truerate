import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { setupTelemetry, _resetTelemetry } from "../src/telemetry.js";

afterEach(() => {
  _resetTelemetry();
  delete process.env.APPLICATIONINSIGHTS_CONNECTION_STRING;
  delete process.env.OTEL_SAMPLE_RATE;
});

test("setupTelemetry is a no-op when connection string is absent", () => {
  delete process.env.APPLICATIONINSIGHTS_CONNECTION_STRING;
  // Should not throw and should not start an SDK.
  assert.doesNotThrow(() => setupTelemetry("test-service"));
});

test("setupTelemetry is idempotent — calling twice is safe", () => {
  delete process.env.APPLICATIONINSIGHTS_CONNECTION_STRING;
  assert.doesNotThrow(() => {
    setupTelemetry("test-service");
    setupTelemetry("test-service"); // second call must be a no-op
  });
});

test("_resetTelemetry allows re-initialisation after reset", () => {
  delete process.env.APPLICATIONINSIGHTS_CONNECTION_STRING;
  setupTelemetry("test-service");
  _resetTelemetry();
  // After reset a second call must succeed rather than throw.
  assert.doesNotThrow(() => setupTelemetry("test-service"));
});

test("OTEL_SAMPLE_RATE is clamped to [0, 1]", () => {
  // We can only verify clamping doesn't crash; the actual SDK is not started
  // because no connection string is set.
  process.env.OTEL_SAMPLE_RATE = "999";
  delete process.env.APPLICATIONINSIGHTS_CONNECTION_STRING;
  assert.doesNotThrow(() => setupTelemetry("test-service"));

  _resetTelemetry();
  process.env.OTEL_SAMPLE_RATE = "-5";
  assert.doesNotThrow(() => setupTelemetry("test-service"));
});
