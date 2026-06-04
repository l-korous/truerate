// Persona-driven API → MCP end-to-end journey for the three previously untested
// persona archetypes (issue #159 / #45).
//
// Gap closed: cross-channel-consistency.test.ts and persona-via-per-user-url.test.ts
// cover persona archetypes 0, 1, 4, 5 (CZ/DE/AT/GB). These three archetypes have
// never appeared in any MCP or cross-channel e2e test:
//
//   persona-cz-2 : ALL — Accor Live Limitless Gold + Emblem Prague — Emblematic
//   persona-pl-3 : Booking.com Genius Level 1 + Revolut Premium
//   persona-hu-7 : IHG One Rewards Platinum Elite + Revolut Ultra  (HU market)
//
// Unlike persona-via-per-user-url.test.ts (which seeds the user repo directly,
// bypassing the API), this test drives the complete API registration pipeline:
//
//   POST /auth/register → POST /memberships (per program) → POST /me/mcp-url
//
// …then connects a real MCP SDK client via the issued /u/<token>/mcp per-user
// URL — the exact credential flow an AI desktop client (Claude Desktop, Cursor)
// would use — and calls search_hotels / get_membership_summary for each persona.
//
// This validates:
//   1. The API correctly registers users and stores catalog memberships for
//      programs that had no prior e2e coverage (Accor Gold, Emblem Prague,
//      IHG Platinum Elite, Revolut Ultra).
//   2. instantiateBenefits() produces correct benefit structures for these tiers
//      (tested indirectly: MCP returns the expected perks/discounts only if the
//      API stored the benefits correctly).
//   3. The per-user MCP URL flow works for freshly registered users end-to-end.
//   4. search_hotels returns the correct perks / discount % for each program
//      when called with the matching hotel context.
//   5. No forbidden price fields appear in any channel output (product rule #1
//      / issue #1).
//   6. Every perkValueEstimate carries isEstimate: true (estimates ≠ prices).

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createPersonaFactory, type TestPersona } from "@truerate/harness";
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
  // Env vars must be set before any lazy import of the API app; tsx resolves
  // .js extensions to .ts source files, so the module is only evaluated once.
  process.env.TRUERATE_INMEMORY = "true";
  process.env.TRUERATE_JWT_SECRET = "persona-api-mcp-journey-secret-32x";
  process.env.TRUERATE_CRED_KEY = randomBytes(32).toString("base64");
  process.env.ADMIN_SECRET = "test-admin-secret";
  // MCP_PUBLIC_URL is used only to build the URL shown in the API response.
  // Tests construct the actual MCP URL from the raw token + mcpBase directly.
  process.env.MCP_PUBLIC_URL = "https://mcp.test.example";

  // Start a real HTTP MCP server on a random port. The API app (imported lazily
  // below) and this MCP server share the same MemoryUserRepo singleton because
  // both resolve @truerate/core from the same packages/core directory — Node.js
  // module caching gives them one in-process repo instance.
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

// Lazy import so env vars are set before any module-level code in app.ts runs.
async function getApp() {
  const { app } = await import("../../api/src/app.js");
  return app;
}

function authed(token: string): Record<string, string> {
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
}

/** Register the persona via the API, returning the JWT for subsequent calls. */
async function registerPersona(
  app: Awaited<ReturnType<typeof getApp>>,
  persona: TestPersona,
  runSuffix: string,
): Promise<string> {
  // Append a run-unique suffix so the email is unique within this test process.
  const email = `${persona.handle}-${runSuffix}@truerate-test.local`;
  const res = await app.request("/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email,
      password: "persona-api-mcp-pw-1234",
      market: persona.market.toLowerCase(),
    }),
  });
  assert.equal(res.status, 200, `register failed for ${persona.handle} (${res.status}): ${await res.clone().text()}`);
  const { token } = (await res.json()) as { token: string };
  return token;
}

/** Add each of the persona's catalog memberships via the API. */
async function addMemberships(
  app: Awaited<ReturnType<typeof getApp>>,
  jwtToken: string,
  persona: TestPersona,
): Promise<void> {
  for (const m of persona.memberships) {
    if (!m.programId) continue;
    const body: Record<string, unknown> = { programId: m.programId };
    if (m.tier) body.tier = m.tier;

    const res = await app.request("/memberships", {
      method: "POST",
      headers: authed(jwtToken),
      body: JSON.stringify(body),
    });
    assert.equal(
      res.status,
      200,
      `add membership ${m.programId}${m.tier ? `/${m.tier}` : ""} failed for ${persona.handle} (${res.status}): ${await res.clone().text()}`,
    );
  }
}

/** Issue an MCP URL via the API; returns the raw (unhashed) token. */
async function issueMcpToken(
  app: Awaited<ReturnType<typeof getApp>>,
  jwtToken: string,
  persona: TestPersona,
): Promise<string> {
  const res = await app.request("/me/mcp-url", {
    method: "POST",
    headers: authed(jwtToken),
  });
  assert.equal(
    res.status,
    200,
    `MCP URL issue failed for ${persona.handle} (${res.status}): ${await res.clone().text()}`,
  );
  const { token } = (await res.json()) as { token: string; url: string };
  assert.match(token, /^[A-Za-z0-9_-]+$/, "MCP token must be a base64url string");
  return token;
}

// ── MCP client helper ─────────────────────────────────────────────────────────

async function connectToMcp(
  rawToken: string,
): Promise<{ client: Client; close: () => Promise<void> }> {
  const client = new Client({ name: "persona-api-mcp-journey-test", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(
    new URL(`${mcpBase}/u/${rawToken}/mcp`),
  );
  await client.connect(transport);
  return { client, close: async () => transport.close() };
}

// ── Unique run ID to avoid email collisions between tests in this file ────────

// Each test registers a persona; since they run sequentially in one process and
// the MemoryUserRepo is shared, we need distinct emails per registration.
let runCounter = 0;
function nextRunSuffix(): string {
  return `r${++runCounter}-${Date.now()}`;
}

// ── persona-cz-2: ALL Accor Live Limitless Gold + Emblem Prague — Emblematic ──

test(
  "persona-cz-2 (Accor All Gold + Emblem Prague): API → MCP journey — perks and 5% discount, no prices",
  async () => {
    const app = await getApp();

    // persona-cz-2 is archetype index 2 in the 8-archetype factory cycle.
    const factory = createPersonaFactory();
    const allPersonas = factory.build(8, 42);
    const persona = allPersonas[2]!;
    assert.equal(persona.market, "CZ", "persona-cz-2 must be CZ market");
    assert.ok(
      persona.memberships.some((m) => m.programId === "accor_all"),
      "persona-cz-2 must include accor_all",
    );
    assert.ok(
      persona.memberships.some((m) => m.programId === "emblem_prague"),
      "persona-cz-2 must include emblem_prague",
    );

    // Register via API, add memberships, issue MCP URL.
    const jwtToken = await registerPersona(app, persona, nextRunSuffix());
    await addMemberships(app, jwtToken, persona);
    const rawMcpToken = await issueMcpToken(app, jwtToken, persona);

    // Connect real MCP client via the per-user URL — no auth header.
    const { client, close } = await connectToMcp(rawMcpToken);
    try {
      // ── get_membership_summary: both programs must appear ─────────────────
      const summaryResult = await client.callTool({ name: "get_membership_summary", arguments: {} });
      assert.ok(!summaryResult.isError, `get_membership_summary errored: ${JSON.stringify(summaryResult)}`);
      const summaryText = (summaryResult.content[0] as { type: "text"; text: string }).text;
      assert.match(summaryText, /ALL.*Accor|Accor Live Limitless/i, "summary must include Accor ALL");
      assert.match(summaryText, /Emblem Prague|Emblematic/i, "summary must include Emblem Prague");
      assertNoPriceFields(summaryResult, "persona-cz-2 get_membership_summary");

      // ── search_hotels (Novotel/Accor context): Accor All Gold must surface ─
      // Accor Gold gives 5% off (percentDiscount) + room_upgrade + lounge_access.
      const accorResult = await client.callTool({
        name: "search_hotels",
        arguments: { brand: "Novotel", location: "Prague" },
      });
      assert.ok(!accorResult.isError, `Accor search_hotels errored: ${JSON.stringify(accorResult)}`);
      assert.ok(accorResult.structuredContent, "structuredContent required");

      const accorSc = accorResult.structuredContent as unknown as McpBenefitResult;
      assertNoPriceFields(accorSc, "persona-cz-2 Accor search_hotels");

      // Accor All Gold gives a 5% member rate on Accor brands.
      const hasAccorDiscount = accorSc.matches.some(
        (m) => m.discount !== undefined && m.discount.percentOff >= 0.05 - 0.001,
      );
      assert.ok(
        hasAccorDiscount,
        `Accor All Gold 5% discount must surface on Novotel context; matches: ${JSON.stringify(accorSc.matches)}`,
      );

      // At least one perk from Accor Gold (room_upgrade or lounge_access) must appear.
      const accorPerkTypes = accorSc.perkValueEstimates.map((e) => e.perkType);
      const hasAccorPerk =
        accorPerkTypes.includes("room_upgrade") || accorPerkTypes.includes("lounge_access");
      assert.ok(
        hasAccorPerk,
        `Accor All Gold must surface room_upgrade or lounge_access; got: ${JSON.stringify(accorPerkTypes)}`,
      );

      // All perk estimates must carry isEstimate: true — never a price.
      for (const est of accorSc.perkValueEstimates) {
        assert.strictEqual(
          est.isEstimate,
          true,
          `Accor perk "${est.perkType}" must carry isEstimate: true (estimates ≠ prices)`,
        );
      }

      // ── search_hotels (emblemprague.com): Emblem Prague must surface 20% off ─
      const emblemResult = await client.callTool({
        name: "search_hotels",
        arguments: { domain: "emblemprague.com", location: "Prague" },
      });
      assert.ok(!emblemResult.isError, `Emblem search_hotels errored: ${JSON.stringify(emblemResult)}`);
      const emblemSc = emblemResult.structuredContent as unknown as McpBenefitResult;
      assertNoPriceFields(emblemSc, "persona-cz-2 Emblem search_hotels");

      // Emblem Prague — Emblematic gives 20% off (direct booking, member rate).
      const hasEmblemDiscount = emblemSc.matches.some(
        (m) => m.discount !== undefined && Math.round(m.discount.percentOff * 100) === 20,
      );
      assert.ok(
        hasEmblemDiscount,
        `Emblem Prague 20% discount must surface on emblemprague.com context; matches: ${JSON.stringify(emblemSc.matches)}`,
      );

      // Formatted text must carry the no-prices disclaimer.
      const accorText = (accorResult.content[0] as { type: "text"; text: string }).text;
      assert.match(accorText, /Prices are not returned/i, "no-prices disclaimer must be in formatted text");
    } finally {
      await close();
      factory.teardown();
    }
  },
);

// ── persona-pl-3: Booking.com Genius Level 1 + Revolut Premium ───────────────

test(
  "persona-pl-3 (Genius L1 + Revolut Premium, PL market): API → MCP journey — 10% off booking.com, no prices",
  async () => {
    const app = await getApp();

    // persona-pl-3 is archetype index 3.
    const factory = createPersonaFactory();
    const allPersonas = factory.build(8, 42);
    const persona = allPersonas[3]!;
    assert.equal(persona.market, "PL", "persona-pl-3 must be PL market");
    assert.ok(
      persona.memberships.some((m) => m.programId === "booking_genius"),
      "persona-pl-3 must include booking_genius",
    );
    assert.ok(
      persona.memberships.some((m) => m.programId === "revolut"),
      "persona-pl-3 must include revolut",
    );

    // Genius L1 must carry a 10% discount (no additional perks at Level 1).
    const geniusMembership = persona.memberships.find((m) => m.programId === "booking_genius")!;
    assert.equal(geniusMembership.tier, "Level 1", "persona-pl-3 Genius must be Level 1");
    const has10pct = geniusMembership.benefits.some(
      (b) => b.value.kind === "percentDiscount" && Math.round((b.value.percentOff ?? 0) * 100) === 10,
    );
    assert.ok(has10pct, "Genius Level 1 must carry a 10% discount benefit");

    // Register via API, add memberships, issue MCP URL.
    const jwtToken = await registerPersona(app, persona, nextRunSuffix());
    await addMemberships(app, jwtToken, persona);
    const rawMcpToken = await issueMcpToken(app, jwtToken, persona);

    const { client, close } = await connectToMcp(rawMcpToken);
    try {
      // ── get_membership_summary: both programs must appear ─────────────────
      const summaryResult = await client.callTool({ name: "get_membership_summary", arguments: {} });
      assert.ok(!summaryResult.isError, `get_membership_summary errored: ${JSON.stringify(summaryResult)}`);
      const summaryText = (summaryResult.content[0] as { type: "text"; text: string }).text;
      assert.match(summaryText, /Booking\.com Genius/i, "summary must include Genius");
      assert.match(summaryText, /Revolut/i, "summary must include Revolut");
      assertNoPriceFields(summaryResult, "persona-pl-3 get_membership_summary");

      // ── search_hotels (booking.com): Genius L1 → 10% off ─────────────────
      const geniusResult = await client.callTool({
        name: "search_hotels",
        arguments: { domain: "booking.com", location: "Warsaw" },
      });
      assert.ok(!geniusResult.isError, `Genius search_hotels errored: ${JSON.stringify(geniusResult)}`);
      assert.ok(geniusResult.structuredContent, "structuredContent required");

      const geniusSc = geniusResult.structuredContent as unknown as McpBenefitResult;
      assertNoPriceFields(geniusSc, "persona-pl-3 Genius search_hotels");

      // Genius Level 1 must produce exactly 10% off — not 15% (L2) or 20% (L3).
      const has10pctInMcp = geniusSc.matches.some(
        (m) => m.discount !== undefined && Math.round(m.discount.percentOff * 100) === 10,
      );
      assert.ok(
        has10pctInMcp,
        `Genius Level 1 must produce 10% off on booking.com; matches: ${JSON.stringify(geniusSc.matches)}`,
      );

      // Level 1 has no structured perks — perkValueEstimates should be empty.
      assert.equal(
        geniusSc.perkValueEstimates.length,
        0,
        "Genius Level 1 must not produce perk value estimates (perks start at Level 2)",
      );

      // Revolut Premium uses category: "subscription" for its match criteria and
      // does NOT match on a hotel search context (category: "hotel"). Verify that
      // Revolut does not appear as a match in hotel search results — this confirms
      // the matching logic correctly scopes subscription programs.
      const revolutInMatches = geniusSc.matches.some((m) =>
        /revolut/i.test(m.membershipLabel),
      );
      assert.ok(
        !revolutInMatches,
        "Revolut Premium must not appear as a hotel search match (subscription scope only)",
      );
      assert.ok(
        !geniusSc.programsApplied.includes("revolut"),
        "revolut must not be in programsApplied for a hotel search (subscription scope only)",
      );

      // Formatted text must carry the no-prices disclaimer.
      const geniusText = (geniusResult.content[0] as { type: "text"; text: string }).text;
      assert.match(geniusText, /Prices are not returned/i, "no-prices disclaimer must appear");
      assertNoPriceFields(geniusSc, "persona-pl-3 search_hotels full");
    } finally {
      await close();
      factory.teardown();
    }
  },
);

// ── persona-hu-7: IHG One Rewards Platinum Elite + Revolut Ultra ─────────────

test(
  "persona-hu-7 (IHG Platinum Elite + Revolut Ultra, HU market): API → MCP journey — IHG perks, no prices",
  async () => {
    const app = await getApp();

    // persona-hu-7 is archetype index 7.
    const factory = createPersonaFactory();
    const allPersonas = factory.build(8, 42);
    const persona = allPersonas[7]!;
    assert.equal(persona.market, "HU", "persona-hu-7 must be HU market");
    assert.ok(
      persona.memberships.some((m) => m.programId === "ihg_one_rewards"),
      "persona-hu-7 must include ihg_one_rewards",
    );
    assert.ok(
      persona.memberships.some((m) => m.programId === "revolut"),
      "persona-hu-7 must include revolut",
    );

    // IHG must be Platinum Elite — the tier that gives room_upgrade,
    // guaranteed_availability, and welcome_amenity (but NOT free_breakfast,
    // which would be Gold Elite or higher in some programs).
    const ihgMembership = persona.memberships.find((m) => m.programId === "ihg_one_rewards")!;
    assert.equal(ihgMembership.tier, "Platinum Elite", "persona-hu-7 IHG must be Platinum Elite");

    // Revolut Ultra — the highest Revolut tier.
    const revolutMembership = persona.memberships.find((m) => m.programId === "revolut")!;
    assert.equal(revolutMembership.tier, "Ultra", "persona-hu-7 Revolut must be Ultra tier");

    // Register via API, add memberships, issue MCP URL.
    const jwtToken = await registerPersona(app, persona, nextRunSuffix());
    await addMemberships(app, jwtToken, persona);
    const rawMcpToken = await issueMcpToken(app, jwtToken, persona);

    const { client, close } = await connectToMcp(rawMcpToken);
    try {
      // ── get_membership_summary: both programs must appear ─────────────────
      const summaryResult = await client.callTool({ name: "get_membership_summary", arguments: {} });
      assert.ok(!summaryResult.isError, `get_membership_summary errored: ${JSON.stringify(summaryResult)}`);
      const summaryText = (summaryResult.content[0] as { type: "text"; text: string }).text;
      assert.match(summaryText, /IHG One Rewards/i, "summary must include IHG One Rewards");
      assert.match(summaryText, /Platinum Elite/i, "summary must include Platinum Elite tier");
      assert.match(summaryText, /Revolut/i, "summary must include Revolut");
      assert.match(summaryText, /Ultra/i, "summary must include Ultra tier");
      assertNoPriceFields(summaryResult, "persona-hu-7 get_membership_summary");

      // ── search_hotels (InterContinental context): IHG Platinum Elite perks ─
      // IHG Platinum Elite gives: room_upgrade (subjectToAvailability),
      //   guaranteed_availability, welcome_amenity. No % discount at this tier.
      const ihgResult = await client.callTool({
        name: "search_hotels",
        arguments: { brand: "InterContinental", location: "Budapest" },
      });
      assert.ok(!ihgResult.isError, `IHG search_hotels errored: ${JSON.stringify(ihgResult)}`);
      assert.ok(ihgResult.structuredContent, "structuredContent required");

      const ihgSc = ihgResult.structuredContent as unknown as McpBenefitResult;
      assertNoPriceFields(ihgSc, "persona-hu-7 IHG search_hotels");

      // IHG Platinum Elite is perk-only — no % discount at this tier.
      const ihgHasDiscount = ihgSc.matches.some((m) => m.discount !== undefined);
      assert.ok(!ihgHasDiscount, "IHG Platinum Elite must not carry a % discount (perk-only tier)");

      // IHG Platinum Elite match must be present.
      assert.ok(
        ihgSc.programsApplied.includes("ihg_one_rewards"),
        `ihg_one_rewards must be in programsApplied; got: ${JSON.stringify(ihgSc.programsApplied)}`,
      );

      // At least one IHG Platinum Elite perk must surface: room_upgrade,
      // guaranteed_availability, or welcome_amenity.
      const ihgPerkTypes = ihgSc.perkValueEstimates.map((e) => e.perkType);
      const hasIhgPlatinumPerk =
        ihgPerkTypes.includes("room_upgrade") ||
        ihgPerkTypes.includes("guaranteed_availability") ||
        ihgPerkTypes.includes("welcome_amenity");
      assert.ok(
        hasIhgPlatinumPerk,
        `IHG Platinum Elite must surface room_upgrade, guaranteed_availability, or welcome_amenity; got: ${JSON.stringify(ihgPerkTypes)}`,
      );

      // Revolut Ultra does not match a hotel search (subscription scope only).
      const revolutInMatches = ihgSc.matches.some((m) => /revolut/i.test(m.membershipLabel));
      assert.ok(!revolutInMatches, "Revolut Ultra must not appear as a hotel search match");
      assert.ok(
        !ihgSc.programsApplied.includes("revolut"),
        "revolut must not appear in programsApplied for a hotel search",
      );

      // All perk estimates must carry isEstimate: true — these are value bands,
      // not computed prices (product rule #1 / issue #1).
      for (const est of ihgSc.perkValueEstimates) {
        assert.strictEqual(
          est.isEstimate,
          true,
          `IHG perk "${est.perkType}" must carry isEstimate: true`,
        );
        assert.ok(
          typeof est.estimatedUsd[3] === "number" &&
            typeof est.estimatedUsd[4] === "number" &&
            typeof est.estimatedUsd[5] === "number",
          `perk "${est.perkType}" must have estimatedUsd at 3★/4★/5★`,
        );
      }

      // Formatted text must carry the no-prices disclaimer.
      const ihgText = (ihgResult.content[0] as { type: "text"; text: string }).text;
      assert.match(ihgText, /Prices are not returned/i, "no-prices disclaimer must appear");

      // ── Cross-persona product rule #1 check: text must not reference prices ─
      assert.doesNotMatch(ihgText, /member price/i, "must not use 'member price' language");
      assert.doesNotMatch(ihgText, /final price/i, "must not use 'final price' language");
      assert.doesNotMatch(ihgText, /post.discount/i, "must not reference post-discount");
    } finally {
      await close();
      factory.teardown();
    }
  },
);
