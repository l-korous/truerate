import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { RateLimiter } from "../src/rate-limiter.js";

describe("RateLimiter", () => {
  test("allows requests under the limit", () => {
    const limiter = new RateLimiter({ windowMs: 60_000, max: 3 });
    assert.equal(limiter.check("key1").allowed, true);
    assert.equal(limiter.check("key1").allowed, true);
    assert.equal(limiter.check("key1").allowed, true);
  });

  test("blocks the request that exceeds the limit", () => {
    const limiter = new RateLimiter({ windowMs: 60_000, max: 2 });
    limiter.check("k");
    limiter.check("k");
    const r = limiter.check("k");
    assert.equal(r.allowed, false);
    assert.equal(r.remaining, 0);
  });

  test("remaining decrements correctly", () => {
    const limiter = new RateLimiter({ windowMs: 60_000, max: 5 });
    const r1 = limiter.check("r");
    assert.equal(r1.remaining, 4);
    const r2 = limiter.check("r");
    assert.equal(r2.remaining, 3);
  });

  test("different keys are independent", () => {
    const limiter = new RateLimiter({ windowMs: 60_000, max: 1 });
    limiter.check("a");
    assert.equal(limiter.check("a").allowed, false);
    assert.equal(limiter.check("b").allowed, true);
  });

  test("reset clears key state", () => {
    const limiter = new RateLimiter({ windowMs: 60_000, max: 1 });
    limiter.check("x");
    assert.equal(limiter.check("x").allowed, false);
    limiter.reset("x");
    assert.equal(limiter.check("x").allowed, true);
  });

  test("expired entries are pruned and allow new requests", async () => {
    const limiter = new RateLimiter({ windowMs: 50, max: 1 });
    limiter.check("exp");
    // still blocked immediately
    assert.equal(limiter.check("exp").allowed, false);
    // after the window passes, old entry is gone
    await new Promise((r) => setTimeout(r, 60));
    assert.equal(limiter.check("exp").allowed, true);
  });

  test("resetMs is set to first-entry expiry", () => {
    const limiter = new RateLimiter({ windowMs: 60_000, max: 3 });
    const before = Date.now();
    limiter.check("ts");
    const r = limiter.check("ts");
    assert.ok(r.resetMs > before, "resetMs must be in the future");
    assert.ok(r.resetMs <= before + 60_000 + 5, "resetMs within window");
  });
});
