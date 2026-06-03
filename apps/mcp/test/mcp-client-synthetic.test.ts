// Synthetic MCP-client tests — issue #97 / epic #14.
//
// Canonical acceptance-criteria tests for MCP-client synthetic test coverage.
// Drives a real StreamableHTTPClientTransport against a real HTTP server
// built with createRequestListener() — the same routing + auth + tools stack
// as production.
//
// Coverage (maps to AC in issue #97):
//   AC-1  Valid per-user URL happy-path: token resolves to the correct vault.
//   AC-3a Per-user URL isolation: token A never exposes user B's memberships.
//   AC-3b Invalid token (never issued) returns 401.
//   AC-3c Rotated/revoked token returns 401 after the user has regenerated
//         their MCP URL (the previously-valid token is no longer in the user
//         record — simulates POST /me/mcp-url "rotate" action from the web UI).
//   AC-2  Tool correctness: search_hotels / get_membership_summary return
//         applicable memberships / discounts / perks / perk-value estimates.
//   AC-2  No-prices contract (product rule #1 / issue #1): every tool call
//         is checked for forbidden price fields.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  getUserRepo,
  getProgram,
  instantiateBenefits,
  generateMcpToken,
  hashMcpToken,
  mcpUrlForToken,
  type User,
} from "@truerate/core";
import { createRequestListener } from "../src/http.js";
import type { McpBenefitResult } from "../src/server.js";

// ── Product rule #1: field names that must never appear in any MCP response ──

const FORBIDDEN_PRICE_FIELDS = [
  "nightlyAmount",
  "totalAmount",
  "memberPrice",
  "basePrice",
  "finalPrice",
  "indicativePrice",
  "postDiscountPrice",
  "publicOffer",
];

function assertNoPriceFields(payload: unknown, label: string): void {
  const raw = JSON.stringify(payload);
  for (const field of FORBIDDEN_PRICE_FIELDS) {
    assert.ok(
      !raw.includes(`"${field}"`),
      `${label}: forbidden price field "${field}" in MCP response (product rule #1 / issue #1)`,
    );
  }
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
  const client = new Client({ name: "truerate-synthetic-mcp-client", version: "1.0.0" });
  // No auth header needed — the URL token IS the credential (per-user URL path).
  const transport = new StreamableHTTPClientTransport(new URL(mcpUrl));
  await client.connect(transport);
  return { client, close: async () => transport.close() };
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

// Unique suffix per test run so multiple parallel CI jobs don't collide on
// the shared MemoryUserRepo (TRUERATE_INMEMORY=true keeps it in-process, but
// different test files in the same node --test run share the module singleton).
const RUN_ID = randomUUID().slice(0, 8);

let geniusUserId: string;
let geniusToken: string;
let marriottUserId: string;
let marriottToken: string;

before(async () => {
  process.env.TRUERATE_INMEMORY = "true";
  startServer();

  const repo = await getUserRepo();
  const now = new Date().toISOString();

  // User A: Booking.com Genius Level 3 — 20% discount on booking.com, plus
  // free_breakfast and room_upgrade perk estimates.
  geniusToken = generateMcpToken();
  geniusUserId = `synth-${RUN_ID}-genius`;
  const geniusProgram = getProgram("booking_genius");
  assert.ok(geniusProgram, "booking_genius program must exist in the catalog");
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
        addedAt: now,
        status: "active",
      },
    ],
    createdAt: now,
    market: "cz",
    currency: "EUR",
    mcpToken: { hash: hashMcpToken(geniusToken), createdAt: now },
  } satisfies User);

  // User B: Marriott Bonvoy Platinum — free_breakfast + room_upgrade perks on
  // Marriott-brand context; perk-only (no % discount on the Marriott match).
  marriottToken = generateMcpToken();
  marriottUserId = `synth-${RUN_ID}-marriott`;
  const marriottProgram = getProgram("marriott_bonvoy");
  assert.ok(marriottProgram, "marriott_bonvoy program must exist in the catalog");
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
        addedAt: now,
        status: "active",
      },
    ],
    createdAt: now,
    market: "at",
    currency: "EUR",
    mcpToken: { hash: hashMcpToken(marriottToken), createdAt: now },
  } satisfies User);
});

after(async () => {
  await new Promise<void>((res, rej) => srv.close((e) => (e ? rej(e) : res())));
});

// ── AC-1: Valid per-user URL happy-path ───────────────────────────────────────

test("synthetic AC-1: valid per-user URL resolves to the token owner's vault", async () => {
  const { client, close } = await connectToUrl(mcpUrlForToken(serverBase, geniusToken));
  try {
    const result = await client.callTool({ name: "get_membership_summary", arguments: {} });
    assert.ok(!result.isError, `tool errored: ${JSON.stringify(result)}`);
    const text = (result.content[0] as { type: "text"; text: string }).text;
    assert.match(text, /Booking\.com Genius/i, "Genius membership must appear in summary");
    assert.doesNotMatch(text, /Marriott Bonvoy/i, "must not expose the other user's memberships");
  } finally {
    await close();
  }
});

// ── AC-3a: Per-user URL isolation ─────────────────────────────────────────────

test("synthetic AC-3a: per-user URLs are isolated — token A never returns token B's memberships", async () => {
  const { client: cA, close: closeA } = await connectToUrl(mcpUrlForToken(serverBase, geniusToken));
  const { client: cB, close: closeB } = await connectToUrl(mcpUrlForToken(serverBase, marriottToken));
  try {
    const [rA, rB] = await Promise.all([
      cA.callTool({ name: "get_membership_summary", arguments: {} }),
      cB.callTool({ name: "get_membership_summary", arguments: {} }),
    ]);
    const tA = (rA.content[0] as { type: "text"; text: string }).text;
    const tB = (rB.content[0] as { type: "text"; text: string }).text;
    // User A sees Genius but not Marriott.
    assert.match(tA, /Booking\.com Genius/i, "token A must return Genius membership");
    assert.doesNotMatch(tA, /Marriott Bonvoy/i, "token A must not expose Marriott membership");
    // User B sees Marriott but not Genius.
    assert.match(tB, /Marriott Bonvoy/i, "token B must return Marriott membership");
    assert.doesNotMatch(tB, /Booking\.com Genius/i, "token B must not expose Genius membership");
  } finally {
    await closeA();
    await closeB();
  }
});

// ── AC-3b: Invalid token (never issued) ──────────────────────────────────────

test("synthetic AC-3b: invalid (never-issued) per-user URL token returns 401", async () => {
  const res = await fetch(`${serverBase}/u/this_token_was_never_issued_xxxx/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  assert.strictEqual(res.status, 401, "invalid token must return 401");
  const body = (await res.json()) as { error: string };
  assert.ok(typeof body.error === "string", "401 response must include an error message");
  assert.doesNotMatch(body.error, /userId|programId|token_hash/i, "error must not leak internals");
});

// ── AC-3c: Rotated/revoked token ──────────────────────────────────────────────
//
// Simulates the "rotate MCP URL" action from the web UI (POST /me/mcp-url).
// After rotation the old token (T1) must be rejected; the new token (T2) must
// succeed. This is the key gap vs. the "never-issued" case above.

test("synthetic AC-3c: revoked/rotated token returns 401 after token rotation", async () => {
  const repo = await getUserRepo();
  const now = new Date().toISOString();

  // 1. Create a user with token T1.
  const tokenT1 = generateMcpToken();
  const rotateUserId = `synth-${RUN_ID}-rotate`;
  await repo.create({
    id: rotateUserId,
    email: `${rotateUserId}@example.com`,
    passwordHash: "placeholder",
    memberships: [],
    createdAt: now,
    market: "cz",
    currency: "EUR",
    mcpToken: { hash: hashMcpToken(tokenT1), createdAt: now },
  } satisfies User);

  // 2. T1 must be valid before rotation.
  const beforeRotation = await fetch(`${serverBase}/u/${tokenT1}/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  assert.notEqual(beforeRotation.status, 401, "T1 must be valid before rotation");

  // 3. Rotate: replace T1's hash with T2's hash in the user record.
  //    This mirrors what POST /me/mcp-url does in the API layer.
  const tokenT2 = generateMcpToken();
  const user = await repo.getById(rotateUserId);
  assert.ok(user, "user must exist");
  await repo.update({
    ...user,
    mcpToken: { hash: hashMcpToken(tokenT2), createdAt: new Date().toISOString() },
  });

  // 4. T1 is now revoked — must return 401.
  const afterRotationT1 = await fetch(`${serverBase}/u/${tokenT1}/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  assert.strictEqual(afterRotationT1.status, 401, "revoked T1 must return 401 after rotation");
  const body = (await afterRotationT1.json()) as { error: string };
  assert.ok(typeof body.error === "string", "401 response must include an error message");

  // 5. T2 (the new token) must now work.
  const afterRotationT2 = await fetch(`${serverBase}/u/${tokenT2}/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  assert.notEqual(afterRotationT2.status, 401, "T2 (token after rotation) must be valid");
});

// ── AC-2: Tool correctness + no-prices contract ───────────────────────────────

test("synthetic AC-2: search_hotels returns 20% Genius discount + no prices in structuredContent", async () => {
  const { client, close } = await connectToUrl(mcpUrlForToken(serverBase, geniusToken));
  try {
    const result = await client.callTool({
      name: "search_hotels",
      arguments: { domain: "booking.com", location: "Prague", stars: 4 },
    });
    assert.ok(!result.isError, `tool errored: ${JSON.stringify(result)}`);
    assert.ok(result.structuredContent, "structuredContent required for AI assistant consumption");

    const sc = result.structuredContent as unknown as McpBenefitResult;
    assert.ok(Array.isArray(sc.matches), "matches must be an array");
    assert.ok(typeof sc.generatedAt === "string", "generatedAt must be present");
    assert.ok(typeof sc.context === "object", "context must be present");

    const has20pct = sc.matches.some(
      (m) => m.discount !== undefined && Math.round(m.discount.percentOff * 100) === 20,
    );
    assert.ok(has20pct, `Genius L3 20% discount must be in matches; got: ${JSON.stringify(sc.matches)}`);
    assert.ok(
      sc.programsApplied.includes("booking_genius"),
      `booking_genius must be in programsApplied; got: ${JSON.stringify(sc.programsApplied)}`,
    );

    const text = (result.content[0] as { type: "text"; text: string }).text;
    assert.match(text, /Prices are not returned/i, "no-prices disclaimer must be in formatted text");
    assertNoPriceFields(sc, "search_hotels (Genius Level 3)");
  } finally {
    await close();
  }
});

test("synthetic AC-2: search_hotels returns Marriott Platinum perks (perk-only, no % discount) with no prices", async () => {
  const { client, close } = await connectToUrl(mcpUrlForToken(serverBase, marriottToken));
  try {
    const result = await client.callTool({
      name: "search_hotels",
      arguments: { brand: "Marriott", location: "Vienna", stars: 5 },
    });
    assert.ok(!result.isError, `tool errored: ${JSON.stringify(result)}`);
    const sc = result.structuredContent as unknown as McpBenefitResult;

    const hasBreakfast = sc.matches.some((m) => m.perks.some((p) => /breakfast/i.test(p)));
    assert.ok(hasBreakfast, `free_breakfast perk must appear; got: ${JSON.stringify(sc.matches)}`);

    const marriottMatch = sc.matches.find((m) => /Marriott/i.test(m.membershipLabel));
    assert.ok(marriottMatch, "Marriott match must be present");
    assert.strictEqual(
      marriottMatch!.discount,
      undefined,
      "perk-only tier must not carry a % discount",
    );

    assertNoPriceFields(sc, "search_hotels (Marriott Platinum)");
  } finally {
    await close();
  }
});

test("synthetic AC-2: perkValueEstimates carry isEstimate:true and 3★/4★/5★ band values", async () => {
  const { client, close } = await connectToUrl(mcpUrlForToken(serverBase, marriottToken));
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
      // Perk estimates are value bands only — never raw prices.
      assertNoPriceFields(est, `perkValueEstimate (${est.perkType})`);
    }
  } finally {
    await close();
  }
});

test("synthetic AC-2: get_membership_summary returns memberships with discount/perk lines and no prices", async () => {
  const { client, close } = await connectToUrl(mcpUrlForToken(serverBase, geniusToken));
  try {
    const result = await client.callTool({ name: "get_membership_summary", arguments: {} });
    assert.ok(!result.isError, `tool errored: ${JSON.stringify(result)}`);
    const text = (result.content[0] as { type: "text"; text: string }).text;

    assert.match(text, /Memberships & benefits:/i, "summary header must appear");
    assert.match(text, /Booking\.com Genius/i, "membership label must appear");
    assert.match(text, /20% off/i, "Genius Level 3 discount must be summarised");
    assert.doesNotMatch(text, /member price/i, "summary must not use 'member price' language");
    assert.doesNotMatch(text, /post.discount/i, "summary must not reference post-discount prices");
    assert.doesNotMatch(text, /final price/i, "summary must not reference final prices");

    assertNoPriceFields(result, "get_membership_summary (Genius)");
  } finally {
    await close();
  }
});

test("synthetic AC-2: no-prices contract holds across multiple contexts and access patterns", async () => {
  const cases: Array<{ token: string; args: Record<string, unknown>; label: string }> = [
    { token: geniusToken, args: { domain: "booking.com", location: "Prague" }, label: "Genius/domain" },
    { token: marriottToken, args: { brand: "Marriott", location: "Vienna", stars: 4 }, label: "Marriott/brand+stars" },
    { token: geniusToken, args: { hotel: "Grand Hotel Prague", stars: 5 }, label: "Genius/hotel-name" },
    { token: marriottToken, args: { location: "Vienna" }, label: "Marriott/location-only" },
    { token: geniusToken, args: { brand: "Hilton", location: "Prague" }, label: "Genius/non-matching-brand" },
  ];

  for (const { token, args, label } of cases) {
    const { client, close } = await connectToUrl(mcpUrlForToken(serverBase, token));
    try {
      const result = await client.callTool({ name: "search_hotels", arguments: args });
      assert.ok(!result.isError, `${label}: search_hotels tool errored`);
      if (result.structuredContent) {
        assertNoPriceFields(result.structuredContent, `search_hotels (${label})`);
      }
      const text = (result.content[0] as { type: "text"; text: string }).text;
      assert.match(
        text,
        /Prices are not returned/i,
        `${label}: no-prices disclaimer must be present in formatted text`,
      );
    } finally {
      await close();
    }
  }
});
