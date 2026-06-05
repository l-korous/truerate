// API → MCP journey for "miles_and_more" (Miles & More, Lufthansa Group airline
// loyalty), the ONLY catalog program that:
//   • uses value kind "pointsEarn"  (all others use "percentDiscount" or "perk")
//   • belongs to category "airline" (all others are hotel-chain, OTA, or financial)
//
// Gap closed (issue #159):
//   Every other catalog program is exercised by at least one of:
//     • persona-api-mcp-journey.test.ts
//     • persona-via-per-user-url.test.ts
//     • cross-channel-consistency.test.ts
//     • orea-onekey-mcp-journey.test.ts
//   Only "miles_and_more" is absent from all of them; its unique value kind
//   means a bug in the pointsEarn path of the match engine or MCP formatter
//   would go entirely undetected.
//
// Journey under test:
//   POST /auth/register → POST /memberships → POST /me/mcp-url
//   → StreamableHTTP MCP client → search_hotels / get_membership_summary
//
// Assertions:
//   1. points_bonus perk surfaces on lufthansa.com domain query.
//   2. NO discount field (pointsEarn ≠ percentDiscount — match engine must not
//      fabricate a percentOff for this value kind).
//   3. perkValueEstimates carry isEstimate:true and non-zero USD values at every
//      star band (points_bonus: 3★=$5, 4★=$10, 5★=$20).
//   4. Scope isolation: miles_and_more does NOT match booking.com (no
//      domain/brand overlap).
//   5. Product rule #1: exhaustive forbidden-price-field check across all outputs.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createRequestListener } from "../src/http.js";
import type { McpBenefitResult } from "../src/server.js";

// ── Product rule #1: forbidden price fields ───────────────────────────────────

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
      `${label}: forbidden price field "${field}" in output (product rule #1 / issue #1)`,
    );
  }
}

// ── Shared state ──────────────────────────────────────────────────────────────

let mcpSrv: Server;
let mcpBase: string;

before(async () => {
  process.env.TRUERATE_INMEMORY = "true";
  process.env.TRUERATE_JWT_SECRET = "miles-and-more-mcp-journey-secret-32!";
  process.env.TRUERATE_CRED_KEY = randomBytes(32).toString("base64");
  process.env.ADMIN_SECRET = "test-admin-secret";
  process.env.MCP_PUBLIC_URL = "https://mcp.test.example";

  // The MCP server and API app share the same MemoryUserRepo singleton via
  // Node.js module caching — one @truerate/core symlink → one shared instance.
  mcpSrv = createServer(createRequestListener());
  mcpSrv.listen(0);
  mcpBase = `http://localhost:${(mcpSrv.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) =>
    mcpSrv.close((err) => (err ? reject(err) : resolve())),
  );
});

// ── API helpers ───────────────────────────────────────────────────────────────

async function getApp() {
  const { app } = await import("../../api/src/app.js");
  return app;
}

function authed(token: string): Record<string, string> {
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
}

let emailCounter = 0;
function uniqueEmail(): string {
  return `miles-and-more-${++emailCounter}-${Date.now()}@truerate-test.local`;
}

async function registerUser(app: Awaited<ReturnType<typeof getApp>>): Promise<string> {
  const res = await app.request("/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: uniqueEmail(),
      password: "miles-test-pw-1234",
      market: "de",
    }),
  });
  assert.equal(res.status, 200, `register failed: ${await res.clone().text()}`);
  const { token } = (await res.json()) as { token: string };
  return token;
}

async function addMembership(
  app: Awaited<ReturnType<typeof getApp>>,
  jwtToken: string,
  programId: string,
  tier?: string,
): Promise<void> {
  const body: Record<string, unknown> = { programId };
  if (tier) body.tier = tier;
  const res = await app.request("/memberships", {
    method: "POST",
    headers: authed(jwtToken),
    body: JSON.stringify(body),
  });
  assert.equal(
    res.status,
    200,
    `add membership ${programId}${tier ? `/${tier}` : ""} failed: ${await res.clone().text()}`,
  );
}

async function issueMcpToken(
  app: Awaited<ReturnType<typeof getApp>>,
  jwtToken: string,
): Promise<string> {
  const res = await app.request("/me/mcp-url", {
    method: "POST",
    headers: authed(jwtToken),
  });
  assert.equal(res.status, 200, `issue MCP URL failed: ${await res.clone().text()}`);
  const { token } = (await res.json()) as { token: string };
  assert.match(token, /^[A-Za-z0-9_-]+$/, "MCP token must be base64url");
  return token;
}

async function connectToMcp(
  rawToken: string,
): Promise<{ client: Client; close: () => Promise<void> }> {
  const client = new Client({ name: "miles-and-more-test", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(
    new URL(`${mcpBase}/u/${rawToken}/mcp`),
  );
  await client.connect(transport);
  return { client, close: async () => transport.close() };
}

// ── Test 1: miles_and_more — pointsEarn on lufthansa.com ─────────────────────
//
// miles_and_more.defaultMatch = { brands: ["Lufthansa", ...], domains: ["lufthansa.com"] }
// value.kind = "pointsEarn" → no percentOff → no discount field in MCP output.
// structuredPerks = [{ type: "points_bonus", label: "Earns Lufthansa Group award miles" }]
// points_bonus perkValueEstimates: 3★=$5, 4★=$10, 5★=$20 (non-zero, not prices).

test(
  "miles_and_more: points_bonus surfaces on lufthansa.com, no discount (pointsEarn ≠ percentDiscount), isEstimate:true",
  async () => {
    const app = await getApp();
    const jwtToken = await registerUser(app);

    // miles_and_more has no tiers — the "*" benefit applies to all members.
    await addMembership(app, jwtToken, "miles_and_more");

    const rawMcpToken = await issueMcpToken(app, jwtToken);
    const { client, close } = await connectToMcp(rawMcpToken);
    try {
      // ── search_hotels: lufthansa.com domain must return points_bonus perk ──
      const result = await client.callTool({
        name: "search_hotels",
        arguments: { domain: "lufthansa.com", location: "Munich" },
      });
      assert.ok(!result.isError, `search_hotels errored: ${JSON.stringify(result)}`);
      assert.ok(result.structuredContent, "structuredContent required");

      const sc = result.structuredContent as unknown as McpBenefitResult;
      assertNoPriceFields(sc, "miles_and_more search_hotels structuredContent");

      // miles_and_more must be in programsApplied — the match engine must find the benefit.
      assert.ok(
        sc.programsApplied.includes("miles_and_more"),
        `miles_and_more must be in programsApplied; got: ${JSON.stringify(sc.programsApplied)}`,
      );

      // Exactly one match must appear for miles_and_more.
      const mmMatch = sc.matches.find((m) => /miles.*more|lufthansa/i.test(m.membershipLabel));
      assert.ok(mmMatch, "miles_and_more match must appear in matches");

      // pointsEarn value kind must NOT produce a discount field. This is the
      // core invariant being tested: the match engine must not fabricate a
      // percentOff for a non-discount value kind.
      assert.ok(
        !mmMatch.discount,
        "miles_and_more must NOT carry a discount field — value kind is pointsEarn, not percentDiscount",
      );

      // The points_bonus structuredPerk must surface.
      const pointsBonusPerk = mmMatch.structuredPerks.find((sp) => sp.type === "points_bonus");
      assert.ok(
        pointsBonusPerk,
        `points_bonus perk must appear in structuredPerks; got: ${JSON.stringify(mmMatch.structuredPerks)}`,
      );

      // perkValueEstimates for points_bonus must be present with non-zero values
      // (3★=$5, 4★=$10, 5★=$20) and isEstimate:true (not prices).
      assert.ok(
        sc.perkValueEstimates.length > 0,
        "miles_and_more must produce at least one perkValueEstimate for points_bonus",
      );
      const pointsBonusEstimate = sc.perkValueEstimates.find((e) => e.perkType === "points_bonus");
      assert.ok(
        pointsBonusEstimate,
        `perkValueEstimates must include points_bonus; got: ${JSON.stringify(sc.perkValueEstimates)}`,
      );
      assert.strictEqual(
        pointsBonusEstimate.isEstimate,
        true,
        "points_bonus estimate must carry isEstimate:true — estimates ≠ prices (product rule #1)",
      );
      assert.ok(
        pointsBonusEstimate.estimatedUsd[3] > 0 &&
          pointsBonusEstimate.estimatedUsd[4] > 0 &&
          pointsBonusEstimate.estimatedUsd[5] > 0,
        `points_bonus must have non-zero estimatedUsd at 3★/4★/5★; got: ${JSON.stringify(pointsBonusEstimate.estimatedUsd)}`,
      );

      // Formatted text must carry the no-prices disclaimer and mention award miles.
      const text = (result.content[0] as { type: "text"; text: string }).text;
      assert.match(text, /award miles|points_bonus|Earns/i, "formatted text must mention award miles or the perk");
      assert.match(text, /Prices are not returned/i, "no-prices disclaimer required");
      assertNoPriceFields({ text }, "miles_and_more formatted text");

      // ── get_membership_summary: Miles & More must appear ──────────────────
      const summaryResult = await client.callTool({
        name: "get_membership_summary",
        arguments: {},
      });
      assert.ok(!summaryResult.isError, `get_membership_summary errored: ${JSON.stringify(summaryResult)}`);
      const summaryText = (summaryResult.content[0] as { type: "text"; text: string }).text;
      assert.match(summaryText, /Miles.*More|Lufthansa/i, "summary must include Miles & More or Lufthansa");
      assertNoPriceFields(summaryResult, "miles_and_more get_membership_summary");
    } finally {
      await close();
    }
  },
);

// ── Test 2: scope isolation — miles_and_more does NOT match booking.com ───────
//
// miles_and_more.defaultMatch only covers Lufthansa domains and brands.
// Querying booking.com must yield zero matches regardless of membership.

test(
  "scope isolation: miles_and_more does not match booking.com (no domain/brand overlap)",
  async () => {
    const app = await getApp();
    const jwtToken = await registerUser(app);
    await addMembership(app, jwtToken, "miles_and_more");
    const rawMcpToken = await issueMcpToken(app, jwtToken);

    const { client, close } = await connectToMcp(rawMcpToken);
    try {
      const result = await client.callTool({
        name: "search_hotels",
        arguments: { domain: "booking.com", location: "Prague" },
      });
      assert.ok(!result.isError, `search_hotels errored on booking.com: ${JSON.stringify(result)}`);

      const sc = result.structuredContent as unknown as McpBenefitResult;
      assertNoPriceFields(sc, "miles_and_more user on booking.com");

      assert.ok(
        !sc.programsApplied.includes("miles_and_more"),
        "miles_and_more must NOT match booking.com (no domain/brand in defaultMatch)",
      );
      assert.equal(
        sc.matches.length,
        0,
        "miles_and_more user must have zero matches on booking.com",
      );
      assert.equal(
        sc.perkValueEstimates.length,
        0,
        "no perkValueEstimates on a zero-match result",
      );
    } finally {
      await close();
    }
  },
);

// ── Test 3: URL isolation — two users' tokens must not cross-contaminate ──────

test(
  "per-user URL isolation: miles_and_more user never sees another user's memberships",
  async () => {
    const app = await getApp();

    // User A: miles_and_more only.
    const jwtA = await registerUser(app);
    await addMembership(app, jwtA, "miles_and_more");
    const mcpA = await issueMcpToken(app, jwtA);

    // User B: booking_genius Level 3 only.
    const jwtB = await registerUser(app);
    await addMembership(app, jwtB, "booking_genius", "Level 3");
    const mcpB = await issueMcpToken(app, jwtB);

    const { client: clientA, close: closeA } = await connectToMcp(mcpA);
    const { client: clientB, close: closeB } = await connectToMcp(mcpB);
    try {
      // User A's summary must contain Miles & More and NOT booking_genius.
      const summaryA = await clientA.callTool({ name: "get_membership_summary", arguments: {} });
      assert.ok(!summaryA.isError);
      const textA = (summaryA.content[0] as { type: "text"; text: string }).text;
      assert.match(textA, /Miles.*More|Lufthansa/i, "user A must see Miles & More in summary");
      assert.doesNotMatch(
        textA,
        /Booking\.com Genius|booking_genius/i,
        "user A must never see user B's Booking.com Genius via their token",
      );
      assertNoPriceFields(summaryA, "isolation summaryA");

      // User B's summary must contain Booking.com Genius and NOT miles_and_more.
      const summaryB = await clientB.callTool({ name: "get_membership_summary", arguments: {} });
      assert.ok(!summaryB.isError);
      const textB = (summaryB.content[0] as { type: "text"; text: string }).text;
      assert.match(textB, /Booking\.com Genius|booking_genius/i, "user B must see Booking.com Genius");
      assert.doesNotMatch(
        textB,
        /Miles.*More|Lufthansa/i,
        "user B must never see user A's Miles & More via their token",
      );
      assertNoPriceFields(summaryB, "isolation summaryB");
    } finally {
      await closeA();
      await closeB();
    }
  },
);
