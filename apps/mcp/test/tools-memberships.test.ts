import { test, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildServer } from "../src/server.js";
import { getUserRepo, getProgram, instantiateBenefits } from "@truerate/core";

// Cross-component journey: real membership data seeded in the MemoryUserRepo →
// MCP tools fetch + apply it → enrichment engine matches benefits.
//
// This covers the previously untested truthy branch of get_membership_summary
// (server.ts lines 73-74, 82) and verifies that search_hotels surfaces the
// Genius discount in structuredContent and formatted text when a matching
// membership exists.

const GENIUS_USER_ID = "mcp-genius-level3-synthetic-user";

before(async () => {
  const program = getProgram("booking_genius");
  assert.ok(program, "booking_genius must exist in the catalog");
  const benefits = instantiateBenefits(program, "Level 3");
  const repo = await getUserRepo();
  await repo.create({
    id: GENIUS_USER_ID,
    email: "genius-l3-mcp-test@example.com",
    passwordHash: "not-a-real-hash",
    memberships: [
      {
        id: randomUUID(),
        label: "Booking.com Genius - Level 3",
        programId: "booking_genius",
        tier: "Level 3",
        attributes: {},
        benefits,
        addedAt: new Date().toISOString(),
        status: "active",
      },
    ],
    createdAt: new Date().toISOString(),
    market: "cz",
    currency: "EUR",
  });
});

async function wire(userId: string) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = buildServer(userId);
  await server.connect(serverTransport);
  const client = new Client({ name: "test-harness", version: "1.0.0" });
  await client.connect(clientTransport);
  return { client, server };
}

test("get_membership_summary: lists Genius Level 3 with 20% discount (not empty state)", async () => {
  const { client, server } = await wire(GENIUS_USER_ID);
  try {
    const result = await client.callTool({ name: "get_membership_summary", arguments: {} });
    assert.ok(!result.isError, `tool errored: ${JSON.stringify(result)}`);
    const text = (result.content[0] as { type: "text"; text: string }).text;
    assert.match(text, /Booking\.com Genius/i, "must name the program");
    assert.match(text, /20%/, "must surface the 20% discount");
    assert.doesNotMatch(text, /No memberships on file yet/i, "must not show empty state when memberships exist");
  } finally {
    await server.close();
  }
});

test("search_hotels: Genius Level 3 discount appears in matched properties and programsApplied", async () => {
  const { client, server } = await wire(GENIUS_USER_ID);
  try {
    const result = await client.callTool({
      name: "search_hotels",
      arguments: { location: "Vienna", checkIn: "2026-07-10", checkOut: "2026-07-12" },
    });
    assert.ok(!result.isError, `tool errored: ${JSON.stringify(result)}`);

    const sc = result.structuredContent as {
      properties: Array<{
        matches: Array<{ benefit: { value: { kind: string; percentOff?: number } }; membershipLabel: string }>;
      }>;
      programsApplied: string[];
    };

    // All mock properties come from booking.com so the domain match fires on every one.
    const hasGenius = sc.properties.some((p) =>
      p.matches.some(
        (m) =>
          m.benefit.value.kind === "percentDiscount" &&
          Math.round((m.benefit.value.percentOff ?? 0) * 100) === 20,
      ),
    );
    assert.ok(hasGenius, "at least one property must carry the Genius 20% discount");

    assert.ok(sc.programsApplied.length > 0, "programsApplied must not be empty when a matching membership exists");

    // The formatted text output must also surface the discount label.
    const text = (result.content[0] as { type: "text"; text: string }).text;
    assert.match(text, /20% off/, "formatted text must include the discount label");
  } finally {
    await server.close();
  }
});
