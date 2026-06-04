// Cross-component e2e journey: API → MCP end-to-end (issue #159 / #45).
//
// Gap closed: existing API tests verify POST /me/mcp-url returns a token but
// never call the MCP server with it. Existing MCP per-user-URL tests seed the
// database directly, bypassing the API layer. This test unites both:
//
//   1. Register a user via app.request() (the same Hono app as production).
//   2. Add memberships via the API.
//   3. Issue an MCP URL via POST /me/mcp-url — get the raw token once.
//   4. Connect to a real MCP HTTP server at /u/<token>/mcp (no auth header).
//   5. Call get_membership_summary and search_hotels — assert correct benefits,
//      no price fields anywhere (product rule #1 / issue #1).
//
// The API app and MCP server share the same MemoryUserRepo singleton because
// both packages' @truerate/core symlinks resolve to the same packages/core
// directory, so Node.js module caching gives them one repo instance.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createRequestListener } from "../src/http.js";
import type { McpBenefitResult } from "../src/server.js";

// Field names that must never appear in any MCP response (product rule #1 / issue #1).
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
  // Both the API layer (via app.request) and the MCP server (via
  // createRequestListener) call getUserRepo() from @truerate/core. Because the
  // @truerate/core entry points in both packages' node_modules are symlinks to
  // the same packages/core directory, Node.js caches one module instance and
  // both layers share one MemoryUserRepo singleton.
  process.env.TRUERATE_INMEMORY = "true";
  process.env.TRUERATE_JWT_SECRET = "api-mcp-journey-test-secret-32chars";
  process.env.TRUERATE_CRED_KEY = randomBytes(32).toString("base64");
  process.env.ADMIN_SECRET = "test-admin-secret";
  // MCP_PUBLIC_URL is only used to build the URL shown to the user. Tests read
  // the raw token directly from the POST /me/mcp-url response body.
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

// ── API helpers ───────────────────────────────────────────────────────────────

// Lazy import so env vars are set before any module-level code in app.ts runs.
// tsx (--import tsx) resolves the .js extension to the .ts source file.
async function getApp() {
  const { app } = await import("../../api/src/app.js");
  return app;
}

const rnd = () =>
  `api-mcp-journey-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;

async function registerUser(
  app: Awaited<ReturnType<typeof getApp>>,
): Promise<{ apiToken: string }> {
  const res = await app.request("/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: rnd(), password: "testpass123", market: "cz" }),
  });
  if (res.status !== 200) throw new Error(`registration failed (${res.status}): ${await res.text()}`);
  const body = (await res.json()) as { token: string };
  return { apiToken: body.token };
}

function authed(token: string): Record<string, string> {
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
}

// ── MCP helper ────────────────────────────────────────────────────────────────

async function connectToMcp(
  rawToken: string,
): Promise<{ client: Client; close: () => Promise<void> }> {
  const client = new Client({ name: "api-to-mcp-journey-test", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(
    new URL(`${mcpBase}/u/${rawToken}/mcp`),
  );
  await client.connect(transport);
  return { client, close: async () => transport.close() };
}

// =============================================================================
// Tests
// =============================================================================

test("full journey: register → add Genius L3 → issue MCP URL → MCP surfaces 20% discount (no prices)", async () => {
  const app = await getApp();

  // Step 1: register a new user via the API.
  const { apiToken } = await registerUser(app);

  // Step 2: add Booking.com Genius Level 3 via the API.
  const addRes = await app.request("/memberships", {
    method: "POST",
    headers: authed(apiToken),
    body: JSON.stringify({ programId: "booking_genius", tier: "Level 3" }),
  });
  if (addRes.status !== 200) throw new Error(`add membership failed (${addRes.status}): ${await addRes.text()}`);

  // Step 3: issue an MCP URL. The raw token is returned exactly once.
  const mcpUrlRes = await app.request("/me/mcp-url", {
    method: "POST",
    headers: authed(apiToken),
  });
  if (mcpUrlRes.status !== 200) throw new Error(`issue MCP URL failed (${mcpUrlRes.status}): ${await mcpUrlRes.text()}`);
  const { token: rawMcpToken } = (await mcpUrlRes.json()) as { token: string; url: string };
  assert.match(rawMcpToken, /^[A-Za-z0-9_-]+$/, "MCP token must be a base64url string");

  // Step 4: connect to the real MCP server via the per-user URL — no auth header,
  // the token embedded in the path IS the credential (same as Claude Desktop).
  const { client, close } = await connectToMcp(rawMcpToken);
  try {
    // Step 5a: get_membership_summary must list the Genius membership.
    const summaryResult = await client.callTool({ name: "get_membership_summary", arguments: {} });
    assert.ok(
      !summaryResult.isError,
      `get_membership_summary errored: ${JSON.stringify(summaryResult)}`,
    );
    const summaryText = (summaryResult.content[0] as { type: "text"; text: string }).text;
    assert.match(summaryText, /Booking\.com Genius/i, "summary must show the Genius membership");
    assertNoPriceFields(summaryResult, "get_membership_summary");

    // Step 5b: search_hotels on booking.com must surface the Genius L3 20% discount.
    const searchResult = await client.callTool({
      name: "search_hotels",
      arguments: { domain: "booking.com", location: "Vienna" },
    });
    assert.ok(!searchResult.isError, `search_hotels errored: ${JSON.stringify(searchResult)}`);
    assert.ok(searchResult.structuredContent, "search_hotels must return structuredContent");
    const sc = searchResult.structuredContent as unknown as McpBenefitResult;

    // Genius L3 → 20% off. percentOff is a fraction (0.2 = 20%).
    const bestDiscount = Math.max(
      0,
      ...sc.matches.filter((m) => m.discount).map((m) => m.discount!.percentOff),
    );
    assert.ok(bestDiscount > 0, "Genius L3 on booking.com must surface a percent discount");
    assert.equal(Math.round(bestDiscount * 100), 20, "Genius Level 3 must be 20% off");

    // Product rule #1: no price fields anywhere in the structured response.
    assertNoPriceFields(sc, "search_hotels structuredContent");
    assert.ok(typeof sc.generatedAt === "string", "structuredContent must carry generatedAt");
  } finally {
    await close();
  }
});

test("journey: rotating the MCP URL invalidates the old token at the MCP server", async () => {
  const app = await getApp();
  const { apiToken } = await registerUser(app);

  await app.request("/memberships", {
    method: "POST",
    headers: authed(apiToken),
    body: JSON.stringify({ programId: "marriott_bonvoy", tier: "Gold" }),
  });

  // Issue initial URL.
  const first = (await (
    await app.request("/me/mcp-url", { method: "POST", headers: authed(apiToken) })
  ).json()) as { token: string };

  // Rotate: a second POST issues a fresh token and overwrites the stored hash.
  const second = (await (
    await app.request("/me/mcp-url", { method: "POST", headers: authed(apiToken) })
  ).json()) as { token: string };
  assert.notEqual(first.token, second.token, "rotation must produce a different token");

  // Old token must be rejected by the MCP server.
  const oldRes = await fetch(`${mcpBase}/u/${first.token}/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  assert.equal(oldRes.status, 401, "rotated-away token must be rejected by the MCP server");

  // New token must be accepted.
  const { client, close } = await connectToMcp(second.token);
  try {
    const result = await client.callTool({ name: "get_membership_summary", arguments: {} });
    assert.ok(!result.isError, `new token must access MCP tools: ${JSON.stringify(result)}`);
    const text = (result.content[0] as { type: "text"; text: string }).text;
    assert.match(text, /Marriott Bonvoy/i, "new token must return the user's memberships");
  } finally {
    await close();
  }
});

test("journey: revoking the MCP URL rejects the token at the MCP server", async () => {
  const app = await getApp();
  const { apiToken } = await registerUser(app);

  const { token: rawToken } = (await (
    await app.request("/me/mcp-url", { method: "POST", headers: authed(apiToken) })
  ).json()) as { token: string };

  const revokeRes = await app.request("/me/mcp-url", {
    method: "DELETE",
    headers: authed(apiToken),
  });
  assert.equal(revokeRes.status, 204, "revoke must return 204");

  // Revoked token must be rejected.
  const mcpRes = await fetch(`${mcpBase}/u/${rawToken}/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  assert.equal(mcpRes.status, 401, "revoked MCP token must be rejected by the MCP server");
});

test("journey: multi-membership user — MCP vault reflects full API-registered set (Genius + Marriott Platinum)", async () => {
  const app = await getApp();
  const { apiToken } = await registerUser(app);

  // Add two memberships via the API.
  await app.request("/memberships", {
    method: "POST",
    headers: authed(apiToken),
    body: JSON.stringify({ programId: "booking_genius", tier: "Level 1" }),
  });
  await app.request("/memberships", {
    method: "POST",
    headers: authed(apiToken),
    body: JSON.stringify({ programId: "marriott_bonvoy", tier: "Platinum" }),
  });

  const { token: rawToken } = (await (
    await app.request("/me/mcp-url", { method: "POST", headers: authed(apiToken) })
  ).json()) as { token: string };

  const { client, close } = await connectToMcp(rawToken);
  try {
    // Both memberships must appear in the summary.
    const summaryResult = await client.callTool({ name: "get_membership_summary", arguments: {} });
    assert.ok(!summaryResult.isError);
    const summaryText = (summaryResult.content[0] as { type: "text"; text: string }).text;
    assert.match(summaryText, /Booking\.com Genius/i, "summary must include Genius");
    assert.match(summaryText, /Marriott Bonvoy/i, "summary must include Marriott");

    // Marriott Platinum on a Marriott-brand context must surface perk estimates
    // that carry isEstimate: true — never a computed price (product rule #1).
    const marriottResult = await client.callTool({
      name: "search_hotels",
      arguments: { brand: "Marriott", location: "Vienna" },
    });
    assert.ok(!marriottResult.isError);
    const sc = marriottResult.structuredContent as unknown as McpBenefitResult;
    assertNoPriceFields(sc, "Marriott search_hotels");

    for (const est of sc.perkValueEstimates) {
      assert.strictEqual(
        est.isEstimate,
        true,
        `perk "${est.perkType}" must carry isEstimate: true — estimates are not prices`,
      );
    }
  } finally {
    await close();
  }
});
