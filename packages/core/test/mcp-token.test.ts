import { test, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { generateMcpToken, hashMcpToken, mcpUrlForToken } from "../src/mcp-token.js";
import { getUserRepo } from "../src/db.js";
import type { User } from "../src/types.js";

before(() => {
  process.env.TRUERATE_INMEMORY = "true";
});

test("generateMcpToken is URL-safe and high-entropy", () => {
  const a = generateMcpToken();
  const b = generateMcpToken();
  assert.match(a, /^[A-Za-z0-9_-]+$/, "token is base64url (path-safe)");
  assert.ok(a.length >= 42, "token encodes >= 32 bytes of entropy");
  assert.notEqual(a, b, "tokens are unique");
});

test("hashMcpToken is deterministic, hex, and hides the token", () => {
  const token = generateMcpToken();
  const h1 = hashMcpToken(token);
  assert.equal(h1, hashMcpToken(token), "deterministic");
  assert.match(h1, /^[0-9a-f]{64}$/, "sha-256 hex");
  assert.notEqual(h1, token, "hash differs from the token");
  assert.notEqual(hashMcpToken(generateMcpToken()), h1, "different tokens hash differently");
});

test("mcpUrlForToken builds the path form and trims trailing slashes", () => {
  assert.equal(mcpUrlForToken("https://mcp.example", "TOK"), "https://mcp.example/u/TOK/mcp");
  assert.equal(mcpUrlForToken("https://mcp.example/", "TOK"), "https://mcp.example/u/TOK/mcp");
  assert.equal(mcpUrlForToken("https://mcp.example///", "TOK"), "https://mcp.example/u/TOK/mcp");
});

function makeUser(over: Partial<User> = {}): User {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    email: `${randomUUID()}@example.com`,
    passwordHash: "x",
    memberships: [],
    createdAt: now,
    market: "cz",
    currency: "EUR",
    ...over,
  };
}

test("getByMcpTokenHash finds the matching user and only that user", async () => {
  const repo = await getUserRepo();
  const token = generateMcpToken();
  const hash = hashMcpToken(token);
  const user = makeUser({ mcpToken: { hash, createdAt: new Date().toISOString() } });
  await repo.create(user);
  await repo.create(makeUser()); // a tokenless user must never match

  const found = await repo.getByMcpTokenHash(hash);
  assert.ok(found, "user found by token hash");
  assert.equal(found.id, user.id);

  assert.equal(
    await repo.getByMcpTokenHash(hashMcpToken(generateMcpToken())),
    null,
    "unknown hash resolves to null",
  );
});
