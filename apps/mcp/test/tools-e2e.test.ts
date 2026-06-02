import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildServer, type McpBenefitResult } from "../src/server.js";

// Wire a real MCP client↔server pair over an in-memory transport.
// No HTTP, no auth — exercises the actual tool handler bodies.
async function wire(userId = "mcp-test-user") {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = buildServer(userId);
  await server.connect(serverTransport);
  const client = new Client({ name: "test-harness", version: "1.0.0" });
  await client.connect(clientTransport);
  return { client, server };
}

test("search_hotels: returns structuredContent with no price fields for an unknown user", async () => {
  const { client, server } = await wire("mcp-search-user");
  try {
    const result = await client.callTool({
      name: "search_hotels",
      arguments: { brand: "Marriott", location: "Vienna", stars: 4 },
    });
    assert.ok(!result.isError, `tool errored: ${JSON.stringify(result)}`);
    const text = (result.content[0] as { type: "text"; text: string }).text;
    // User has no memberships → no benefits found
    assert.match(text, /No applicable benefits found|Applicable benefits/i);
    assert.match(text, /Prices are not returned/i);
    assert.ok(result.structuredContent, "structuredContent required for AI assistant consumption");
    const sc = result.structuredContent as McpBenefitResult;
    // publicOffer / price fields must not appear in MCP output
    const raw = JSON.stringify(sc);
    assert.ok(!raw.includes("publicOffer"), "publicOffer must not appear in MCP output");
    assert.ok(!raw.includes("nightlyAmount"), "nightlyAmount must not appear in MCP output");
    assert.ok(!raw.includes("totalAmount"), "totalAmount must not appear in MCP output");
    assert.ok(Array.isArray(sc.matches), "matches must be an array");
    assert.ok(Array.isArray(sc.perkValueEstimates), "perkValueEstimates must be an array");
    assert.ok(typeof sc.generatedAt === "string", "generatedAt must be present");
  } finally {
    await server.close();
  }
});

test("search_hotels: accepts domain-based context (OTA matching)", async () => {
  const { client, server } = await wire("mcp-domain-user");
  try {
    const result = await client.callTool({
      name: "search_hotels",
      arguments: { domain: "booking.com", location: "Prague" },
    });
    assert.ok(!result.isError, `tool errored: ${JSON.stringify(result)}`);
    const sc = result.structuredContent as McpBenefitResult;
    assert.ok(typeof sc.context === "object", "context object required");
    assert.strictEqual(sc.context.domain, "booking.com");
    assert.strictEqual(sc.context.location, "Prague");
  } finally {
    await server.close();
  }
});

test("search_hotels: accepts hotel-name context", async () => {
  const { client, server } = await wire("mcp-hotel-user");
  try {
    const result = await client.callTool({
      name: "search_hotels",
      arguments: { hotel: "Marriott Marquis Vienna", stars: 5 },
    });
    assert.ok(!result.isError, `tool errored: ${JSON.stringify(result)}`);
    const sc = result.structuredContent as McpBenefitResult;
    assert.strictEqual(sc.context.hotel, "Marriott Marquis Vienna");
    assert.strictEqual(sc.context.stars, 5);
  } finally {
    await server.close();
  }
});

test("get_membership_summary returns no-memberships message for a user with no stored memberships", async () => {
  const { client, server } = await wire("mcp-no-memberships-user");
  try {
    const result = await client.callTool({
      name: "get_membership_summary",
      arguments: {},
    });
    assert.ok(!result.isError);
    const text = (result.content[0] as { type: "text"; text: string }).text;
    assert.match(text, /No memberships on file yet/);
  } finally {
    await server.close();
  }
});
