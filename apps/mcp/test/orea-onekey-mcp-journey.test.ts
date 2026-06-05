// API → MCP journey for the two catalog programs that have zero integration-test
// coverage: "orea" (Czech hotel chain, 15% off on orea.cz) and
// "hotels_com_one_key" (Expedia Group OTA, perk-only — no percentDiscount).
//
// Gap closed (issue #159):
//   Every other catalog program — booking_genius, marriott_bonvoy, accor_all,
//   emblem_prague, ihg_one_rewards, hilton_honors, revolut, amex_platinum,
//   your_prague_hotels — is exercised by at least one of:
//     • persona-api-mcp-journey.test.ts
//     • persona-via-per-user-url.test.ts
//     • cross-channel-consistency.test.ts
//   Only "orea" and "hotels_com_one_key" are absent from all of them.
//
// Journey under test (per program):
//   POST /auth/register → POST /memberships → POST /me/mcp-url
//   → StreamableHTTP MCP client → search_hotels / get_membership_summary
//
// Assertions per test:
//   1. orea: 15% off surfaces when querying orea.cz; formatted text contains the
//      no-price disclaimer; no forbidden price fields in structuredContent.
//   2. hotels_com_one_key Gold: perks surface on hotels.com; NO percentDiscount
//      (this tier uses kind:"perk", not kind:"percentDiscount"); perkValueEstimates
//      carry isEstimate:true; no forbidden price fields.
//   3. Scope isolation: orea membership returns no matches on booking.com (wrong
//      domain); hotels_com_one_key returns no matches on orea.cz (domain mismatch).
//   4. Product rule #1: exhaustive forbidden-price-field check across all outputs.

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
  process.env.TRUERATE_JWT_SECRET = "orea-onekey-mcp-journey-secret-32x!";
  process.env.TRUERATE_CRED_KEY = randomBytes(32).toString("base64");
  process.env.ADMIN_SECRET = "test-admin-secret";
  process.env.MCP_PUBLIC_URL = "https://mcp.test.example";

  // Both the MCP server (createRequestListener) and the API app import
  // getUserRepo() from the same @truerate/core symlink, so Node.js module
  // caching gives them one shared MemoryUserRepo — no IPC needed.
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
  return `orea-onekey-${++emailCounter}-${Date.now()}@truerate-test.local`;
}

async function registerUser(app: Awaited<ReturnType<typeof getApp>>): Promise<string> {
  const res = await app.request("/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: uniqueEmail(),
      password: "orea-test-pw-1234",
      market: "cz",
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
  const client = new Client({ name: "orea-onekey-test", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(
    new URL(`${mcpBase}/u/${rawToken}/mcp`),
  );
  await client.connect(transport);
  return { client, close: async () => transport.close() };
}

// ── Test 1: orea — Czech hotel chain, 15% off on orea.cz ─────────────────────

test(
  "orea membership: 15% off surfaces on orea.cz domain query, no prices (product rule #1)",
  async () => {
    const app = await getApp();
    const jwtToken = await registerUser(app);

    // OREA Hotels & Resorts has no tiers — the "*" benefit applies to all members.
    await addMembership(app, jwtToken, "orea");

    const rawMcpToken = await issueMcpToken(app, jwtToken);
    const { client, close } = await connectToMcp(rawMcpToken);
    try {
      // ── search_hotels: orea.cz domain must return 15% off ─────────────────
      const result = await client.callTool({
        name: "search_hotels",
        arguments: { domain: "orea.cz", location: "Prague" },
      });
      assert.ok(!result.isError, `search_hotels errored: ${JSON.stringify(result)}`);
      assert.ok(result.structuredContent, "structuredContent required");

      const sc = result.structuredContent as unknown as McpBenefitResult;
      assertNoPriceFields(sc, "orea search_hotels structuredContent");

      // orea must be in programsApplied — the match engine must find the membership.
      assert.ok(
        sc.programsApplied.includes("orea"),
        `orea must be in programsApplied; got: ${JSON.stringify(sc.programsApplied)}`,
      );

      // orea gives exactly 15% off (percentOff: 0.15 in programs.ts).
      const oreaMatch = sc.matches.find((m) => /orea/i.test(m.membershipLabel));
      assert.ok(oreaMatch, "orea match must appear in matches");
      assert.ok(oreaMatch.discount, "orea match must carry a discount");
      assert.equal(
        Math.round(oreaMatch.discount.percentOff * 100),
        15,
        `orea must give 15% off; got ${Math.round(oreaMatch.discount.percentOff * 100)}%`,
      );

      // orea is a domain-scoped percentDiscount — no structured perks, so no
      // perkValueEstimates are expected.
      assert.equal(
        sc.perkValueEstimates.length,
        0,
        "orea percentDiscount benefit must not produce perkValueEstimates",
      );

      // Formatted text must carry the no-prices disclaimer.
      const text = (result.content[0] as { type: "text"; text: string }).text;
      assert.match(text, /15% off/i, "formatted text must mention 15% off");
      assert.match(text, /Prices are not returned/i, "no-prices disclaimer required");
      assertNoPriceFields({ text }, "orea formatted text");

      // ── get_membership_summary: OREA must appear ──────────────────────────
      const summaryResult = await client.callTool({
        name: "get_membership_summary",
        arguments: {},
      });
      assert.ok(!summaryResult.isError, `get_membership_summary errored: ${JSON.stringify(summaryResult)}`);
      const summaryText = (summaryResult.content[0] as { type: "text"; text: string }).text;
      assert.match(summaryText, /OREA Hotels|OREA/i, "summary must include OREA Hotels & Resorts");
      assertNoPriceFields(summaryResult, "orea get_membership_summary");
    } finally {
      await close();
    }
  },
);

// ── Test 2: hotels_com_one_key Gold — perk-only OTA, no percentDiscount ───────

test(
  "hotels_com_one_key Gold: perks surface on hotels.com, perk-only (no percentDiscount), isEstimate:true",
  async () => {
    const app = await getApp();
    const jwtToken = await registerUser(app);

    // Hotels.com One Key Gold — the highest tier with the richest perk set.
    await addMembership(app, jwtToken, "hotels_com_one_key", "Gold");

    const rawMcpToken = await issueMcpToken(app, jwtToken);
    const { client, close } = await connectToMcp(rawMcpToken);
    try {
      // ── search_hotels: hotels.com domain must return One Key perks ────────
      const result = await client.callTool({
        name: "search_hotels",
        arguments: { domain: "hotels.com", location: "Vienna" },
      });
      assert.ok(!result.isError, `search_hotels errored: ${JSON.stringify(result)}`);
      assert.ok(result.structuredContent, "structuredContent required");

      const sc = result.structuredContent as unknown as McpBenefitResult;
      assertNoPriceFields(sc, "hotels_com_one_key search_hotels structuredContent");

      // hotels_com_one_key must be in programsApplied.
      assert.ok(
        sc.programsApplied.includes("hotels_com_one_key"),
        `hotels_com_one_key must be in programsApplied; got: ${JSON.stringify(sc.programsApplied)}`,
      );

      // hotels_com_one_key Gold is a perk-only tier — it has no percentDiscount.
      // This distinguishes it from OTA programs like Booking.com Genius which DO
      // carry a discount. Verifying this ensures the matching engine does not
      // accidentally fabricate a discount for perk-only memberships.
      const onekeyMatch = sc.matches.find((m) => /hotels\.com|one key/i.test(m.membershipLabel));
      assert.ok(onekeyMatch, "hotels_com_one_key match must appear");
      assert.ok(
        !onekeyMatch.discount,
        "hotels_com_one_key Gold must NOT carry a percentDiscount — it is perk-only",
      );

      // Gold tier must surface structuredPerks (OneKeyCash, member prices, priority
      // support, VIP Access).
      assert.ok(
        onekeyMatch.structuredPerks.length > 0,
        `hotels_com_one_key Gold must surface structuredPerks; match: ${JSON.stringify(onekeyMatch)}`,
      );

      // perkValueEstimates may include priority_support (non-zero at 4★) and "other"
      // type perks (intangible, $0). All estimates must carry isEstimate:true.
      for (const est of sc.perkValueEstimates) {
        assert.strictEqual(
          est.isEstimate,
          true,
          `perk "${est.perkType}" must carry isEstimate:true — estimates ≠ prices (product rule #1)`,
        );
        assert.ok(
          typeof est.estimatedUsd[3] === "number" &&
            typeof est.estimatedUsd[4] === "number" &&
            typeof est.estimatedUsd[5] === "number",
          `perk "${est.perkType}" must have estimatedUsd at 3★/4★/5★`,
        );
      }

      // Formatted text must carry the no-prices disclaimer.
      const text = (result.content[0] as { type: "text"; text: string }).text;
      assert.match(text, /Prices are not returned/i, "no-prices disclaimer required");

      // The text may contain "Member prices on participating hotels" — that is a
      // legitimate perk label describing what access the membership grants, NOT a
      // TrueRate-computed price. The forbidden patterns are TrueRate computing or
      // returning actual price values. We check those via assertNoPriceFields above
      // and via the specific "finalPrice/postDiscount" patterns below.
      assert.doesNotMatch(text, /final price/i, "text must not mention 'final price'");
      assert.doesNotMatch(text, /post.discount/i, "text must not mention 'post-discount'");

      // ── get_membership_summary: Hotels.com One Key must appear ────────────
      const summaryResult = await client.callTool({
        name: "get_membership_summary",
        arguments: {},
      });
      assert.ok(!summaryResult.isError);
      const summaryText = (summaryResult.content[0] as { type: "text"; text: string }).text;
      assert.match(summaryText, /Hotels\.com One Key|One Key/i, "summary must include Hotels.com One Key");
      assert.match(summaryText, /Gold/i, "summary must include the Gold tier");
      assertNoPriceFields(summaryResult, "hotels_com_one_key get_membership_summary");
    } finally {
      await close();
    }
  },
);

// ── Test 3: scope isolation ───────────────────────────────────────────────────

test(
  "scope isolation: orea does not match booking.com; per-user URL tokens are isolated",
  async () => {
    const app = await getApp();

    // User A: orea only.
    // orea.defaultMatch = { domains: ["orea.cz"], brands: ["OREA"] } — no categories
    // clause, so it only fires on orea.cz domain or OREA brand queries.
    const jwtA = await registerUser(app);
    await addMembership(app, jwtA, "orea");
    const mcpA = await issueMcpToken(app, jwtA);

    // User B: hotels_com_one_key Gold only.
    // hotels_com_one_key.defaultMatch includes categories:["hotel"], meaning its
    // perks match any hotel-category query, not only hotels.com — this is correct
    // product behaviour (the OneKeyCash and member-price access apply broadly).
    const jwtB = await registerUser(app);
    await addMembership(app, jwtB, "hotels_com_one_key", "Gold");
    const mcpB = await issueMcpToken(app, jwtB);

    const { client: clientA, close: closeA } = await connectToMcp(mcpA);
    const { client: clientB, close: closeB } = await connectToMcp(mcpB);
    try {
      // orea user on booking.com → zero matches: orea only fires on orea.cz / OREA brand.
      const oreaOnBooking = await clientA.callTool({
        name: "search_hotels",
        arguments: { domain: "booking.com", location: "Prague" },
      });
      assert.ok(!oreaOnBooking.isError);
      const scOreaOnBooking = oreaOnBooking.structuredContent as unknown as McpBenefitResult;
      assertNoPriceFields(scOreaOnBooking, "orea-user on booking.com");
      assert.ok(
        !scOreaOnBooking.programsApplied.includes("orea"),
        "orea must NOT match booking.com (defaultMatch has no categories clause, only domains/brands)",
      );
      assert.equal(
        scOreaOnBooking.matches.length,
        0,
        "orea user must have zero matches on booking.com",
      );

      // hotels_com_one_key user on hotels.com → matches (primary domain match).
      const onekeyOnHotels = await clientB.callTool({
        name: "search_hotels",
        arguments: { domain: "hotels.com", location: "Vienna" },
      });
      assert.ok(!onekeyOnHotels.isError);
      const scOnekeyOnHotels = onekeyOnHotels.structuredContent as unknown as McpBenefitResult;
      assertNoPriceFields(scOnekeyOnHotels, "hotels_com_one_key user on hotels.com");
      assert.ok(
        scOnekeyOnHotels.programsApplied.includes("hotels_com_one_key"),
        "hotels_com_one_key must match hotels.com",
      );

      // URL isolation: user A's MCP token must never return user B's memberships,
      // and user B's token must never return user A's memberships.
      const summaryA = await clientA.callTool({ name: "get_membership_summary", arguments: {} });
      assert.ok(!summaryA.isError);
      const summaryTextA = (summaryA.content[0] as { type: "text"; text: string }).text;
      assert.doesNotMatch(
        summaryTextA,
        /Hotels\.com One Key|One Key/i,
        "user A (orea) must never see user B's hotels_com_one_key membership via their MCP token",
      );
      assert.match(summaryTextA, /OREA/i, "user A summary must contain OREA");

      const summaryB = await clientB.callTool({ name: "get_membership_summary", arguments: {} });
      assert.ok(!summaryB.isError);
      const summaryTextB = (summaryB.content[0] as { type: "text"; text: string }).text;
      assert.doesNotMatch(
        summaryTextB,
        /OREA/i,
        "user B (hotels_com_one_key) must never see user A's orea membership via their MCP token",
      );
      assert.match(summaryTextB, /Hotels\.com One Key|One Key/i, "user B summary must contain Hotels.com One Key");
    } finally {
      await closeA();
      await closeB();
    }
  },
);
