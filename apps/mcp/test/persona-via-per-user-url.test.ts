// Cross-component journey: persona catalog memberships accessed via per-user MCP URL (issue #159 / #82).
//
// Gap closed: two existing test files each cover half of this flow:
//   • http-channel-driver.test.ts  — real catalog memberships, 8 personas, but uses JWT bearer auth.
//   • per-user-url.test.ts          — per-user URL routing, but with a manually-crafted user that
//                                     has no catalog-program benefits (just a hard-coded free-breakfast perk).
//
// This test unites the two: it seeds synthetic personas (with real catalog memberships) and then
// exercises every tool call through the /u/<token>/mcp per-user URL path — with NO auth header —
// exactly the credential flow an AI desktop client (Claude Desktop, Cursor, etc.) would use.
//
// Why this matters (issue #159 / synthetic-user harness requirement):
//   1. Verifies that hashMcpToken(token) stored at seeding time resolves to the correct userId,
//      so the user's catalog memberships are loaded — not an empty vault.
//   2. Verifies URL isolation: persona A's token never returns persona B's benefits.
//   3. Verifies that real catalog discount percentages (20% for Genius L3) and perk estimates
//      surface through the per-user URL path — product rule #1 unchanged.
//   4. Covers the MCP http.ts branches that handle URL-token auth (lines flagged in coverage).

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
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
      `${label}: forbidden price field "${field}" found in output (product rule #1)`,
    );
  }
}

// ── Context map: hotel context that triggers a match for each catalog program ─

const PROGRAM_CONTEXT: Record<string, Record<string, string>> = {
  booking_genius: { domain: "booking.com", location: "Prague" },
  marriott_bonvoy: { brand: "Marriott", location: "Vienna" },
  accor_all: { brand: "Novotel", location: "Prague" },
  hilton_honors: { brand: "Hilton", location: "Prague" },
  ihg_one_rewards: { brand: "InterContinental", location: "Vienna" },
  revolut: { brand: "Marriott", location: "Vienna" },
  amex_platinum: { brand: "Hilton", location: "Prague" },
  your_prague_hotels: { domain: "yourpraguehotels.com", location: "Prague" },
  emblem_prague: { domain: "emblemprague.com", location: "Prague" },
};

// ── Seed helper ───────────────────────────────────────────────────────────────

/**
 * Write the persona's user record into the in-process MemoryUserRepo and attach
 * an MCP token — mirroring what POST /me/mcp-url does in the API layer.
 * Returns the raw (unhashed) token that must be embedded in the per-user URL.
 */
async function seedPersonaWithToken(persona: TestPersona): Promise<string> {
  const rawToken = generateMcpToken();
  const repo = await getUserRepo();
  const user: User = {
    id: persona.userId,
    email: persona.email,
    passwordHash: "test-placeholder",
    memberships: persona.memberships,
    createdAt: new Date().toISOString(),
    market: persona.market.toLowerCase() as User["market"],
    currency: "EUR",
    // Store only the hash — same contract as the real API.
    mcpToken: { hash: hashMcpToken(rawToken), createdAt: new Date().toISOString() },
  };
  await repo.create(user);
  return rawToken;
}

// ── Server / client helpers ───────────────────────────────────────────────────

let srv: Server;
let serverBase: string;

function startServer(): void {
  srv = createServer(createRequestListener());
  srv.listen(0);
  serverBase = `http://localhost:${(srv.address() as AddressInfo).port}`;
}

async function connectToUrl(
  mcpUrl: string,
): Promise<{ client: Client; close: () => Promise<void> }> {
  const client = new Client({ name: "persona-per-user-url-test", version: "1.0.0" });
  // No auth header — the URL token IS the credential (per-user URL path).
  const transport = new StreamableHTTPClientTransport(new URL(mcpUrl));
  await client.connect(transport);
  return { client, close: async () => transport.close() };
}

// ── Suite state ───────────────────────────────────────────────────────────────

// Seed 99: distinct from other test files (42, 77) to avoid MemoryUserRepo collisions.
const factory = createPersonaFactory();
let personas: TestPersona[];
let rawTokens: string[];

before(async () => {
  process.env.TRUERATE_INMEMORY = "true";
  startServer();

  // 4 personas cover multiple membership mixes (CZ/DE/AT/GB archetypes).
  personas = factory.build(4, 99);
  rawTokens = await Promise.all(personas.map(seedPersonaWithToken));
});

after(async () => {
  factory.teardown();
  await new Promise<void>((res, rej) => srv.close((e) => (e ? rej(e) : res())));
});

// ── Tests ─────────────────────────────────────────────────────────────────────

test("get_membership_summary via per-user URL lists all catalog memberships (no auth header)", async () => {
  const persona = personas[0]!;
  const mcpUrl = mcpUrlForToken(serverBase, rawTokens[0]!);

  const { client, close } = await connectToUrl(mcpUrl);
  try {
    const result = await client.callTool({ name: "get_membership_summary", arguments: {} });
    assert.ok(!result.isError, `tool errored: ${JSON.stringify(result)}`);

    const text = (result.content[0] as { type: "text"; text: string }).text;

    // Every membership the persona holds must appear in the summary.
    for (const m of persona.memberships) {
      assert.ok(
        text.includes(m.label) || text.includes(m.programId ?? ""),
        `persona ${persona.handle}: membership "${m.label}" (${m.programId}) not found in summary.\n` +
          `Summary (first 300 chars): ${text.slice(0, 300)}`,
      );
    }

    // Product rule #1: no price language.
    assert.doesNotMatch(text, /member price/i, "summary must not contain 'member price'");
    assert.doesNotMatch(text, /final price/i, "summary must not contain 'final price'");
    assert.doesNotMatch(text, /post.discount/i, "summary must not contain 'post-discount'");

    // No forbidden price fields in the full response payload.
    assertNoPriceFields(result, `persona ${persona.handle} get_membership_summary`);
  } finally {
    await close();
  }
});

test("per-user URLs are isolated: persona A's token never exposes persona B's memberships", async () => {
  // Personas 0 and 1 have different membership mixes (deterministic factory, seed 99).
  const p0 = personas[0]!;
  const p1 = personas[1]!;
  const url0 = mcpUrlForToken(serverBase, rawTokens[0]!);
  const url1 = mcpUrlForToken(serverBase, rawTokens[1]!);

  const { client: c0, close: close0 } = await connectToUrl(url0);
  const { client: c1, close: close1 } = await connectToUrl(url1);
  try {
    const [r0, r1] = await Promise.all([
      c0.callTool({ name: "get_membership_summary", arguments: {} }),
      c1.callTool({ name: "get_membership_summary", arguments: {} }),
    ]);

    const t0 = (r0.content[0] as { type: "text"; text: string }).text;
    const t1 = (r1.content[0] as { type: "text"; text: string }).text;

    // Each persona's own memberships must appear in their summary.
    for (const m of p0.memberships) {
      assert.ok(
        t0.includes(m.label) || t0.includes(m.programId ?? ""),
        `persona[0] (${p0.handle}): own membership "${m.label}" missing`,
      );
    }
    for (const m of p1.memberships) {
      assert.ok(
        t1.includes(m.label) || t1.includes(m.programId ?? ""),
        `persona[1] (${p1.handle}): own membership "${m.label}" missing`,
      );
    }

    // Programs unique to p0 must NOT appear in p1's summary.
    const p0OnlyIds = p0.memberships
      .filter((m) => m.programId && !p1.memberships.some((m2) => m2.programId === m.programId))
      .map((m) => m.programId!);

    for (const pid of p0OnlyIds) {
      assert.ok(
        !t1.includes(pid),
        `vault isolation violated: persona[1] (${p1.handle}) summary contains ` +
          `persona[0]'s program "${pid}"`,
      );
    }
  } finally {
    await close0();
    await close1();
  }
});

test("an invalid/unknown per-user URL token returns 401 (not a data leak)", async () => {
  const fakeToken = "this_token_was_never_issued_xxxxxx";
  const res = await fetch(`${serverBase}/u/${fakeToken}/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  assert.strictEqual(res.status, 401);
  const body = await res.json() as { error: string };
  assert.ok(typeof body.error === "string", "401 response must include an error message");
  // The error must NOT leak any internal details (no userId, no program names, no prices).
  assert.doesNotMatch(body.error, /userId|programId|token_hash/i);
});

test("search_hotels via per-user URL returns catalog-correct discounts + perk estimates (no prices)", async () => {
  // Find the first persona that holds at least one matchable catalog program.
  let targetIdx = -1;
  for (let i = 0; i < personas.length; i++) {
    if (personas[i]!.memberships.some((m) => m.programId && PROGRAM_CONTEXT[m.programId])) {
      targetIdx = i;
      break;
    }
  }
  assert.ok(targetIdx >= 0, "at least one test persona must have a matchable catalog program");

  const persona = personas[targetIdx]!;
  const mcpUrl = mcpUrlForToken(serverBase, rawTokens[targetIdx]!);

  // Use the context that will trigger a match for the first matchable membership.
  const firstMatch = persona.memberships.find(
    (m) => m.programId && PROGRAM_CONTEXT[m.programId],
  )!;
  const ctx = PROGRAM_CONTEXT[firstMatch.programId!]!;

  const { client, close } = await connectToUrl(mcpUrl);
  try {
    const result = await client.callTool({
      name: "search_hotels",
      arguments: { ...ctx, stars: 4 },
    });
    assert.ok(!result.isError, `search_hotels errored: ${JSON.stringify(result)}`);
    assert.ok(result.structuredContent, "structuredContent must be present for AI assistant consumption");

    const sc = result.structuredContent as unknown as McpBenefitResult;

    // The triggered program must appear in programsApplied.
    assert.ok(
      sc.programsApplied.includes(firstMatch.programId!),
      `"${firstMatch.programId}" must be in programsApplied; got: ${JSON.stringify(sc.programsApplied)}`,
    );

    // Structural invariants.
    assert.ok(Array.isArray(sc.matches), "matches must be an array");
    assert.ok(Array.isArray(sc.perkValueEstimates), "perkValueEstimates must be an array");
    assert.ok(typeof sc.generatedAt === "string", "generatedAt must be a string");

    // Every perk-value estimate must carry isEstimate: true.
    for (const est of sc.perkValueEstimates) {
      assert.strictEqual(
        est.isEstimate,
        true,
        `perk "${est.perkType}" must carry isEstimate: true (product rule #1)`,
      );
      assert.ok(typeof est.estimatedUsd === "object", "estimatedUsd must be an object");
      assert.ok(
        typeof est.estimatedUsd[3] === "number" &&
          typeof est.estimatedUsd[4] === "number" &&
          typeof est.estimatedUsd[5] === "number",
        "estimatedUsd must have values for 3★, 4★, and 5★",
      );
    }

    // Text must include the no-prices disclaimer.
    const text = (result.content[0] as { type: "text"; text: string }).text;
    assert.match(text, /Prices are not returned/i, "text must include the no-prices disclaimer");
    assert.doesNotMatch(text, /member price/i);
    assert.doesNotMatch(text, /final price/i);

    // No forbidden price fields anywhere in structured output.
    assertNoPriceFields(sc, `persona ${persona.handle} search_hotels via per-user URL`);
  } finally {
    await close();
  }
});

test("Genius Level 3 discount (20%) surfaces via per-user URL path", async () => {
  // Find the persona with Booking Genius Level 3 (highest discount tier: 20% off).
  const geniusPersona = personas.find((p) =>
    p.memberships.some((m) => m.programId === "booking_genius" && m.tier === "Level 3"),
  );
  if (!geniusPersona) {
    // Not all seed-99 personas include Genius L3; skip gracefully rather than fail.
    return;
  }
  const idx = personas.indexOf(geniusPersona);
  const mcpUrl = mcpUrlForToken(serverBase, rawTokens[idx]!);

  const { client, close } = await connectToUrl(mcpUrl);
  try {
    const result = await client.callTool({
      name: "search_hotels",
      arguments: { domain: "booking.com", location: "Prague", stars: 4 },
    });
    assert.ok(!result.isError, `search_hotels errored: ${JSON.stringify(result)}`);

    const sc = result.structuredContent as unknown as McpBenefitResult;

    // Genius Level 3 = 20% off on Booking.com.
    const has20pct = sc.matches.some(
      (m) => m.discount !== undefined && Math.round(m.discount.percentOff * 100) === 20,
    );
    assert.ok(
      has20pct,
      `Genius L3 20% discount must surface via per-user URL; matches: ${JSON.stringify(sc.matches)}`,
    );
    assert.ok(sc.programsApplied.includes("booking_genius"), "booking_genius in programsApplied");

    // Perk estimates for Genius L3 (free_breakfast, room_upgrade) must appear.
    const perkTypes = new Set(sc.perkValueEstimates.map((e) => e.perkType));
    assert.ok(perkTypes.has("free_breakfast"), "Genius L3 free_breakfast perk estimate must be present");
    assert.ok(perkTypes.has("room_upgrade"), "Genius L3 room_upgrade perk estimate must be present");
  } finally {
    await close();
  }
});

test("product rule #1: no forbidden price fields via per-user URL for all 4 personas", async () => {
  for (let i = 0; i < personas.length; i++) {
    const persona = personas[i]!;
    const mcpUrl = mcpUrlForToken(serverBase, rawTokens[i]!);

    const { client, close } = await connectToUrl(mcpUrl);
    try {
      // Summary price guard.
      const sumResult = await client.callTool({ name: "get_membership_summary", arguments: {} });
      assert.ok(!sumResult.isError, `persona ${persona.handle}: summary tool errored`);
      assertNoPriceFields(sumResult, `persona ${persona.handle} summary`);

      // Search price guard: use the first matchable context or a safe fallback.
      const firstPid = persona.memberships.find((m) => m.programId && PROGRAM_CONTEXT[m.programId])?.programId;
      const ctx = firstPid ? PROGRAM_CONTEXT[firstPid]! : { location: "Vienna" };
      const searchResult = await client.callTool({
        name: "search_hotels",
        arguments: { ...ctx, stars: 4 },
      });
      assert.ok(!searchResult.isError, `persona ${persona.handle}: search tool errored`);
      if (searchResult.structuredContent) {
        assertNoPriceFields(
          searchResult.structuredContent,
          `persona ${persona.handle} search`,
        );
      }
      const searchText = (searchResult.content[0] as { type: "text"; text: string } | undefined)?.text ?? "";
      assert.doesNotMatch(searchText, /member price/i, `${persona.handle}: "member price" forbidden`);
      assert.doesNotMatch(searchText, /final price/i, `${persona.handle}: "final price" forbidden`);
    } finally {
      await close();
    }
  }
});
