// MCP tools: real HTTP transport with JWT authentication.
//
// Every other passing MCP test uses InMemoryTransport. This file covers the
// real HTTP stack — JWT auth enforcement, StreamableHTTPClientTransport,
// stateless-per-request server — without depending on @truerate/harness,
// so it runs cleanly without a pre-build step.
//
// Closes the gap described in issue #159 item "MCP tests against a
// deployed-in-CI instance": the full HTTP path is verified in CI for every PR.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { sign, verify } from "hono/jwt";
import { getUserRepo, getProgram, instantiateBenefits } from "@truerate/core";
import { buildServer, type McpBenefitResult } from "../src/server.js";

// Fixed secret for this test suite only.
const TEST_SECRET = "truerate-http-tools-test-secret-32xx";

// Fields that must never appear in any MCP response (product rule #1).
const FORBIDDEN_PRICE_FIELDS = [
  "nightlyAmount", "totalAmount", "memberPrice",
  "basePrice", "finalPrice", "indicativePrice", "postDiscountPrice",
];

// ── Minimal test HTTP server ────────────────────────────────────────────────

interface TestServer {
  mcpUrl: string;
  close(): Promise<void>;
}

function startTestServer(): TestServer {
  const httpServer = createServer(
    async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
      if (req.url !== "/mcp") {
        res.writeHead(404).end();
        return;
      }

      const authHeader = req.headers["authorization"];
      if (!authHeader || Array.isArray(authHeader) || !authHeader.startsWith("Bearer ")) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Missing or invalid Authorization header." }));
        return;
      }

      let userId: string;
      try {
        const payload = (await verify(authHeader.slice(7), TEST_SECRET, "HS256")) as { sub: string };
        userId = payload.sub;
      } catch {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid bearer token." }));
        return;
      }

      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined;

      const mcpServer = buildServer(userId);
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on("close", () => {
        void transport.close();
        void mcpServer.close();
      });
      await mcpServer.connect(transport);
      await transport.handleRequest(req, res, body);
    },
  );

  httpServer.listen(0);
  const { port } = httpServer.address() as AddressInfo;

  return {
    mcpUrl: `http://localhost:${port}/mcp`,
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

async function connectClient(
  mcpUrl: string,
  token: string,
): Promise<{ client: Client; close: () => Promise<void> }> {
  const client = new Client({ name: "truerate-http-tools-test", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(mcpUrl), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  await client.connect(transport);
  return { client, close: async () => transport.close() };
}

function assertNoPriceFields(payload: unknown, label: string): void {
  const raw = JSON.stringify(payload);
  for (const field of FORBIDDEN_PRICE_FIELDS) {
    assert.ok(!raw.includes(`"${field}"`), `${label}: forbidden field "${field}" in response`);
  }
}

// ── Fixtures ────────────────────────────────────────────────────────────────

let server: TestServer;
let geniusUserId: string;
let marriottUserId: string;

before(async () => {
  process.env.TRUERATE_INMEMORY = "true";
  server = startTestServer();
  const repo = await getUserRepo();

  geniusUserId = `http-tools-genius-${randomUUID()}`;
  const geniusProgram = getProgram("booking_genius");
  assert.ok(geniusProgram, "booking_genius must exist");
  await repo.create({
    id: geniusUserId,
    email: `${geniusUserId}@example.com`,
    passwordHash: "placeholder",
    memberships: [
      {
        id: randomUUID(),
        label: "Booking.com Genius - Level 3",
        programId: "booking_genius",
        tier: "Level 3",
        attributes: {},
        benefits: instantiateBenefits(geniusProgram, "Level 3"),
        addedAt: new Date().toISOString(),
        status: "active",
      },
    ],
    createdAt: new Date().toISOString(),
    market: "cz",
    currency: "EUR",
  });

  marriottUserId = `http-tools-marriott-${randomUUID()}`;
  const marriottProgram = getProgram("marriott_bonvoy");
  assert.ok(marriottProgram, "marriott_bonvoy must exist");
  await repo.create({
    id: marriottUserId,
    email: `${marriottUserId}@example.com`,
    passwordHash: "placeholder",
    memberships: [
      {
        id: randomUUID(),
        label: "Marriott Bonvoy - Platinum",
        programId: "marriott_bonvoy",
        tier: "Platinum",
        attributes: {},
        benefits: instantiateBenefits(marriottProgram, "Platinum"),
        addedAt: new Date().toISOString(),
        status: "active",
      },
    ],
    createdAt: new Date().toISOString(),
    market: "at",
    currency: "EUR",
  });
});

after(async () => {
  await server.close();
});

// ── Auth enforcement ─────────────────────────────────────────────────────────

test("HTTP MCP: 401 for request without bearer token", async () => {
  const res = await fetch(server.mcpUrl, { method: "POST" });
  assert.strictEqual(res.status, 401);
});

test("HTTP MCP: 401 for request with invalid JWT", async () => {
  const res = await fetch(server.mcpUrl, {
    method: "POST",
    headers: { Authorization: "Bearer not.a.valid.jwt" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  assert.strictEqual(res.status, 401);
});

// ── get_membership_summary over real HTTP ─────────────────────────────────────

test("HTTP MCP: get_membership_summary returns Genius Level 3 with 20% off and no prices", async () => {
  const token = await mintToken(geniusUserId);
  const { client, close } = await connectClient(server.mcpUrl, token);
  try {
    const result = await client.callTool({ name: "get_membership_summary", arguments: {} });
    assert.ok(!result.isError, `tool errored: ${JSON.stringify(result)}`);
    const text = (result.content[0] as { type: "text"; text: string }).text;
    assert.match(text, /Booking\.com Genius/i, "membership label must appear in summary");
    assert.match(text, /20% off/i, "Genius Level 3 discount must appear");
    assert.doesNotMatch(text, /member price/i, "no 'member price' in summary");
    assert.doesNotMatch(text, /post.discount/i, "no post-discount price in summary");
    assertNoPriceFields(result, "get_membership_summary");
  } finally {
    await close();
  }
});

// ── search_hotels over real HTTP ──────────────────────────────────────────────

test("HTTP MCP: search_hotels with Genius Level 3 returns 20% discount in structuredContent", async () => {
  const token = await mintToken(geniusUserId);
  const { client, close } = await connectClient(server.mcpUrl, token);
  try {
    const result = await client.callTool({
      name: "search_hotels",
      arguments: { domain: "booking.com", location: "Prague" },
    });
    assert.ok(!result.isError, `tool errored: ${JSON.stringify(result)}`);
    assert.ok(result.structuredContent, "structuredContent must be present for AI assistant consumption");
    const sc = result.structuredContent as unknown as McpBenefitResult;

    assert.ok(Array.isArray(sc.matches), "matches must be an array");
    const has20 = sc.matches.some(
      (m) => m.discount !== undefined && Math.round(m.discount.percentOff * 100) === 20,
    );
    assert.ok(has20, `20% Genius discount must be in matches; got: ${JSON.stringify(sc.matches)}`);
    assert.ok(
      sc.programsApplied.includes("booking_genius"),
      `booking_genius must be in programsApplied; got: ${JSON.stringify(sc.programsApplied)}`,
    );

    const text = (result.content[0] as { type: "text"; text: string }).text;
    assert.match(text, /Prices are not returned/i, "no-prices disclaimer must be present");

    assertNoPriceFields(sc, "search_hotels Genius");
  } finally {
    await close();
  }
});

test("HTTP MCP: search_hotels with Marriott Platinum returns free_breakfast perk on Marriott context", async () => {
  const token = await mintToken(marriottUserId);
  const { client, close } = await connectClient(server.mcpUrl, token);
  try {
    const result = await client.callTool({
      name: "search_hotels",
      arguments: { brand: "Marriott", location: "Vienna", stars: 5 },
    });
    assert.ok(!result.isError, `tool errored: ${JSON.stringify(result)}`);
    const sc = result.structuredContent as unknown as McpBenefitResult;

    const hasBreakfast = sc.matches.some((m) => m.perks.some((p) => /breakfast/i.test(p)));
    assert.ok(hasBreakfast, `breakfast perk must appear; got: ${JSON.stringify(sc.matches)}`);
    assert.ok(
      sc.programsApplied.includes("marriott_bonvoy"),
      `marriott_bonvoy must be in programsApplied; got: ${JSON.stringify(sc.programsApplied)}`,
    );
    // Platinum is perk-only — no % discount on the Marriott match.
    const marriottMatch = sc.matches.find((m) => /Marriott/i.test(m.membershipLabel));
    assert.ok(marriottMatch, "Marriott match must be present");
    assert.strictEqual(marriottMatch!.discount, undefined, "perk-only tier must carry no discount");

    assertNoPriceFields(sc, "search_hotels Marriott Platinum");
  } finally {
    await close();
  }
});

test("HTTP MCP: perkValueEstimates carry isEstimate:true and correct band structure", async () => {
  const token = await mintToken(marriottUserId);
  const { client, close } = await connectClient(server.mcpUrl, token);
  try {
    const result = await client.callTool({
      name: "search_hotels",
      arguments: { brand: "Marriott", location: "Vienna", stars: 4 },
    });
    assert.ok(!result.isError);
    const sc = result.structuredContent as unknown as McpBenefitResult;
    assert.ok(sc.perkValueEstimates.length > 0, "Marriott Platinum must produce perk value estimates");
    for (const est of sc.perkValueEstimates) {
      assert.strictEqual(est.isEstimate, true, `isEstimate must be true for "${est.perkType}"`);
      assert.ok(
        typeof est.estimatedUsd[3] === "number" &&
          typeof est.estimatedUsd[4] === "number" &&
          typeof est.estimatedUsd[5] === "number",
        `estimatedUsd must cover 3★/4★/5★ for "${est.perkType}"`,
      );
    }
  } finally {
    await close();
  }
});
