import { test } from "node:test";
import assert from "node:assert/strict";
import { getUserRepo, resetUserRepo } from "../src/db.js";

// Regression guard for #307: getUserRepo() used to assign the singleton BEFORE
// `await init()` resolved, so a concurrent caller (e.g. an MCP client's burst of
// cold-start handshake requests) received a not-yet-initialized repo and
// getByMcpTokenHash threw "Cannot read properties of undefined (reading 'items')",
// crash-looping the MCP container. The fix caches the in-flight PROMISE.

// In-memory backend for tests (no real Cosmos).
process.env.TRUERATE_INMEMORY = "true";

test("getUserRepo: concurrent callers share one in-flight init promise", async () => {
  resetUserRepo();
  const p1 = getUserRepo();
  const p2 = getUserRepo();
  const p3 = getUserRepo();
  // Same cached promise object — never a second, half-initialized init.
  assert.strictEqual(p1, p2);
  assert.strictEqual(p2, p3);
  const [r1, r2, r3] = await Promise.all([p1, p2, p3]);
  assert.strictEqual(r1, r2);
  assert.strictEqual(r2, r3);
  resetUserRepo();
});

test("getUserRepo: the resolved repo is fully initialized (no undefined container)", async () => {
  resetUserRepo();
  // Concurrently resolve and immediately query — this is exactly the cold-start
  // pattern that used to throw before init completed.
  const results = await Promise.all(
    Array.from({ length: 5 }, async () => {
      const repo = await getUserRepo();
      return repo.getByMcpTokenHash("does-not-exist");
    }),
  );
  // Every call returns cleanly (null for an unknown token), none throw.
  for (const r of results) assert.equal(r, null);
  resetUserRepo();
});
