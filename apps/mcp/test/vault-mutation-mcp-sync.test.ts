// Vault mutation → MCP live sync (issue #159 / #45).
//
// Gap closed: every existing API→MCP journey test checks INITIAL vault state —
// register, add memberships, issue URL, query. None verifies that mutations
// (tier upgrade, membership delete, late add) are instantly reflected in MCP
// output through the SAME per-user token.
//
// This is the central "one vault, multiple channels" promise: MCP reads from
// the live user repo at query time, so any change the user makes (upgrade
// a tier in the web app, remove a stale membership) must be visible to their
// AI assistant immediately — no re-issue of the MCP URL required.
//
// Three scenarios:
//   1. Tier upgrade (L1 → L3): 10% off becomes 20% off in MCP search results.
//   2. Membership delete: removed membership no longer appears in summary or
//      search; remaining membership still works correctly.
//   3. Late-add: MCP URL issued before any memberships; benefits appear as soon
//      as one is added via the API without re-issuing the URL.
//
// The API app and MCP server run in the SAME Node.js process and both call
// getUserRepo() from the same @truerate/core symlink, so Node.js module caching
// gives them one shared MemoryUserRepo singleton — no inter-process state sync
// needed.

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
  process.env.TRUERATE_JWT_SECRET = "vault-mutation-mcp-sync-secret-32x";
  process.env.TRUERATE_CRED_KEY = randomBytes(32).toString("base64");
  process.env.ADMIN_SECRET = "test-admin-secret";
  process.env.MCP_PUBLIC_URL = "https://mcp.test.example";

  mcpSrv = createServer(createRequestListener());
  mcpSrv.listen(0);
  mcpBase = `http://localhost:${(mcpSrv.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) =>
    mcpSrv.close((err) => (err ? reject(err) : resolve())),
  );
});

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getApp() {
  const { app } = await import("../../api/src/app.js");
  return app;
}

function authed(token: string): Record<string, string> {
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
}

let emailCounter = 0;
function uniqueEmail(): string {
  return `vault-mutation-${++emailCounter}-${Date.now()}@truerate-test.local`;
}

async function registerUser(
  app: Awaited<ReturnType<typeof getApp>>,
): Promise<string> {
  const res = await app.request("/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: uniqueEmail(),
      password: "mutation-test-pw-1234",
      market: "cz",
    }),
  });
  assert.equal(res.status, 200, `register failed (${res.status}): ${await res.clone().text()}`);
  const { token } = (await res.json()) as { token: string };
  return token;
}

async function addMembership(
  app: Awaited<ReturnType<typeof getApp>>,
  jwtToken: string,
  programId: string,
  tier: string,
): Promise<string> {
  const res = await app.request("/memberships", {
    method: "POST",
    headers: authed(jwtToken),
    body: JSON.stringify({ programId, tier }),
  });
  assert.equal(res.status, 200, `add membership failed (${res.status}): ${await res.clone().text()}`);
  const { user } = (await res.json()) as { user: { memberships: Array<{ id: string }> } };
  const membership = user.memberships.at(-1);
  assert.ok(membership, "POST /memberships must return the updated user with at least one membership");
  return membership.id;
}

async function patchMembershipTier(
  app: Awaited<ReturnType<typeof getApp>>,
  jwtToken: string,
  membershipId: string,
  tier: string,
): Promise<void> {
  const res = await app.request(`/memberships/${membershipId}`, {
    method: "PATCH",
    headers: authed(jwtToken),
    body: JSON.stringify({ tier }),
  });
  assert.equal(res.status, 200, `PATCH membership failed (${res.status}): ${await res.clone().text()}`);
}

async function deleteMembership(
  app: Awaited<ReturnType<typeof getApp>>,
  jwtToken: string,
  membershipId: string,
): Promise<void> {
  const res = await app.request(`/memberships/${membershipId}`, {
    method: "DELETE",
    headers: authed(jwtToken),
  });
  assert.equal(res.status, 200, `DELETE membership failed (${res.status}): ${await res.clone().text()}`);
}

async function issueMcpToken(
  app: Awaited<ReturnType<typeof getApp>>,
  jwtToken: string,
): Promise<string> {
  const res = await app.request("/me/mcp-url", {
    method: "POST",
    headers: authed(jwtToken),
  });
  assert.equal(res.status, 200, `issue MCP URL failed (${res.status}): ${await res.clone().text()}`);
  const { token } = (await res.json()) as { token: string };
  assert.match(token, /^[A-Za-z0-9_-]+$/, "MCP token must be base64url");
  return token;
}

async function connectToMcp(
  rawToken: string,
): Promise<{ client: Client; close: () => Promise<void> }> {
  const client = new Client({ name: "vault-mutation-mcp-sync-test", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(
    new URL(`${mcpBase}/u/${rawToken}/mcp`),
  );
  await client.connect(transport);
  return { client, close: async () => transport.close() };
}

function bestDiscount(sc: McpBenefitResult): number {
  return Math.max(
    0,
    ...sc.matches.filter((m) => m.discount).map((m) => m.discount!.percentOff),
  );
}

// ── Test 1: tier upgrade reflected immediately in MCP ─────────────────────────

test(
  "tier upgrade (Genius L1 → L3): MCP discount rises from 10% to 20% without re-issuing URL",
  async () => {
    const app = await getApp();
    const jwtToken = await registerUser(app);

    // Add Genius Level 1 (10% off).
    const membershipId = await addMembership(app, jwtToken, "booking_genius", "Level 1");

    // Issue MCP URL once — this token must reflect all future vault mutations.
    const rawMcpToken = await issueMcpToken(app, jwtToken);

    // ── Before upgrade ─────────────────────────────────────────────────────────
    {
      const { client, close } = await connectToMcp(rawMcpToken);
      try {
        const result = await client.callTool({
          name: "search_hotels",
          arguments: { domain: "booking.com", location: "Prague" },
        });
        assert.ok(!result.isError, `search_hotels errored before upgrade: ${JSON.stringify(result)}`);
        const sc = result.structuredContent as unknown as McpBenefitResult;
        assertNoPriceFields(sc, "before upgrade");

        const discountBefore = bestDiscount(sc);
        assert.ok(discountBefore > 0, "Genius L1 must surface a discount before upgrade");
        assert.equal(
          Math.round(discountBefore * 100),
          10,
          `Genius L1 must give 10% off before upgrade; got ${Math.round(discountBefore * 100)}%`,
        );
      } finally {
        await close();
      }
    }

    // Upgrade to Level 3 via the API — no MCP URL re-issue.
    await patchMembershipTier(app, jwtToken, membershipId, "Level 3");

    // ── After upgrade ──────────────────────────────────────────────────────────
    {
      const { client, close } = await connectToMcp(rawMcpToken);
      try {
        const result = await client.callTool({
          name: "search_hotels",
          arguments: { domain: "booking.com", location: "Prague" },
        });
        assert.ok(!result.isError, `search_hotels errored after upgrade: ${JSON.stringify(result)}`);
        const sc = result.structuredContent as unknown as McpBenefitResult;
        assertNoPriceFields(sc, "after upgrade");

        const discountAfter = bestDiscount(sc);
        assert.equal(
          Math.round(discountAfter * 100),
          20,
          `Genius L3 must give 20% off after upgrade; got ${Math.round(discountAfter * 100)}%. ` +
            `MCP must reflect the vault mutation immediately via the SAME token.`,
        );

        // Summary must reflect the new tier label.
        const summaryResult = await client.callTool({ name: "get_membership_summary", arguments: {} });
        assert.ok(!summaryResult.isError);
        const summaryText = (summaryResult.content[0] as { type: "text"; text: string }).text;
        assert.match(summaryText, /Level 3|L3/i, "summary must show the upgraded tier");
        assertNoPriceFields(summaryResult, "summary after upgrade");
      } finally {
        await close();
      }
    }
  },
);

// ── Test 2: membership delete reflected immediately in MCP ────────────────────

test(
  "membership delete: removed membership absent from MCP, remaining membership unaffected",
  async () => {
    const app = await getApp();
    const jwtToken = await registerUser(app);

    // Add two memberships: Genius L3 (OTA-scoped) + Marriott Platinum (brand-scoped).
    const geniusId = await addMembership(app, jwtToken, "booking_genius", "Level 3");
    await addMembership(app, jwtToken, "marriott_bonvoy", "Platinum");

    const rawMcpToken = await issueMcpToken(app, jwtToken);

    // Verify both memberships are visible before deletion.
    {
      const { client, close } = await connectToMcp(rawMcpToken);
      try {
        const summaryResult = await client.callTool({ name: "get_membership_summary", arguments: {} });
        assert.ok(!summaryResult.isError);
        const summaryText = (summaryResult.content[0] as { type: "text"; text: string }).text;
        assert.match(summaryText, /Booking\.com Genius/i, "Genius must appear before deletion");
        assert.match(summaryText, /Marriott Bonvoy/i, "Marriott must appear before deletion");
        assertNoPriceFields(summaryResult, "summary before deletion");
      } finally {
        await close();
      }
    }

    // Delete the Genius membership.
    await deleteMembership(app, jwtToken, geniusId);

    // After deletion: Genius must be absent; Marriott must still work.
    {
      const { client, close } = await connectToMcp(rawMcpToken);
      try {
        // Summary must not mention Genius.
        const summaryResult = await client.callTool({ name: "get_membership_summary", arguments: {} });
        assert.ok(!summaryResult.isError);
        const summaryText = (summaryResult.content[0] as { type: "text"; text: string }).text;
        assert.doesNotMatch(
          summaryText,
          /Booking\.com Genius/i,
          "Genius must NOT appear in summary after deletion",
        );
        assert.match(summaryText, /Marriott Bonvoy/i, "Marriott must still appear after Genius deletion");
        assertNoPriceFields(summaryResult, "summary after deletion");

        // Hotel search on booking.com must return NO Genius benefits.
        const bookingResult = await client.callTool({
          name: "search_hotels",
          arguments: { domain: "booking.com", location: "Vienna" },
        });
        assert.ok(!bookingResult.isError);
        const bookingSc = bookingResult.structuredContent as unknown as McpBenefitResult;
        assertNoPriceFields(bookingSc, "booking.com after deletion");

        const geniusInMatches = bookingSc.matches.some((m) =>
          /genius/i.test(m.membershipLabel),
        );
        assert.ok(
          !geniusInMatches,
          "Genius must not appear in booking.com matches after deletion",
        );
        assert.ok(
          !bookingSc.programsApplied.includes("booking_genius"),
          "booking_genius must not be in programsApplied after deletion",
        );

        // Marriott-brand search must still surface Platinum perks.
        const marriottResult = await client.callTool({
          name: "search_hotels",
          arguments: { brand: "Marriott", location: "Vienna" },
        });
        assert.ok(!marriottResult.isError);
        const marriottSc = marriottResult.structuredContent as unknown as McpBenefitResult;
        assertNoPriceFields(marriottSc, "Marriott search after Genius deletion");

        assert.ok(
          marriottSc.programsApplied.includes("marriott_bonvoy"),
          "Marriott Bonvoy must still be applied after Genius deletion",
        );

        for (const est of marriottSc.perkValueEstimates) {
          assert.strictEqual(
            est.isEstimate,
            true,
            `Marriott perk "${est.perkType}" must carry isEstimate: true`,
          );
        }
      } finally {
        await close();
      }
    }
  },
);

// ── Test 3: late membership add visible through an already-issued URL ──────────

test(
  "late-add: memberships added after MCP URL issuance are immediately surfaced by MCP",
  async () => {
    const app = await getApp();
    const jwtToken = await registerUser(app);

    // Issue the MCP URL BEFORE adding any membership.
    const rawMcpToken = await issueMcpToken(app, jwtToken);

    // Before any membership: MCP must report no applicable benefits.
    {
      const { client, close } = await connectToMcp(rawMcpToken);
      try {
        const searchResult = await client.callTool({
          name: "search_hotels",
          arguments: { domain: "booking.com", location: "Prague" },
        });
        assert.ok(!searchResult.isError);
        const sc = searchResult.structuredContent as unknown as McpBenefitResult;
        assertNoPriceFields(sc, "empty vault before late-add");

        assert.equal(
          sc.matches.length,
          0,
          "No memberships → MCP must return zero matches before late-add",
        );

        const summaryResult = await client.callTool({ name: "get_membership_summary", arguments: {} });
        assert.ok(!summaryResult.isError);
        const summaryText = (summaryResult.content[0] as { type: "text"; text: string }).text;
        assert.match(
          summaryText,
          /no memberships|no active memberships|no vault/i,
          "Summary must report empty vault before late-add",
        );
      } finally {
        await close();
      }
    }

    // Now add a membership via the API — without re-issuing the MCP URL.
    await addMembership(app, jwtToken, "booking_genius", "Level 3");

    // The same token must now surface the newly-added membership's benefits.
    {
      const { client, close } = await connectToMcp(rawMcpToken);
      try {
        const searchResult = await client.callTool({
          name: "search_hotels",
          arguments: { domain: "booking.com", location: "Prague" },
        });
        assert.ok(!searchResult.isError, `search_hotels errored after late-add: ${JSON.stringify(searchResult)}`);
        const sc = searchResult.structuredContent as unknown as McpBenefitResult;
        assertNoPriceFields(sc, "after late-add");

        assert.ok(
          sc.matches.length > 0,
          "MCP must surface matches after late-add of Genius L3 without re-issuing the URL",
        );
        assert.equal(
          Math.round(bestDiscount(sc) * 100),
          20,
          "Genius L3 must give 20% off immediately after late-add",
        );

        assert.ok(
          sc.programsApplied.includes("booking_genius"),
          "booking_genius must be in programsApplied after late-add",
        );

        const summaryResult = await client.callTool({ name: "get_membership_summary", arguments: {} });
        assert.ok(!summaryResult.isError);
        const summaryText = (summaryResult.content[0] as { type: "text"; text: string }).text;
        assert.match(
          summaryText,
          /Booking\.com Genius/i,
          "Summary must include the late-added Genius membership",
        );
        assertNoPriceFields(summaryResult, "summary after late-add");
      } finally {
        await close();
      }
    }
  },
);
