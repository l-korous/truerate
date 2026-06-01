import { test } from "node:test";
import assert from "node:assert/strict";
import { createLogger, generateCorrelationId, hashUserId } from "../src/logger.js";

test("createLogger produces JSON on stdout", () => {
  const lines: string[] = [];
  const orig = process.stdout.write.bind(process.stdout);
  (process.stdout as any).write = (chunk: string) => { lines.push(chunk); return true; };
  try {
    createLogger({ service: "test" }).info("hello world");
    assert.equal(lines.length, 1);
    const record = JSON.parse(lines[0]);
    assert.equal(record.msg, "hello world");
    assert.equal(record.level, "info");
    assert.equal(record.service, "test");
    assert.ok(record.timestamp, "timestamp present");
  } finally {
    (process.stdout as any).write = orig;
  }
});

test("child logger merges context", () => {
  const lines: string[] = [];
  const orig = process.stdout.write.bind(process.stdout);
  (process.stdout as any).write = (chunk: string) => { lines.push(chunk); return true; };
  try {
    const parent = createLogger({ correlationId: "c-001" });
    parent.child({ route: "/health" }).info("ping");
    const record = JSON.parse(lines[0]);
    assert.equal(record.correlationId, "c-001");
    assert.equal(record.route, "/health");
  } finally {
    (process.stdout as any).write = orig;
  }
});

test("error level writes to stderr", () => {
  const lines: string[] = [];
  const orig = process.stderr.write.bind(process.stderr);
  (process.stderr as any).write = (chunk: string) => { lines.push(chunk); return true; };
  try {
    createLogger().error("something broke");
    assert.equal(lines.length, 1);
    const record = JSON.parse(lines[0]);
    assert.equal(record.level, "error");
  } finally {
    (process.stderr as any).write = orig;
  }
});

test("hashUserId does not return the original ID", () => {
  const userId = "user-abc-123";
  const hashed = hashUserId(userId);
  assert.notEqual(hashed, userId);
  assert.equal(hashed.length, 12);
  assert.equal(hashUserId(userId), hashed, "deterministic");
});

test("generateCorrelationId returns unique values", () => {
  const a = generateCorrelationId();
  const b = generateCorrelationId();
  assert.notEqual(a, b);
  assert.match(a, /^[0-9a-f-]{36}$/);
});

test("log record contains no nested objects that could hide prices", () => {
  const lines: string[] = [];
  const orig = process.stdout.write.bind(process.stdout);
  (process.stdout as any).write = (chunk: string) => { lines.push(chunk); return true; };
  try {
    createLogger({ correlationId: "c-test", userIdHash: hashUserId("u1") }).info("matched benefits", { benefitCount: 3 });
    const record = JSON.parse(lines[0]);
    const json = JSON.stringify(record);
    // should not contain fields like "price", "amount", "publicOffer"
    assert.ok(!/"price"/.test(json), "no price field");
    assert.ok(!/"publicOffer"/.test(json), "no publicOffer field");
  } finally {
    (process.stdout as any).write = orig;
  }
});
