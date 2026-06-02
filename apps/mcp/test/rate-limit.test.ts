// Rate-limit integration test for the MCP HTTP layer.
// Spins up the same auth+rate-limit wiring used in index.ts against a
// lightweight test server, using a locally-created RateLimiter so the
// test controls max=3 without relying on env vars at module load time.

import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { sign, verify } from "hono/jwt";
import { getUserRepo, RateLimiter } from "@truerate/core";
import { buildServer as buildMcpServer } from "../src/server.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

const TEST_SECRET = "truerate-rl-test-secret-32chars!!";
const MAX_REQUESTS = 3;

// Local limiter with tight window for fast tests
const testLimiter = new RateLimiter({ windowMs: 60_000, max: MAX_REQUESTS });

async function userIdFromRequest(req: IncomingMessage): Promise<string | null> {
  const header = req.headers["authorization"];
  if (!header || Array.isArray(header) || !header.startsWith("Bearer ")) return null;
  try {
    const payload = (await verify(header.slice(7), TEST_SECRET, "HS256")) as { sub: string };
    return payload.sub;
  } catch {
    return null;
  }
}

function startTestServer() {
  const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    if (req.url !== "/mcp") {
      res.writeHead(404).end();
      return;
    }

    const userId = await userIdFromRequest(req);
    if (!userId) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Unauthorized" }));
      return;
    }

    const rlResult = testLimiter.check(`uid:${userId}`);
    const resetSec = Math.ceil(rlResult.resetMs / 1000);
    res.setHeader("X-RateLimit-Limit", String(MAX_REQUESTS));
    res.setHeader("X-RateLimit-Remaining", String(rlResult.remaining));
    res.setHeader("X-RateLimit-Reset", String(resetSec));
    if (!rlResult.allowed) {
      res.setHeader("Retry-After", String(Math.ceil((rlResult.resetMs - Date.now()) / 1000)));
      res.writeHead(429, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "rate_limit_exceeded", retryAfter: resetSec }));
      return;
    }

    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined;

    const mcpServer = buildMcpServer(userId);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      void transport.close();
      void mcpServer.close();
    });
    await mcpServer.connect(transport);
    await transport.handleRequest(req, res, body);
  });

  httpServer.listen(0);
  const { port } = httpServer.address() as AddressInfo;

  return {
    url: `http://localhost:${port}/mcp`,
    close: () =>
      new Promise<void>((resolve, reject) =>
        httpServer.close((err) => (err ? reject(err) : resolve())),
      ),
  };
}

async function mintToken(userId: string): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  return sign({ sub: userId, exp }, TEST_SECRET, "HS256");
}

let server: ReturnType<typeof startTestServer>;
let testUserId: string;

before(async () => {
  process.env.TRUERATE_INMEMORY = "true";
  server = startTestServer();

  testUserId = `rl-test-${randomUUID()}`;
  const repo = await getUserRepo();
  await repo.create({
    id: testUserId,
    email: `${testUserId}@example.com`,
    passwordHash: "placeholder",
    memberships: [],
    createdAt: new Date().toISOString(),
    market: "cz",
    currency: "EUR",
  });
});

after(async () => {
  await server.close();
});

afterEach(() => {
  testLimiter.reset(`uid:${testUserId}`);
});

test("MCP: requests under the limit pass (non-429)", async () => {
  const token = await mintToken(testUserId);
  for (let i = 0; i < MAX_REQUESTS; i++) {
    const r = await fetch(server.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: i + 1, method: "tools/list" }),
    });
    assert.notEqual(r.status, 429, `request ${i + 1} should not be rate-limited`);
  }
});

test("MCP: request over the limit returns 429", async () => {
  const token = await mintToken(testUserId);
  for (let i = 0; i < MAX_REQUESTS; i++) {
    await fetch(server.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: i + 1, method: "tools/list" }),
    });
  }
  const r = await fetch(server.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: MAX_REQUESTS + 1, method: "tools/list" }),
  });
  assert.equal(r.status, 429);
  const body = (await r.json()) as { error: string };
  assert.equal(body.error, "rate_limit_exceeded");
});

test("MCP: 429 response includes rate-limit headers", async () => {
  const token = await mintToken(testUserId);
  for (let i = 0; i < MAX_REQUESTS; i++) {
    await fetch(server.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: i + 1, method: "tools/list" }),
    });
  }
  const r = await fetch(server.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: MAX_REQUESTS + 1, method: "tools/list" }),
  });
  assert.equal(r.status, 429);
  assert.ok(r.headers.get("Retry-After"), "Retry-After must be present");
  assert.ok(r.headers.get("X-RateLimit-Limit"), "X-RateLimit-Limit must be present");
  assert.equal(r.headers.get("X-RateLimit-Remaining"), "0");
  assert.ok(r.headers.get("X-RateLimit-Reset"), "X-RateLimit-Reset must be present");
});

test("MCP: different users have independent limits", async () => {
  const userId2 = `rl-test-2-${randomUUID()}`;
  const repo = await getUserRepo();
  await repo.create({
    id: userId2,
    email: `${userId2}@example.com`,
    passwordHash: "placeholder",
    memberships: [],
    createdAt: new Date().toISOString(),
    market: "cz",
    currency: "EUR",
  });

  const token1 = await mintToken(testUserId);
  const token2 = await mintToken(userId2);

  // Exhaust testUserId limit
  for (let i = 0; i < MAX_REQUESTS; i++) {
    await fetch(server.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token1}`,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: i + 1, method: "tools/list" }),
    });
  }
  const blocked = await fetch(server.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token1}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: MAX_REQUESTS + 1, method: "tools/list" }),
  });
  assert.equal(blocked.status, 429, "user1 should be blocked");

  // userId2 should be unaffected
  const ok = await fetch(server.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token2}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  assert.notEqual(ok.status, 429, "user2 should not be blocked by user1's limit");

  testLimiter.reset(`uid:${userId2}`);
});
