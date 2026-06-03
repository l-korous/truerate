// Comprehensive e2e test of createRequestListener() — the production MCP HTTP handler.
//
// Problem: every other MCP HTTP test (http-tools, rate-limit, http-channel-driver,
// cross-channel-consistency) builds its OWN custom request handler rather than
// calling createRequestListener(). The production handler is therefore only 86.95%
// covered with these code paths completely untested:
//   - GET /health    → 200 + { ok, mode }           (lines 70-73)
//   - Invalid path   → 404                           (lines 78-80)
//   - Bearer failure via /mcp → 401 bearer message   (line 100)
//   - Rate-limit headers on any successful request   (lines 109-111)
//
// This file drives createRequestListener() directly and validates real end-to-end
// journeys through it — health, routing, auth error messages, rate-limit headers,
// and tool calls via the per-user URL credential path (as an AI desktop client
// would use, e.g. Claude Desktop with a pasted MCP URL).
//
// Relation to issue #159 synthetic-user harness:
//   Personas from @truerate/harness are used to seed vault contents so the tool
//   call assertions are grounded in real catalog data (not hand-crafted stubs),
//   matching the "drive real MCP + real memberships" requirement from #41 / #45.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  getUserRepo,
  generateMcpToken,
  hashMcpToken,
  mcpUrlForToken,
  type User,
} from "@truerate/core";
import { createPersonaFactory, type TestPersona } from "@truerate/harness";
import { createRequestListener } from "../src/http.js";
import type { McpBenefitResult } from "../src/server.js";

// ── Constants ─────────────────────────────────────────────────────────────────

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

function assertNoPriceFields(payload: unknown, label: string): void {
  const raw = JSON.stringify(payload);
  for (const field of FORBIDDEN_PRICE_FIELDS) {
    assert.ok(
      !raw.includes(`"${field}"`),
      `${label}: forbidden price field "${field}" found (product rule #1 / issue #1)`,
    );
  }
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

// Seed 55: distinct from seeds used in other test files (42, 77, 99) to avoid
// MemoryUserRepo collisions across test files in the same Node.js process.
const factory = createPersonaFactory();
let personas: TestPersona[];

let srv: Server;
let base: string;

// Raw (unhashed) MCP tokens keyed by persona index.
let tokens: string[];

before(async () => {
  process.env.TRUERATE_INMEMORY = "true";
  // Set JWT secret so the bearer auth path in createRequestListener can execute
  // (even when it fails verification, the code path to the 401 error branch runs).
  process.env.TRUERATE_JWT_SECRET = "http-listener-test-secret-32chars!";

  srv = createServer(createRequestListener());
  srv.listen(0);
  base = `http://localhost:${(srv.address() as AddressInfo).port}`;

  // Two personas: CZ (Booking Genius L2 + Your Prague Hotels) and DE (Genius L1 +
  // Marriott Gold). Seeded with real catalog memberships from @truerate/harness.
  personas = factory.build(2, 55);
  const repo = await getUserRepo();

  tokens = await Promise.all(
    personas.map(async (persona) => {
      const rawToken = generateMcpToken();
      const user: User = {
        id: persona.userId,
        email: persona.email,
        passwordHash: "test-placeholder",
        memberships: persona.memberships,
        createdAt: new Date().toISOString(),
        market: persona.market.toLowerCase() as User["market"],
        currency: "EUR",
        mcpToken: { hash: hashMcpToken(rawToken), createdAt: new Date().toISOString() },
      };
      await repo.create(user);
      return rawToken;
    }),
  );
});

after(async () => {
  factory.teardown();
  await new Promise<void>((res, rej) => srv.close((e) => (e ? rej(e) : res())));
});

// ── Health endpoint (lines 70-73 in http.ts) ─────────────────────────────────

test("createRequestListener: GET /health returns 200 with ok:true and mode field", async () => {
  const res = await fetch(`${base}/health`);
  assert.strictEqual(res.status, 200);
  const body = (await res.json()) as { ok: boolean; mode: string };
  assert.strictEqual(body.ok, true, "health response must have ok:true");
  assert.ok(
    typeof body.mode === "string",
    "health response must include mode field (mock | live)",
  );
});

// ── 404 for unrecognised path (lines 78-80 in http.ts) ───────────────────────

test("createRequestListener: unrecognised path returns 404", async () => {
  const res = await fetch(`${base}/unknown-endpoint`);
  assert.strictEqual(res.status, 404, "unknown path must return 404");
});

test("createRequestListener: POST to a non-MCP path returns 404", async () => {
  const res = await fetch(`${base}/api/v1/search`, { method: "POST" });
  assert.strictEqual(res.status, 404, "non-MCP POST must return 404");
});

// ── Bearer auth failure via /mcp → 401 with bearer error message (line 100) ──
//
// When the request targets /mcp (Bearer path) and auth fails, the error message
// must say "Connect TrueRate with a valid bearer token." — distinct from the
// per-user URL failure message ("Invalid or revoked MCP URL…"). This branch is
// exercised by calling /mcp with an invalid JWT.

test("createRequestListener: POST /mcp with invalid bearer JWT returns 401 with bearer error message", async () => {
  const res = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: {
      Authorization: "Bearer this.is.not.a.valid.jwt",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  assert.strictEqual(res.status, 401);
  const body = (await res.json()) as { error: string };
  assert.ok(typeof body.error === "string", "401 response must include error message");
  // Bearer auth failure message — NOT the URL-token failure message.
  assert.match(
    body.error,
    /Connect TrueRate|valid bearer token/i,
    "bearer auth failure must return the bearer-specific error message",
  );
});

test("createRequestListener: POST /mcp with no auth returns 401", async () => {
  const res = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  assert.strictEqual(res.status, 401);
  const body = (await res.json()) as { error: string };
  assert.ok(typeof body.error === "string", "401 must include error message");
});

// ── Rate-limit headers present on successful requests (lines 109-111) ─────────

test("createRequestListener: successful request includes X-RateLimit-* headers", async () => {
  const mcpUrl = mcpUrlForToken(base, tokens[0]!);
  const res = await fetch(mcpUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  // Not rate-limited on first request.
  assert.notEqual(res.status, 429, "first request must not be rate-limited");
  assert.ok(
    res.headers.get("X-RateLimit-Limit"),
    "X-RateLimit-Limit header must be present",
  );
  assert.ok(
    res.headers.get("X-RateLimit-Remaining"),
    "X-RateLimit-Remaining header must be present",
  );
  assert.ok(
    res.headers.get("X-RateLimit-Reset"),
    "X-RateLimit-Reset header must be present",
  );
});

// ── Per-user URL journey via createRequestListener ────────────────────────────
//
// These tests use the SAME handler that runs in production (Container Apps),
// not a custom test harness. The persona's catalog memberships must surface
// through the handler's token → userId → vault → tool response chain.

test("createRequestListener: get_membership_summary shows persona's catalog memberships (no prices)", async () => {
  const persona = personas[0]!;
  const mcpUrl = mcpUrlForToken(base, tokens[0]!);

  const client = new Client({ name: "listener-summary-test", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(mcpUrl));
  await client.connect(transport);
  try {
    const result = await client.callTool({ name: "get_membership_summary", arguments: {} });
    assert.ok(!result.isError, `tool errored: ${JSON.stringify(result)}`);
    const text = (result.content[0] as { type: "text"; text: string }).text;

    // Every membership the persona holds must appear in the summary.
    for (const m of persona.memberships) {
      assert.ok(
        text.includes(m.label) || text.includes(m.programId ?? ""),
        `persona ${persona.handle}: membership "${m.label}" missing from summary`,
      );
    }

    // Product rule #1: no price language anywhere.
    assert.doesNotMatch(text, /member price/i);
    assert.doesNotMatch(text, /final price/i);
    assert.doesNotMatch(text, /post.discount/i);
    assertNoPriceFields(result, "get_membership_summary via createRequestListener");
  } finally {
    await transport.close();
  }
});

test("createRequestListener: search_hotels returns discounts/perks + no prices for persona with Genius membership", async () => {
  // Find the persona that holds a Booking Genius membership (will produce a 10–20% discount).
  const geniusIdx = personas.findIndex((p) =>
    p.memberships.some((m) => m.programId === "booking_genius"),
  );
  if (geniusIdx < 0) return; // Seed may not always include Genius — skip gracefully.

  const mcpUrl = mcpUrlForToken(base, tokens[geniusIdx]!);
  const client = new Client({ name: "listener-search-test", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(mcpUrl));
  await client.connect(transport);
  try {
    const result = await client.callTool({
      name: "search_hotels",
      arguments: { domain: "booking.com", location: "Prague", stars: 4 },
    });
    assert.ok(!result.isError, `search_hotels errored: ${JSON.stringify(result)}`);
    assert.ok(
      result.structuredContent,
      "structuredContent required for AI assistant consumption",
    );

    const sc = result.structuredContent as unknown as McpBenefitResult;

    // Genius must produce at least one discount match on booking.com.
    const hasDiscount = sc.matches.some((m) => m.discount !== undefined);
    assert.ok(
      hasDiscount,
      `Genius membership must produce a discount match; matches: ${JSON.stringify(sc.matches)}`,
    );
    assert.ok(
      sc.programsApplied.includes("booking_genius"),
      `booking_genius must be in programsApplied; got: ${JSON.stringify(sc.programsApplied)}`,
    );

    // No-prices disclaimer must appear in formatted text.
    const text = (result.content[0] as { type: "text"; text: string }).text;
    assert.match(text, /Prices are not returned/i, "no-prices disclaimer must be present");
    assert.doesNotMatch(text, /member price/i);
    assert.doesNotMatch(text, /final price/i);

    // Structured output must be free of forbidden price fields.
    assertNoPriceFields(sc, "search_hotels via createRequestListener (Genius persona)");

    // Every perk-value estimate must carry isEstimate: true.
    for (const est of sc.perkValueEstimates) {
      assert.strictEqual(
        est.isEstimate,
        true,
        `perk "${est.perkType}" estimate must carry isEstimate:true (product rule #1)`,
      );
    }
  } finally {
    await transport.close();
  }
});

test("createRequestListener: invalid URL token returns 401 with URL-token error message", async () => {
  const fakeToken = "this_token_was_never_issued_xxxxxxxx";
  const res = await fetch(`${base}/u/${fakeToken}/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  assert.strictEqual(res.status, 401);
  const body = (await res.json()) as { error: string };
  assert.ok(typeof body.error === "string", "401 must include error message");
  // URL-token error message — distinct from bearer auth failure message.
  assert.match(
    body.error,
    /Invalid or revoked MCP URL|Generate a new one/i,
    "URL-token failure must return the URL-token-specific error message",
  );
  // Error must not leak internals.
  assert.doesNotMatch(body.error, /userId|programId|token_hash/i);
});

// ── Vault isolation through createRequestListener ─────────────────────────────
//
// Token from persona[0] must never expose persona[1]'s memberships,
// even through the real production handler (not a stub).

test("createRequestListener: vault isolation — token A never exposes persona B's memberships", async () => {
  const p0 = personas[0]!;
  const p1 = personas[1]!;
  const url0 = mcpUrlForToken(base, tokens[0]!);
  const url1 = mcpUrlForToken(base, tokens[1]!);

  const [c0, c1] = await Promise.all([
    (async () => {
      const client = new Client({ name: "isolation-test-A", version: "1.0.0" });
      const transport = new StreamableHTTPClientTransport(new URL(url0));
      await client.connect(transport);
      return { client, transport };
    })(),
    (async () => {
      const client = new Client({ name: "isolation-test-B", version: "1.0.0" });
      const transport = new StreamableHTTPClientTransport(new URL(url1));
      await client.connect(transport);
      return { client, transport };
    })(),
  ]);

  try {
    const [r0, r1] = await Promise.all([
      c0.client.callTool({ name: "get_membership_summary", arguments: {} }),
      c1.client.callTool({ name: "get_membership_summary", arguments: {} }),
    ]);

    const t0 = (r0.content[0] as { type: "text"; text: string }).text;
    const t1 = (r1.content[0] as { type: "text"; text: string }).text;

    // Each persona's own memberships must appear in their summary.
    for (const m of p0.memberships) {
      assert.ok(
        t0.includes(m.label) || t0.includes(m.programId ?? ""),
        `persona[0] (${p0.handle}): own membership "${m.label}" missing from summary`,
      );
    }
    for (const m of p1.memberships) {
      assert.ok(
        t1.includes(m.label) || t1.includes(m.programId ?? ""),
        `persona[1] (${p1.handle}): own membership "${m.label}" missing from summary`,
      );
    }

    // Programs unique to persona[0] must NOT appear in persona[1]'s summary.
    const p0OnlyIds = p0.memberships
      .filter((m) => m.programId && !p1.memberships.some((m2) => m2.programId === m.programId))
      .map((m) => m.programId!);

    for (const pid of p0OnlyIds) {
      assert.ok(
        !t1.includes(pid),
        `vault isolation violated via createRequestListener: ` +
          `persona[1] (${p1.handle}) summary contains persona[0]'s program "${pid}"`,
      );
    }
  } finally {
    await c0.transport.close();
    await c1.transport.close();
  }
});

// ── No-prices global guard through createRequestListener ──────────────────────

test("createRequestListener: product rule #1 — no forbidden price fields for all seeded personas", async () => {
  const CONTEXTS = [
    { domain: "booking.com", location: "Prague" },
    { brand: "Marriott", location: "Vienna" },
  ];

  for (let i = 0; i < personas.length; i++) {
    const persona = personas[i]!;
    const mcpUrl = mcpUrlForToken(base, tokens[i]!);

    const client = new Client({ name: `price-guard-${i}`, version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(new URL(mcpUrl));
    await client.connect(transport);

    try {
      // Summary price guard.
      const sumResult = await client.callTool({ name: "get_membership_summary", arguments: {} });
      assert.ok(!sumResult.isError, `${persona.handle}: summary tool errored`);
      assertNoPriceFields(sumResult, `${persona.handle} summary via createRequestListener`);

      // Search price guard across multiple contexts.
      for (const ctx of CONTEXTS) {
        const searchResult = await client.callTool({
          name: "search_hotels",
          arguments: { ...ctx, stars: 4 },
        });
        assert.ok(!searchResult.isError, `${persona.handle}: search_hotels errored for ${JSON.stringify(ctx)}`);
        if (searchResult.structuredContent) {
          assertNoPriceFields(
            searchResult.structuredContent,
            `${persona.handle} search via createRequestListener (${JSON.stringify(ctx)})`,
          );
        }
        const text =
          (searchResult.content[0] as { type: "text"; text: string } | undefined)?.text ?? "";
        assert.doesNotMatch(
          text,
          /member price/i,
          `${persona.handle}: "member price" forbidden in search response text`,
        );
        assert.doesNotMatch(
          text,
          /final price/i,
          `${persona.handle}: "final price" forbidden in search response text`,
        );
      }
    } finally {
      await transport.close();
    }
  }
});
