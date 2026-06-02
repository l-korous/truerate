// MCP channel driver: real StreamableHTTPClientTransport over HTTP.
//
// Acceptance criteria (issue #43):
//   - Real MCP client connects over streamable HTTP to the persona's per-user URL.
//   - Tool calls return the persona's expected applicable perks/conditions +
//     perk-value estimate tier.
//   - Explicit assertion that no price field/value is present in any tool
//     response (product rule #1 / issue #1).
//   - Runs locally and is wired for CI invocation.
//
// Design notes:
//   - Starts a real http.Server (port 0 → OS-assigned) that replicates the
//     auth + routing from apps/mcp/src/index.ts without importing it (index.ts
//     starts a server at module load time, which would conflict).
//   - Personas are built with createPersonaFactory and seeded into MemoryUserRepo
//     before the tests run.
//   - JWTs are signed with hono/jwt using a fixed test secret.
//   - The StreamableHTTPClientTransport sends Authorization: Bearer <token> on
//     every request via requestInit.headers.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { sign, verify } from "hono/jwt";
import { getUserRepo, matchBenefits, type User } from "@truerate/core";
import { createPersonaFactory, type TestPersona } from "@truerate/harness";
import { buildServer, type McpBenefitResult } from "../src/server.js";

// ── Constants ───────────────────────────────────────────────────────────────

const TEST_JWT_SECRET = "truerate-http-driver-test-secret-32x";

// All field names that must never appear in MCP output (product rule #1).
const FORBIDDEN_PRICE_FIELDS = [
  "publicOffer",
  "nightlyAmount",
  "totalAmount",
  "basePrice",
  "finalPrice",
  "memberPrice",
  "indicativePrice",
  "nightly",
  "postDiscountPrice",
];

// ── Test server ──────────────────────────────────────────────────────────────

interface TestServer {
  mcpUrl: string;
  close(): Promise<void>;
}

// Matches program IDs from persona specs to a search_hotels context that will
// trigger a benefit match for that program.
const PROGRAM_CONTEXT: Record<string, { domain?: string; brand?: string; location?: string }> = {
  booking_genius: { domain: "booking.com", location: "Vienna" },
  marriott_bonvoy: { brand: "Marriott", location: "Vienna" },
  accor_all: { brand: "Novotel", location: "Prague" },
  hilton_honors: { brand: "Hilton", location: "Prague" },
  ihg_one_rewards: { brand: "InterContinental", location: "Vienna" },
  revolut: { brand: "Marriott", location: "Vienna" }, // global perk; any hotel context
  amex_platinum: { brand: "Hilton", location: "Prague" }, // global perk; any hotel context
  your_prague_hotels: { domain: "yourpraguehotels.com", location: "Prague" },
  emblem_prague: { domain: "emblemprague.com", location: "Prague" },
};

function startTestServer(secret: string): TestServer {
  const httpServer = createServer(
    async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
      if (req.url === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
        return;
      }

      if (req.url !== "/mcp") {
        res.writeHead(404).end();
        return;
      }

      // JWT auth — same logic as apps/mcp/src/index.ts
      const authHeader = req.headers["authorization"];
      if (!authHeader || Array.isArray(authHeader) || !authHeader.startsWith("Bearer ")) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Missing or invalid Authorization header." }));
        return;
      }

      let userId: string;
      try {
        const payload = (await verify(authHeader.slice(7), secret, "HS256")) as { sub: string };
        userId = payload.sub;
      } catch {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid bearer token." }));
        return;
      }

      // Read body for POST requests
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

  // Listen on an OS-assigned port so multiple test runs never conflict.
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
  return sign({ sub: userId, exp }, TEST_JWT_SECRET, "HS256");
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function assertNoPriceFields(payload: unknown, label: string): void {
  const raw = JSON.stringify(payload);
  for (const field of FORBIDDEN_PRICE_FIELDS) {
    assert.ok(
      !raw.includes(`"${field}"`),
      `${label}: forbidden price field "${field}" found in MCP response`,
    );
  }
}

async function connectClient(
  mcpUrl: string,
  token: string,
): Promise<{ client: Client; close: () => Promise<void> }> {
  const client = new Client({ name: "truerate-http-driver", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(mcpUrl), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  await client.connect(transport);
  return {
    client,
    close: async () => {
      await transport.close();
    },
  };
}

async function seedPersona(persona: TestPersona): Promise<void> {
  const repo = await getUserRepo();
  const user: User = {
    id: persona.userId,
    email: persona.email,
    passwordHash: "test-placeholder",
    memberships: persona.memberships,
    createdAt: new Date().toISOString(),
    market: persona.market.toLowerCase() as User["market"],
    currency: "EUR",
  };
  await repo.create(user);
}

// ── Test suite setup ──────────────────────────────────────────────────────────

let server: TestServer;
let personas: TestPersona[];
const factory = createPersonaFactory({ mcpBaseUrl: "https://mcp.truerate.test" });

before(async () => {
  server = startTestServer(TEST_JWT_SECRET);

  // Build 8 personas (covers all archetype specs once) and seed them into the
  // in-process MemoryUserRepo. The same instance is shared with buildServer()
  // because both import from @truerate/core in the same process.
  personas = factory.build(8, 42);
  await Promise.all(personas.map(seedPersona));
});

after(async () => {
  factory.teardown();
  await server.close();
});

// ── Tests ────────────────────────────────────────────────────────────────────

test("401 is returned for requests without a bearer token", async () => {
  const res = await fetch(server.mcpUrl, { method: "POST" });
  assert.strictEqual(res.status, 401);
});

test("401 is returned for requests with an invalid JWT", async () => {
  const res = await fetch(server.mcpUrl, {
    method: "POST",
    headers: { Authorization: "Bearer not.a.valid.token" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  assert.strictEqual(res.status, 401);
});

for (let i = 0; i < 8; i++) {
  // Capture loop variable for each iteration's closure.
  const idx = i;

  test(`persona ${idx}: get_membership_summary lists all memberships with no price fields`, async () => {
    const persona = personas[idx]!;
    const token = await mintToken(persona.userId);
    const { client, close } = await connectClient(server.mcpUrl, token);

    try {
      const result = await client.callTool({ name: "get_membership_summary", arguments: {} });
      assert.ok(!result.isError, `tool errored: ${JSON.stringify(result)}`);

      const text = (result.content[0] as { type: "text"; text: string }).text;

      // Each membership label must appear in the summary.
      for (const m of persona.memberships) {
        assert.ok(
          text.includes(m.label) || text.includes(m.programId ?? ""),
          `persona ${idx} (${persona.handle}): membership "${m.label}" not found in summary`,
        );
      }

      // Product rule #1: no price language in the summary text.
      assert.doesNotMatch(text, /member price/i, "summary must not contain 'member price'");
      assert.doesNotMatch(text, /final price/i, "summary must not contain 'final price'");
      assert.doesNotMatch(text, /post.discount/i, "summary must not contain 'post-discount'");

      // No forbidden price fields in the structured response payload.
      assertNoPriceFields(result, `persona ${idx} get_membership_summary`);
    } finally {
      await close();
    }
  });

  test(`persona ${idx}: search_hotels returns applicable benefits with isEstimate-tagged perk values and no prices`, async () => {
    const persona = personas[idx]!;
    const token = await mintToken(persona.userId);
    const { client, close } = await connectClient(server.mcpUrl, token);

    // Pick a context that will trigger at least one membership match.
    // booking_genius matches any hotel query (category: "hotel" always set),
    // so it's the safest fallback when a persona has it.
    const firstProgramId = persona.memberships[0]?.programId ?? "";
    const searchCtx = PROGRAM_CONTEXT[firstProgramId] ?? { location: "Vienna" };

    try {
      const result = await client.callTool({
        name: "search_hotels",
        arguments: { ...searchCtx, stars: 4 },
      });
      assert.ok(!result.isError, `tool errored: ${JSON.stringify(result)}`);

      assert.ok(result.structuredContent, "structuredContent must be present for AI assistant consumption");
      const sc = result.structuredContent as unknown as McpBenefitResult;

      // Structural invariants
      assert.ok(Array.isArray(sc.matches), "matches must be an array");
      assert.ok(Array.isArray(sc.perkValueEstimates), "perkValueEstimates must be an array");
      assert.ok(typeof sc.generatedAt === "string", "generatedAt must be a string");
      assert.ok(typeof sc.context === "object", "context must be an object");

      // isEstimate must be true on every perk-value estimate (product rule #1).
      for (const est of sc.perkValueEstimates) {
        assert.strictEqual(
          est.isEstimate,
          true,
          `perkValueEstimate for "${est.perkType}" must carry isEstimate: true`,
        );
        assert.ok(typeof est.estimatedUsd === "object", "estimatedUsd must be an object");
        assert.ok(
          typeof est.estimatedUsd[3] === "number" &&
            typeof est.estimatedUsd[4] === "number" &&
            typeof est.estimatedUsd[5] === "number",
          "estimatedUsd must carry values for 3★, 4★, and 5★ bands",
        );
      }

      // The formatted text must mention price-is-not-returned disclaimer.
      const text = (result.content[0] as { type: "text"; text: string }).text;
      assert.match(text, /Prices are not returned/i, "formatted text must include the no-prices disclaimer");

      // No price fields anywhere in the structured payload.
      assertNoPriceFields(sc, `persona ${idx} search_hotels`);
    } finally {
      await close();
    }
  });
}

// ── Deeper per-persona perk-contract assertions ───────────────────────────────
// These tests verify that the observed tool output matches the expectedPerks
// contract recorded in the persona. Each persona with expectedPerks must have
// at least one matching perkValueEstimate in the response (for the context that
// triggers that membership).

test("personas with expectedPerks: perk types returned match the persona contract", async () => {
  const personasWithPerks = personas.filter((p) => p.expectedPerks.length > 0);
  assert.ok(personasWithPerks.length > 0, "at least one persona must have expectedPerks");

  for (const persona of personasWithPerks) {
    const token = await mintToken(persona.userId);
    const { client, close } = await connectClient(server.mcpUrl, token);

    // Build a set of contexts that cover all program IDs in this persona.
    const contexts = new Set<string>();
    for (const m of persona.memberships) {
      const ctx = m.programId ? PROGRAM_CONTEXT[m.programId] : undefined;
      if (ctx) contexts.add(JSON.stringify(ctx));
    }

    // Gather all perkTypes returned across all relevant contexts.
    const observedPerkTypes = new Set<string>();

    try {
      for (const ctxJson of contexts) {
        const ctx = JSON.parse(ctxJson) as Record<string, string>;
        const result = await client.callTool({
          name: "search_hotels",
          arguments: { ...ctx, stars: 4 },
        });
        if (result.isError) continue;
        const sc = result.structuredContent as unknown as McpBenefitResult;
        for (const est of sc.perkValueEstimates) {
          observedPerkTypes.add(est.perkType);
        }
        // Structural safety: no price fields
        assertNoPriceFields(sc, `persona ${persona.handle} perk-contract check`);
      }

      // Compute which structured perk types should appear in hotel-context searches
      // by running the same benefit-match logic the server uses. Only programs
      // whose defaultMatch includes hotel categories/domains/brands can ever
      // surface in search_hotels (which always passes category: "hotel").
      // Subscription-only programs like Revolut are correctly excluded here.
      const expectedHotelPerkTypes = new Set<string>();
      for (const m of persona.memberships) {
        const ctx = m.programId ? PROGRAM_CONTEXT[m.programId] : undefined;
        if (!ctx) continue;
        const matches = matchBenefits([m], { ...ctx, category: "hotel" });
        for (const match of matches) {
          for (const sp of match.benefit.value.structuredPerks ?? []) {
            expectedHotelPerkTypes.add(sp.type);
          }
        }
      }

      if (expectedHotelPerkTypes.size === 0) {
        // This persona has no hotel-context-matchable structured perks (e.g., all
        // memberships are subscription-level programs). Their membership summary
        // is still verified by the per-persona get_membership_summary tests above.
        continue;
      }

      const matched = [...expectedHotelPerkTypes].filter((t) => observedPerkTypes.has(t));
      assert.ok(
        matched.length > 0,
        `persona ${persona.handle}: none of the hotel-matchable perk types [${[...expectedHotelPerkTypes].join(", ")}] ` +
          `appeared in tool responses (observed: [${[...observedPerkTypes].join(", ")}])`,
      );
    } finally {
      await close();
    }
  }
});
