import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveApiBase } from "../utils/resolve-api-base.js";

function withEnv(value: string | undefined, fn: () => void): void {
  const original = process.env.API_BASE_URL;
  if (value === undefined) {
    delete process.env.API_BASE_URL;
  } else {
    process.env.API_BASE_URL = value;
  }
  try {
    fn();
  } finally {
    if (original === undefined) delete process.env.API_BASE_URL;
    else process.env.API_BASE_URL = original;
  }
}

test("uses API_BASE_URL when set in development mode", () => {
  withEnv("https://custom.example.com", () => {
    assert.equal(resolveApiBase("development"), "https://custom.example.com");
  });
});

test("uses API_BASE_URL when set in production mode", () => {
  withEnv("https://prod-api.truerate.app", () => {
    assert.equal(resolveApiBase("production"), "https://prod-api.truerate.app");
  });
});

test("falls back to localhost for development mode without env var", () => {
  withEnv(undefined, () => {
    assert.equal(resolveApiBase("development"), "http://localhost:8787");
  });
});

test("falls back to https://api.invalid for production mode without env var", () => {
  withEnv(undefined, () => {
    assert.equal(resolveApiBase("production"), "https://api.invalid");
  });
});

test("prod fallback is not localhost", () => {
  withEnv(undefined, () => {
    const base = resolveApiBase("production");
    assert.ok(!base.includes("localhost"), `prod fallback must not be localhost, got: ${base}`);
  });
});
