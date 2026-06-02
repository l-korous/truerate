import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildServer } from "../src/server.js";
import { getUserRepo, getProgram, instantiateBenefits, type User } from "@truerate/core";

// Cross-channel e2e: memberships stored in the shared data store (core repo)
// must be surfaced correctly through both MCP tools. This is the product's
// central promise — one vault, multiple channels.
//
// MCP is pure membership-intelligence: it returns which discounts (%), perks,
// and conditions apply (an McpBenefitResult) — NEVER prices or savings amounts.
// These tests assert that contract directly (see issue #1 / CLAUDE.md).
//
// No HTTP server needed: in-memory repo + in-memory MCP transport exercise the
// full tool handler bodies (repo read → match → response format).

async function wire(userId: string) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = buildServer(userId);
  await server.connect(serverTransport);
  const client = new Client({ name: "test-harness", version: "1.0.0" });
  await client.connect(clientTransport);
  return { client, server };
}

async function seedUser(memberships: User["memberships"]): Promise<string> {
  const repo = await getUserRepo();
  const userId = `cross-${randomUUID()}`;
  await repo.create({
    id: userId,
    email: `${userId}@example.com`,
    passwordHash: "placeholder",
    memberships,
    createdAt: new Date().toISOString(),
    market: "cz",
    currency: "EUR",
  });
  return userId;
}

type BenefitMatch = {
  membershipLabel: string;
  discount?: { percentOff: number };
  perks: string[];
};
type SearchResult = { matches: BenefitMatch[]; programsApplied: string[] };

// --- get_membership_summary with real stored memberships -------------------

test("get_membership_summary returns catalog memberships with correct benefit lines", async () => {
  const genius = getProgram("booking_genius")!;
  const marriott = getProgram("marriott_bonvoy")!;

  const userId = await seedUser([
    {
      id: "m1",
      label: "Booking.com Genius - Level 3",
      programId: "booking_genius",
      tier: "Level 3",
      attributes: {},
      benefits: instantiateBenefits(genius, "Level 3"),
      addedAt: new Date().toISOString(),
      status: "active",
    },
    {
      id: "m2",
      label: "Marriott Bonvoy - Platinum",
      programId: "marriott_bonvoy",
      tier: "Platinum",
      attributes: {},
      benefits: instantiateBenefits(marriott, "Platinum"),
      addedAt: new Date().toISOString(),
      status: "active",
    },
  ]);

  const { client, server } = await wire(userId);
  try {
    const result = await client.callTool({ name: "get_membership_summary", arguments: {} });
    assert.ok(!result.isError, `tool error: ${JSON.stringify(result)}`);

    const text = (result.content[0] as { type: "text"; text: string }).text;

    assert.match(text, /Memberships & benefits:/);
    assert.match(text, /Booking\.com Genius/i, "Genius membership must appear");
    assert.match(text, /20% off/i, "Genius Level 3 discount must appear");
    assert.match(text, /Marriott Bonvoy/i, "Marriott membership must appear");
    assert.match(text, /breakfast/i, "Platinum free breakfast perk must appear");

    // MCP output must never contain prices — only discounts, perks, conditions.
    assert.doesNotMatch(text, /member price/i);
    assert.doesNotMatch(text, /indicative member/i);
  } finally {
    await server.close();
  }
});

// --- search_hotels with stored memberships applies discounts ---------------

test("search_hotels with Booking Genius Level 3 surfaces the 20% discount and lists the program as applied", async () => {
  const genius = getProgram("booking_genius")!;
  const userId = await seedUser([
    {
      id: "m1",
      label: "Booking.com Genius - Level 3",
      programId: "booking_genius",
      tier: "Level 3",
      attributes: {},
      benefits: instantiateBenefits(genius, "Level 3"),
      addedAt: new Date().toISOString(),
      status: "active",
    },
  ]);

  const { client, server } = await wire(userId);
  try {
    const result = await client.callTool({
      name: "search_hotels",
      arguments: { domain: "booking.com", location: "Prague" },
    });
    assert.ok(!result.isError, `tool error: ${JSON.stringify(result)}`);

    const sc = result.structuredContent as unknown as SearchResult;

    // Genius Level 3 is 20% off on Booking.com — a discount match must be present.
    const has20 = sc.matches.some(
      (m) => m.discount !== undefined && Math.round(m.discount.percentOff * 100) === 20,
    );
    assert.ok(has20, `a 20% Genius discount match must be present; got ${JSON.stringify(sc.matches)}`);
    assert.ok(
      sc.programsApplied.includes("booking_genius"),
      `booking_genius must be in programsApplied; got: ${JSON.stringify(sc.programsApplied)}`,
    );

    const text = (result.content[0] as { type: "text"; text: string }).text;
    assert.match(text, /20% off/, "formatted text must surface the discount label");
  } finally {
    await server.close();
  }
});

// --- search_hotels with Marriott Platinum surfaces perks -------------------

test("search_hotels with Marriott Platinum surfaces the breakfast perk on Marriott-brand context", async () => {
  const marriott = getProgram("marriott_bonvoy")!;
  const userId = await seedUser([
    {
      id: "m1",
      label: "Marriott Bonvoy - Platinum",
      programId: "marriott_bonvoy",
      tier: "Platinum",
      attributes: {},
      benefits: instantiateBenefits(marriott, "Platinum"),
      addedAt: new Date().toISOString(),
      status: "active",
    },
  ]);

  const { client, server } = await wire(userId);
  try {
    const result = await client.callTool({
      name: "search_hotels",
      arguments: { brand: "Marriott", location: "Vienna" },
    });
    assert.ok(!result.isError, `tool error: ${JSON.stringify(result)}`);

    const sc = result.structuredContent as unknown as SearchResult;

    // Marriott Bonvoy Platinum is a perk-only tier (free breakfast etc.) matched
    // on Marriott brands — at least one match must carry the breakfast perk.
    const hasBreakfast = sc.matches.some((m) => m.perks.some((pk) => /breakfast/i.test(pk)));
    assert.ok(hasBreakfast, `Marriott Platinum breakfast perk must appear; got ${JSON.stringify(sc.matches)}`);

    assert.ok(
      sc.programsApplied.includes("marriott_bonvoy"),
      `marriott_bonvoy must appear in programsApplied; got: ${JSON.stringify(sc.programsApplied)}`,
    );

    // Perk-only tier: no percent discount should be attached to this match.
    const marriottMatch = sc.matches.find((m) => /Marriott/i.test(m.membershipLabel));
    assert.ok(marriottMatch, "a Marriott match must be present");
    assert.strictEqual(marriottMatch!.discount, undefined, "perk-only tier must carry no % discount");
  } finally {
    await server.close();
  }
});

// --- MCP output never leaks prices regardless of membership ----------------

test("MCP text output never contains price amounts or 'member price' language", async () => {
  const genius = getProgram("booking_genius")!;
  const userId = await seedUser([
    {
      id: "m1",
      label: "Booking.com Genius - Level 3",
      programId: "booking_genius",
      tier: "Level 3",
      attributes: {},
      benefits: instantiateBenefits(genius, "Level 3"),
      addedAt: new Date().toISOString(),
      status: "active",
    },
  ]);

  const { client, server } = await wire(userId);
  try {
    const summaryResult = await client.callTool({ name: "get_membership_summary", arguments: {} });
    const summaryText = (summaryResult.content[0] as { type: "text"; text: string }).text;
    assert.doesNotMatch(summaryText, /member price/i, "summary must not contain 'member price'");
    assert.doesNotMatch(summaryText, /post.discount/i, "summary must not contain post-discount price");

    const searchResult = await client.callTool({
      name: "search_hotels",
      arguments: { domain: "booking.com", location: "Prague" },
    });
    const searchText = (searchResult.content[0] as { type: "text"; text: string }).text;
    assert.doesNotMatch(searchText, /member price/i, "search text must not contain 'member price'");
    assert.doesNotMatch(searchText, /final price/i, "search text must not contain 'final price'");
    assert.doesNotMatch(searchText, /post.discount/i, "search text must not contain 'post-discount'");
  } finally {
    await server.close();
  }
});
