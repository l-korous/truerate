// Per-user MCP URL (/u/<token>/mcp) against the REAL createRequestListener.
//
// Verifies issue #82: the path token resolves to the right user's vault with no
// auth header; bad/revoked tokens are rejected (401); the legacy bearer /mcp
// path still works; and no price fields leak (product rule #1).

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { sign } from "hono/jwt";
import { getUserRepo, generateMcpToken, hashMcpToken, type User } from "@truerate/core";
import { createRequestListener } from "../src/http.js";

const TEST_SECRET = "truerate-per-user-url-test-secret-32x";

function startServer(): { base: string; close: () => Promise<void> } {
  const server: Server = createServer(createRequestListener());
  server.listen(0);
  const { port } = server.address() as AddressInfo;
  return {
    base: `http://localhost:${port}`,
    close: () => new Promise<void>((res, rej) => server.close((e) => (e ? rej(e) : res()))),
  };
}

function makeUser(label: string, token: string): User {
  const now = new Date().toISOString();
  return {
    id: `peruser-${randomUUID()}`,
    email: `${randomUUID()}@example.com`,
    passwordHash: "x",
    market: "cz",
    currency: "EUR",
    createdAt: now,
    mcpToken: { hash: hashMcpToken(token), createdAt: now },
    memberships: [
      {
        id: randomUUID(),
        label,
        attributes: {},
        benefits: [
          {
            id: randomUUID(),
            scope: "global",
            match: {},
            value: { kind: "perk", perks: ["Free breakfast"] },
            source: "user-declared",
          },
        ],
        addedAt: now,
        status: "active",
      },
    ],
  };
}

async function connect(
  url: string,
  token?: string,
): Promise<{ client: Client; close: () => Promise<void> }> {
  const client = new Client({ name: "per-user-url-test", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(
    new URL(url),
    token ? { requestInit: { headers: { Authorization: `Bearer ${token}` } } } : undefined,
  );
  await client.connect(transport);
  return { client, close: async () => transport.close() };
}

async function summaryText(client: Client): Promise<string> {
  const r = await client.callTool({ name: "get_membership_summary", arguments: {} });
  return JSON.stringify(r);
}

let srv: { base: string; close: () => Promise<void> };
let userA: User;
let userB: User;
const tokenA = generateMcpToken();
const tokenB = generateMcpToken();

before(async () => {
  process.env.TRUERATE_INMEMORY = "true";
  process.env.TRUERATE_JWT_SECRET = TEST_SECRET;
  srv = startServer();
  const repo = await getUserRepo();
  userA = makeUser("Alice Genius", tokenA);
  userB = makeUser("Bob Bonvoy", tokenB);
  await repo.create(userA);
  await repo.create(userB);
});

after(async () => {
  await srv.close();
});

test("/u/<token>/mcp resolves to the token owner's vault", async () => {
  const { client, close } = await connect(`${srv.base}/u/${tokenA}/mcp`);
  const text = await summaryText(client);
  assert.ok(text.includes("Alice Genius"), "Alice's membership is returned");
  assert.ok(!text.includes("Bob Bonvoy"), "no leakage of Bob's data");
  await close();
});

test("per-user URLs are isolated per user", async () => {
  const { client, close } = await connect(`${srv.base}/u/${tokenB}/mcp`);
  const text = await summaryText(client);
  assert.ok(text.includes("Bob Bonvoy"), "Bob's membership is returned");
  assert.ok(!text.includes("Alice Genius"));
  await close();
});

test("an invalid URL token is rejected with 401", async () => {
  const res = await fetch(`${srv.base}/u/deadbeefdeadbeef/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  assert.equal(res.status, 401);
});

test("the legacy bearer /mcp path still works", async () => {
  const jwt = await sign(
    { sub: userA.id, exp: Math.floor(Date.now() / 1000) + 3600 },
    TEST_SECRET,
    "HS256",
  );
  const { client, close } = await connect(`${srv.base}/mcp`, jwt);
  const text = await summaryText(client);
  assert.ok(text.includes("Alice Genius"));
  await close();
});

test("no price fields appear in tool output", async () => {
  const { client, close } = await connect(`${srv.base}/u/${tokenA}/mcp`);
  const text = await summaryText(client);
  for (const f of ["nightlyAmount", "totalAmount", "memberPrice", "finalPrice", "basePrice"]) {
    assert.ok(!text.includes(f), `forbidden price field "${f}" leaked`);
  }
  await close();
});
