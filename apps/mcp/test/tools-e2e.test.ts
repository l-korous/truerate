import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildServer } from "../src/server.js";

// Wire a real MCP client↔server pair over an in-memory transport.
// No HTTP, no auth — exercises the actual tool handler bodies (lines 39-82
// in server.ts) which were previously 0% covered.
async function wire(userId = "mcp-test-user") {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = buildServer(userId);
  await server.connect(serverTransport);
  const client = new Client({ name: "test-harness", version: "1.0.0" });
  await client.connect(clientTransport);
  return { client, server };
}

test("search_hotels tool executes end-to-end: returns hotel text and structuredContent", async () => {
  const { client, server } = await wire("mcp-search-user");
  try {
    const result = await client.callTool({
      name: "search_hotels",
      arguments: { location: "Vienna", checkIn: "2026-07-10", checkOut: "2026-07-12" },
    });
    assert.ok(!result.isError, `tool errored: ${JSON.stringify(result)}`);
    const text = (result.content[0] as { type: "text"; text: string }).text;
    assert.match(text, /Found \d+ hotel/i, "response header missing");
    assert.ok(result.structuredContent, "structuredContent required for AI assistant consumption");
    const sc = result.structuredContent as { properties: unknown[]; mode: string };
    assert.ok(Array.isArray(sc.properties) && sc.properties.length > 0, "properties must be non-empty");
    assert.strictEqual(sc.mode, "mock", "must run in mock mode during tests");
  } finally {
    await server.close();
  }
});

test("search_hotels respects the limit parameter", async () => {
  const { client, server } = await wire("mcp-limit-user");
  try {
    const result = await client.callTool({
      name: "search_hotels",
      arguments: { location: "Prague", checkIn: "2026-08-01", checkOut: "2026-08-03", limit: 2 },
    });
    assert.ok(!result.isError);
    const sc = result.structuredContent as { properties: unknown[] };
    assert.strictEqual(sc.properties.length, 2, "limit: 2 must return exactly 2 properties");
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
