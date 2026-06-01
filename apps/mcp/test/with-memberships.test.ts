import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildServer } from "../src/server.js";
import {
  getUserRepo,
  getProgram,
  instantiateBenefits,
  type User,
} from "@truerate/core";

// Cross-channel e2e: memberships stored in the shared data store (core repo)
// must be surfaced correctly through both MCP tools. This is the product's
// central promise — one vault, multiple channels — and previously had zero
// coverage (existing MCP tests only exercised the empty-user case).
//
// No HTTP server needed: in-memory repo + in-memory MCP transport exercise
// the full tool handler bodies (repo read → enrichment → response format).

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
  const userId = `cross-${Date.now()}-${Math.random().toString(36).slice(2)}`;
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

test("search_hotels with Booking Genius Level 3 produces savings and lists the program as applied", async () => {
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
      arguments: { location: "Prague", checkIn: "2026-08-01", checkOut: "2026-08-03" },
    });
    assert.ok(!result.isError);

    const sc = result.structuredContent as {
      properties: { savingsAmount: number }[];
      totalSavings: number;
      programsApplied: string[];
    };

    // Genius Level 3 is 20% off all Booking.com properties — savings must be positive.
    assert.ok(sc.totalSavings > 0, `totalSavings must be > 0 when Genius is applied; got ${sc.totalSavings}`);
    assert.ok(
      sc.programsApplied.includes("booking_genius"),
      `booking_genius must be in programsApplied; got: ${JSON.stringify(sc.programsApplied)}`,
    );
    // Every property should have a savings amount (Genius matches all booking.com hotels).
    assert.ok(
      sc.properties.every((p) => p.savingsAmount > 0),
      "all mock booking.com properties should show Genius savings",
    );
  } finally {
    await server.close();
  }
});

// --- search_hotels with Marriott Platinum surfaces perks -------------------

test("search_hotels with Marriott Platinum surfaces breakfast perk on Marriott-brand properties", async () => {
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
      arguments: { location: "Vienna", checkIn: "2026-08-01", checkOut: "2026-08-03" },
    });
    assert.ok(!result.isError);

    const sc = result.structuredContent as {
      properties: { name: string; brand?: string; perks: string[] }[];
      programsApplied: string[];
    };

    // Marriott Bonvoy Platinum includes free breakfast on Marriott-brand properties.
    // The mock dataset includes Sheraton Grand, Courtyard Park, Westin Belvedere
    // all tagged with brand "Marriott" — at least one must carry the perk.
    const marriottProperties = sc.properties.filter((p) => p.brand === "Marriott");
    assert.ok(marriottProperties.length > 0, "mock data must include Marriott-brand properties");

    const hasBreakfastPerk = marriottProperties.some((p) =>
      p.perks.some((pk) => /breakfast/i.test(pk)),
    );
    assert.ok(hasBreakfastPerk, "Marriott Platinum breakfast perk must appear on Marriott-brand properties");

    // Marriott Platinum is a perk-only tier (no % discount), so totalSavings should
    // not come from this membership (no monetary discount benefit defined).
    assert.ok(
      sc.programsApplied.includes("marriott_bonvoy"),
      `marriott_bonvoy must appear in programsApplied; got: ${JSON.stringify(sc.programsApplied)}`,
    );
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
    // summary
    const summaryResult = await client.callTool({ name: "get_membership_summary", arguments: {} });
    const summaryText = (summaryResult.content[0] as { type: "text"; text: string }).text;
    assert.doesNotMatch(summaryText, /member price/i, "summary must not contain 'member price'");
    assert.doesNotMatch(summaryText, /post.discount/i, "summary must not contain post-discount price");

    // search
    const searchResult = await client.callTool({
      name: "search_hotels",
      arguments: { location: "Prague", checkIn: "2026-09-01", checkOut: "2026-09-03" },
    });
    const searchText = (searchResult.content[0] as { type: "text"; text: string }).text;
    // "member (est.)" is the MCP's savings notation (see formatResult) — that's fine.
    // What's NOT allowed: "member price" (implying a final price TrueRate computed).
    assert.doesNotMatch(searchText, /member price/i, "search text must not contain 'member price'");
    assert.doesNotMatch(searchText, /final price/i, "search text must not contain 'final price'");
    assert.doesNotMatch(searchText, /post.discount/i, "search text must not contain 'post-discount'");
  } finally {
    await server.close();
  }
});
