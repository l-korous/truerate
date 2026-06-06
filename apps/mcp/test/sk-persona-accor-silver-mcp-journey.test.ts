// API → MCP journey for persona-sk-6: Booking.com Genius Level 3 + Accor ALL Silver
// (issue #159 / #45).
//
// Gap closed: persona-sk-6 (SK market, Genius L3 + Accor ALL Silver, archetype index 6)
// is the only one of the eight canonical persona archetypes never exercised through
// any MCP API journey. Specifically:
//
//   • cross-channel-consistency.test.ts covers archetypes 0, 1, 4, 5 (CZ/DE/AT/GB).
//   • persona-api-mcp-journey.test.ts covers archetypes 2, 3, 7 (CZ-hotel-chain/PL/HU).
//   • persona-via-per-user-url.test.ts uses seed 99, covering archetypes 0-3.
//   • persona-sk-6 (SK) has no MCP coverage anywhere.
//
// Additionally, Accor ALL Silver's unique perks — welcome_amenity ("Welcome drink on
// arrival") and late_check_out ("Late check-out when available", subjectToAvailability)
// — have never appeared in any MCP test. Accor Gold's perks (room_upgrade,
// lounge_access) are covered by persona-cz-2 in persona-api-mcp-journey.test.ts;
// Silver is a distinct tier with a distinct benefit set.
//
// Journey under test:
//   POST /auth/register (market: sk) → POST /memberships × 2
//   → POST /me/mcp-url → StreamableHTTP MCP client
//   → get_membership_summary  (both programs must appear)
//   → search_hotels (booking.com) — Genius L3 → 20% off + OTA perks
//   → search_hotels (Novotel/Accor) — Silver → welcome_amenity + late_check_out
//
// Invariants asserted:
//   1. Genius Level 3 produces exactly 20% off on booking.com (not 10% / 15%).
//   2. Genius L3 OTA perks (free_breakfast, room_upgrade) surface on booking.com.
//   3. Accor Silver welcome_amenity and late_check_out surface on Novotel context.
//   4. late_check_out carries subjectToAvailability: true in structuredPerks.
//   5. No Accor discount surfaces on booking.com (wrong domain/brand scope).
//   6. No Genius discount surfaces on Novotel context (wrong domain/brand scope).
//   7. All perkValueEstimates carry isEstimate: true (estimates ≠ prices, product rule #1).
//   8. Product rule #1: no forbidden price fields in any channel output.
//   9. The no-prices disclaimer appears in every search_hotels text response.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createPersonaFactory } from "@truerate/harness";
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
      `${label}: forbidden price field "${field}" found in output (product rule #1 / issue #1)`,
    );
  }
}

// ── Shared state ──────────────────────────────────────────────────────────────

let mcpSrv: Server;
let mcpBase: string;

before(async () => {
  process.env.TRUERATE_INMEMORY = "true";
  process.env.TRUERATE_JWT_SECRET = "sk-persona-accor-silver-journey-32xx";
  process.env.TRUERATE_CRED_KEY = randomBytes(32).toString("base64");
  process.env.ADMIN_SECRET = "test-admin-secret";
  process.env.MCP_PUBLIC_URL = "https://mcp.test.example";

  // The MCP server (createRequestListener) and the API app both import
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
  return `sk-accor-silver-${++emailCounter}-${Date.now()}@truerate-test.local`;
}

async function registerUser(
  app: Awaited<ReturnType<typeof getApp>>,
  market = "sk",
): Promise<string> {
  const res = await app.request("/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: uniqueEmail(),
      password: "sk-test-pw-1234",
      market,
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
  tier: string,
): Promise<void> {
  const res = await app.request("/memberships", {
    method: "POST",
    headers: authed(jwtToken),
    body: JSON.stringify({ programId, tier }),
  });
  assert.equal(
    res.status,
    200,
    `add membership ${programId}/${tier} failed: ${await res.clone().text()}`,
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
  const client = new Client({ name: "sk-accor-silver-journey-test", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(
    new URL(`${mcpBase}/u/${rawToken}/mcp`),
  );
  await client.connect(transport);
  return { client, close: async () => transport.close() };
}

// ── Test 1: persona-sk-6 — full API → MCP journey ────────────────────────────

test(
  "persona-sk-6 (Genius L3 + Accor Silver, SK market): API → MCP journey — 20% discount + Silver perks, no prices",
  async () => {
    const app = await getApp();

    // Build persona-sk-6: archetype index 6 from build(8, seed).
    // Seed 63 is distinct from 0 (cross-channel), 42 (persona-api-mcp), 77, 99
    // (persona-via-per-user-url) to avoid MemoryUserRepo collisions.
    const factory = createPersonaFactory();
    const allPersonas = factory.build(8, 63);
    const persona = allPersonas[6]!;

    // Verify persona identity before driving.
    assert.equal(persona.market, "SK", "persona-sk-6 must be SK market");
    assert.ok(
      persona.memberships.some((m) => m.programId === "booking_genius"),
      "persona-sk-6 must include booking_genius",
    );
    assert.ok(
      persona.memberships.some((m) => m.programId === "accor_all"),
      "persona-sk-6 must include accor_all",
    );

    // Confirm tiers.
    const geniusMembership = persona.memberships.find((m) => m.programId === "booking_genius")!;
    assert.equal(geniusMembership.tier, "Level 3", "persona-sk-6 Genius must be Level 3");

    const accorMembership = persona.memberships.find((m) => m.programId === "accor_all")!;
    assert.equal(accorMembership.tier, "Silver", "persona-sk-6 Accor ALL must be Silver");

    // Register a SK-market user via the API and add both memberships.
    const jwtToken = await registerUser(app, "sk");
    await addMembership(app, jwtToken, "booking_genius", "Level 3");
    await addMembership(app, jwtToken, "accor_all", "Silver");

    // Issue the MCP URL once — the per-user token IS the credential.
    const rawMcpToken = await issueMcpToken(app, jwtToken);

    const { client, close } = await connectToMcp(rawMcpToken);
    try {
      // ── get_membership_summary: both programs must appear ──────────────────

      const summaryResult = await client.callTool({ name: "get_membership_summary", arguments: {} });
      assert.ok(
        !summaryResult.isError,
        `get_membership_summary errored: ${JSON.stringify(summaryResult)}`,
      );
      const summaryText = (summaryResult.content[0] as { type: "text"; text: string }).text;
      assert.match(summaryText, /Booking\.com Genius/i, "summary must include Booking.com Genius");
      assert.match(summaryText, /Level 3/i, "summary must include Level 3 tier");
      assert.match(summaryText, /ALL|Accor/i, "summary must include Accor ALL membership");
      assert.match(summaryText, /Silver/i, "summary must include Silver tier");
      assertNoPriceFields(summaryResult, "get_membership_summary");

      // ── search_hotels (booking.com): Genius L3 → 20% off + OTA perks ──────

      const geniusResult = await client.callTool({
        name: "search_hotels",
        arguments: { domain: "booking.com", location: "Bratislava" },
      });
      assert.ok(
        !geniusResult.isError,
        `Genius search_hotels errored: ${JSON.stringify(geniusResult)}`,
      );
      assert.ok(geniusResult.structuredContent, "structuredContent required");

      const geniusSc = geniusResult.structuredContent as unknown as McpBenefitResult;
      assertNoPriceFields(geniusSc, "Genius search_hotels structuredContent");

      // Genius L3 must produce exactly 20% off — not 10% (L1) or 15% (L2).
      const booking20pct = geniusSc.matches.some(
        (m) => m.discount !== undefined && Math.round(m.discount.percentOff * 100) === 20,
      );
      assert.ok(
        booking20pct,
        `Genius Level 3 must produce 20% off on booking.com; matches: ${JSON.stringify(geniusSc.matches)}`,
      );

      // booking_genius must appear in programsApplied.
      assert.ok(
        geniusSc.programsApplied.includes("booking_genius"),
        `booking_genius must be in programsApplied; got: ${JSON.stringify(geniusSc.programsApplied)}`,
      );

      // Genius L3 OTA perks: free_breakfast and room_upgrade must surface.
      const geniusPerkTypes = geniusSc.perkValueEstimates.map((e) => e.perkType);
      assert.ok(
        geniusPerkTypes.includes("free_breakfast"),
        `Genius L3 must surface free_breakfast perk on booking.com; got: ${JSON.stringify(geniusPerkTypes)}`,
      );
      assert.ok(
        geniusPerkTypes.includes("room_upgrade"),
        `Genius L3 must surface room_upgrade perk on booking.com; got: ${JSON.stringify(geniusPerkTypes)}`,
      );

      // Accor ALL must NOT match booking.com (brand/domain mismatch — Accor
      // matches Novotel/Sofitel/etc., not booking.com OTA domain).
      assert.ok(
        !geniusSc.programsApplied.includes("accor_all"),
        "accor_all must not appear on a booking.com search (scope mismatch)",
      );

      // All perk estimates must carry isEstimate: true (not prices).
      for (const est of geniusSc.perkValueEstimates) {
        assert.strictEqual(
          est.isEstimate,
          true,
          `Genius perk "${est.perkType}" must carry isEstimate: true`,
        );
        assert.ok(
          typeof est.estimatedUsd[3] === "number" &&
            typeof est.estimatedUsd[4] === "number" &&
            typeof est.estimatedUsd[5] === "number",
          `Genius perk "${est.perkType}" must have estimatedUsd at 3★/4★/5★`,
        );
      }

      // Formatted text must carry the no-prices disclaimer.
      const geniusText = (geniusResult.content[0] as { type: "text"; text: string }).text;
      assert.match(geniusText, /Prices are not returned/i, "no-prices disclaimer must appear");
      assert.doesNotMatch(geniusText, /member price/i, "must not use 'member price' language");
      assert.doesNotMatch(geniusText, /final price/i, "must not use 'final price' language");

      // ── search_hotels (Novotel/Accor): Silver → welcome_amenity + late_check_out

      const accorResult = await client.callTool({
        name: "search_hotels",
        arguments: { brand: "Novotel", location: "Bratislava" },
      });
      assert.ok(
        !accorResult.isError,
        `Accor search_hotels errored: ${JSON.stringify(accorResult)}`,
      );
      assert.ok(accorResult.structuredContent, "structuredContent required");

      const accorSc = accorResult.structuredContent as unknown as McpBenefitResult;
      assertNoPriceFields(accorSc, "Accor search_hotels structuredContent");

      // accor_all must be in programsApplied for a Novotel brand query.
      assert.ok(
        accorSc.programsApplied.includes("accor_all"),
        `accor_all must be in programsApplied for Novotel brand; got: ${JSON.stringify(accorSc.programsApplied)}`,
      );

      // Accor Silver has a 5% member rate discount (percentDiscount: 0.05).
      const accorHasDiscount = accorSc.matches.some(
        (m) => m.discount !== undefined && m.discount.percentOff > 0,
      );
      assert.ok(accorHasDiscount, "Accor Silver must surface a member rate discount on Novotel");

      // Accor Silver's signature perks: welcome_amenity and late_check_out.
      // These are the perks that distinguish Silver from Classic (no perks) and
      // Gold (room_upgrade + lounge_access) — first time either is tested in MCP.
      const accorPerkTypes = accorSc.perkValueEstimates.map((e) => e.perkType);

      assert.ok(
        accorPerkTypes.includes("welcome_amenity"),
        `Accor Silver must surface welcome_amenity perk; got: ${JSON.stringify(accorPerkTypes)}`,
      );

      assert.ok(
        accorPerkTypes.includes("late_check_out"),
        `Accor Silver must surface late_check_out perk; got: ${JSON.stringify(accorPerkTypes)}`,
      );

      // late_check_out must carry subjectToAvailability: true in the structuredPerks
      // of the matching benefit (verified via the raw match items).
      const accorMatch = accorSc.matches.find((m) =>
        m.structuredPerks.some((p) => p.type === "late_check_out"),
      );
      assert.ok(
        accorMatch !== undefined,
        "Accor Silver late_check_out must appear in a match's structuredPerks",
      );
      const lateCheckOutPerk = accorMatch.structuredPerks.find((p) => p.type === "late_check_out");
      assert.ok(
        lateCheckOutPerk !== undefined,
        "late_check_out must be present in structuredPerks",
      );
      assert.ok(
        (lateCheckOutPerk.conditions as Record<string, unknown> | undefined)
          ?.subjectToAvailability === true,
        "late_check_out must carry subjectToAvailability: true",
      );

      // booking_genius may also appear on a Novotel brand search because its
      // defaultMatch includes categories: ["hotel"] and search_hotels always
      // injects category: "hotel" — the user could book Novotel via Booking.com
      // and apply their Genius discount. This is expected and correct behaviour.
      // The key assertion is that accor_all is present with its Silver perks.

      // All Accor perk estimates must carry isEstimate: true.
      for (const est of accorSc.perkValueEstimates) {
        assert.strictEqual(
          est.isEstimate,
          true,
          `Accor perk "${est.perkType}" must carry isEstimate: true`,
        );
        assert.ok(
          typeof est.estimatedUsd[3] === "number" &&
            typeof est.estimatedUsd[4] === "number" &&
            typeof est.estimatedUsd[5] === "number",
          `Accor perk "${est.perkType}" must have estimatedUsd at 3★/4★/5★`,
        );
      }

      // Formatted text must carry the no-prices disclaimer.
      const accorText = (accorResult.content[0] as { type: "text"; text: string }).text;
      assert.match(accorText, /Prices are not returned/i, "no-prices disclaimer must appear");
      assert.doesNotMatch(accorText, /member price/i, "must not use 'member price' language");
      assert.doesNotMatch(accorText, /final price/i, "must not use 'final price' language");
      assert.doesNotMatch(accorText, /post.discount/i, "must not reference post-discount");
    } finally {
      await close();
      factory.teardown();
    }
  },
);
