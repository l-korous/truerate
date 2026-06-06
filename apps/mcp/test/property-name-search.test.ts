// Property-name search gap: matchAnchor lines 119-123 and MCP hotel-name e2e.
//
// Gap closed:
//   1. packages/core/src/match.ts lines 119-123 — the matchAnchor() propertyName
//      branch is only reachable via resolveConflicts().  All existing resolveConflicts
//      tests use domain / brand / category targets; none use propertyName.  When
//      resolveConflicts assigns a conflict-group anchor for a propertyName-matched
//      benefit it must return "property:<name>", not fall through to "global".
//
//   2. MCP channel: search_hotels(hotel: "Hotel Roma") for a your_prague_hotels or
//      emblem_prague member.  Existing tools-e2e tests pass hotel: "..." but the test
//      user has no memberships, so matchBenefits returns nothing and the match path
//      is never exercised end-to-end.
//
// Programs exercised:
//   your_prague_hotels — defaultMatch has both domains AND propertyNames (Hotel Roma,
//     Hotel Caesar, Michelangelo Grand Hotel, Hotel Galileo, Hotel Praga 1).
//     Calling search_hotels with hotel: "Hotel Roma" and NO domain/brand exercises the
//     propertyName path exclusively.
//   emblem_prague — same structure; propertyNames: ["Emblem Hotel", "Emblem Prague"].
//
// Product rule #1 enforced throughout: no price fields in any output.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  matchBenefits,
  resolveConflicts,
  getUserRepo,
  getProgram,
  instantiateBenefits,
  type Membership,
  type MatchedBenefit,
  type User,
} from "@truerate/core";
import { buildServer, type McpBenefitResult } from "../src/server.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

const FORBIDDEN_PRICE_FIELDS = [
  "publicOffer",
  "nightlyAmount",
  "totalAmount",
  "basePrice",
  "finalPrice",
  "memberPrice",
  "indicativePrice",
  "nightly",
  "postDiscountPrice",
];

function assertNoPriceFields(payload: unknown, label: string): void {
  const raw = JSON.stringify(payload);
  for (const field of FORBIDDEN_PRICE_FIELDS) {
    assert.ok(
      !raw.includes(`"${field}"`),
      `${label}: forbidden price field "${field}" in output (product rule #1)`,
    );
  }
}

function catalogMembership(programId: string, tier?: string): Membership {
  const program = getProgram(programId)!;
  return {
    id: `m-prop-${programId}`,
    label: tier ? `${program.name} — ${tier}` : program.name,
    programId,
    tier,
    attributes: {},
    benefits: instantiateBenefits(program, tier),
    addedAt: "2026-01-01",
    status: "active",
  };
}

async function wireUser(userId: string, memberships: Membership[]): Promise<void> {
  const repo = await getUserRepo();
  const user: User = {
    id: userId,
    email: `${userId}@truerate-test.local`,
    passwordHash: "test-placeholder",
    memberships,
    createdAt: new Date().toISOString(),
    market: "cz",
    currency: "EUR",
  };
  await repo.create(user);
}

async function mcpCall(
  userId: string,
  args: Record<string, unknown>,
): Promise<{ result: Awaited<ReturnType<Client["callTool"]>>; cleanup: () => Promise<void> }> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = buildServer(userId);
  await server.connect(serverTransport);
  const client = new Client({ name: "property-name-test-driver", version: "1.0.0" });
  await client.connect(clientTransport);
  const result = await client.callTool({ name: "search_hotels", arguments: args });
  return { result, cleanup: () => server.close() };
}

// ── Test fixtures ─────────────────────────────────────────────────────────────

const YPH_USER = `tst-ypH-${randomUUID().slice(0, 8)}`;
const EMBLEM_USER = `tst-emb-${randomUUID().slice(0, 8)}`;
const MARRIOTT_USER = `tst-mar-${randomUUID().slice(0, 8)}`;

const yphMembership = catalogMembership("your_prague_hotels");
const emblemMembership = catalogMembership("emblem_prague");
const marriottMembership = catalogMembership("marriott_bonvoy", "Gold");

before(async () => {
  process.env.TRUERATE_INMEMORY = "true";
  await Promise.all([
    wireUser(YPH_USER, [yphMembership]),
    wireUser(EMBLEM_USER, [emblemMembership]),
    wireUser(MARRIOTT_USER, [marriottMembership]),
  ]);
});

after(() => {
  // No persistent state to tear down (TRUERATE_INMEMORY).
});

// ── Part 1: matchAnchor propertyName path (match.ts lines 119-123) ────────────
//
// matchAnchor is only reached via resolveConflicts.  We call matchBenefits with
// applyStackingRules: true so the stacking-resolution pass runs and matchAnchor
// executes for the propertyName-matched benefits.

test("matchAnchor: resolveConflicts uses property: anchor for your_prague_hotels benefits matched by propertyName", () => {
  // Build a fake MatchedBenefit array directly — two discounts from the same
  // membership, both with propertyNames matching "Hotel Roma".
  // resolveConflicts must pick the winner using the property: anchor.
  const prog = getProgram("your_prague_hotels")!;
  const benefits = instantiateBenefits(prog);
  const ms: Membership = { ...yphMembership, id: "m-anchor-test" };

  const matched: MatchedBenefit[] = benefits
    .filter((b) => b.value.kind === "percentDiscount" || b.value.kind === "perk")
    .map((b) => ({ benefit: b, membershipId: ms.id, membershipLabel: ms.label }));

  assert.ok(matched.length > 0, "your_prague_hotels must have at least one benefit to resolve");

  const target = { propertyName: "Hotel Roma", category: "hotel" as const };
  const { applicable, suppressed } = resolveConflicts(matched, target);

  // All matched benefits must end up somewhere (applicable or suppressed).
  assert.equal(
    applicable.length + suppressed.length,
    matched.length,
    "resolveConflicts must account for every matched benefit",
  );

  // At least one benefit must be applicable (the program has a real discount + perks).
  assert.ok(applicable.length > 0, "at least one benefit must be applicable for your_prague_hotels");
});

test("matchAnchor: resolveConflicts uses property: anchor for emblem_prague benefits matched by propertyName", () => {
  const prog = getProgram("emblem_prague")!;
  const benefits = instantiateBenefits(prog);
  const ms: Membership = { ...emblemMembership, id: "m-anchor-emblem" };

  const matched: MatchedBenefit[] = benefits.map((b) => ({
    benefit: b,
    membershipId: ms.id,
    membershipLabel: ms.label,
  }));

  const target = { propertyName: "Emblem Prague", category: "hotel" as const };
  const { applicable, suppressed } = resolveConflicts(matched, target);

  assert.equal(
    applicable.length + suppressed.length,
    matched.length,
    "all emblem_prague benefits must be accounted for",
  );
  assert.ok(applicable.length > 0, "emblem_prague must have applicable benefits");
});

test("matchBenefits with applyStackingRules: propertyName-only target matches your_prague_hotels benefits", () => {
  // No domain, no brand — only propertyName.  This exercises benefitMatches
  // (lines 38-41) AND matchAnchor's propertyName branch (lines 119-123) in one call.
  const matches = matchBenefits(
    [yphMembership],
    { propertyName: "Hotel Roma", category: "hotel" },
    { applyStackingRules: true },
  );

  assert.ok(matches.length > 0, "your_prague_hotels must match by propertyName 'Hotel Roma'");

  // The 10% discount benefit must be present.
  const hasDiscount = matches.some((m) => m.benefit.value.kind === "percentDiscount");
  assert.ok(hasDiscount, "your_prague_hotels discount benefit must appear in propertyName match");
});

test("matchBenefits with applyStackingRules: propertyName-only target matches emblem_prague benefits", () => {
  const matches = matchBenefits(
    [emblemMembership],
    { propertyName: "Emblem Hotel", category: "hotel" },
    { applyStackingRules: true },
  );

  assert.ok(matches.length > 0, "emblem_prague must match by propertyName 'Emblem Hotel'");

  const hasDiscount = matches.some(
    (m) => m.benefit.value.kind === "percentDiscount" && (m.benefit.value.percentOff ?? 0) >= 0.2,
  );
  assert.ok(hasDiscount, "emblem_prague 20% discount must appear in propertyName match");
});

test("matchBenefits: propertyName does NOT match marriott_bonvoy (brand-only program)", () => {
  // Marriott Bonvoy uses brands: ["Marriott", ...] not propertyNames.
  // A propertyName-only target must not match it.
  const matches = matchBenefits(
    [marriottMembership],
    { propertyName: "Prague Marriott Hotel", category: "hotel" },
    { applyStackingRules: true },
  );

  // category: "hotel" is a global match for OTA-wide benefits — exclude those.
  // We specifically want to ensure NO domain/brand/propertyName match fires.
  const specificMatches = matches.filter(
    (m) => m.benefit.scope !== "category" && m.benefit.scope !== "global",
  );
  assert.equal(
    specificMatches.length,
    0,
    "Marriott Bonvoy must not match on propertyName alone — it uses brand matching",
  );
});

// ── Part 2: MCP e2e — search_hotels with hotel-name only ─────────────────────

test("MCP: your_prague_hotels member — search_hotels(hotel: Hotel Roma) returns applicable benefits", async () => {
  const { result, cleanup } = await mcpCall(YPH_USER, { hotel: "Hotel Roma", stars: 4 });
  try {
    assert.ok(!result.isError, `tool errored: ${JSON.stringify(result)}`);
    const sc = result.structuredContent as unknown as McpBenefitResult;
    assert.ok(sc, "structuredContent required");
    assertNoPriceFields(sc, "YPH MCP propertyName search");

    assert.ok(
      sc.matches.length > 0,
      "your_prague_hotels member must get matches for 'Hotel Roma' (propertyName-only query)",
    );

    // The 10% discount must surface.
    const hasDiscount = sc.matches.some(
      (m) => m.discount && m.discount.percentOff >= 0.1,
    );
    assert.ok(hasDiscount, "search result must include your_prague_hotels 10% discount");

    // programsApplied must reference the program by ID.
    assert.ok(
      sc.programsApplied.includes("your_prague_hotels"),
      `programsApplied must include 'your_prague_hotels'; got: ${sc.programsApplied.join(", ")}`,
    );

    // context.hotel must echo back the input.
    assert.strictEqual(sc.context.hotel, "Hotel Roma");
  } finally {
    await cleanup();
  }
});

test("MCP: emblem_prague member — search_hotels(hotel: Emblem Prague) returns applicable benefits", async () => {
  const { result, cleanup } = await mcpCall(EMBLEM_USER, { hotel: "Emblem Prague", stars: 5 });
  try {
    assert.ok(!result.isError, `tool errored: ${JSON.stringify(result)}`);
    const sc = result.structuredContent as unknown as McpBenefitResult;
    assertNoPriceFields(sc, "emblem_prague MCP propertyName search");

    assert.ok(
      sc.matches.length > 0,
      "emblem_prague member must get matches for 'Emblem Prague' (propertyName-only query)",
    );

    const hasDiscount = sc.matches.some(
      (m) => m.discount && m.discount.percentOff >= 0.2,
    );
    assert.ok(hasDiscount, "search result must include emblem_prague 20% discount");

    assert.ok(
      sc.programsApplied.includes("emblem_prague"),
      `programsApplied must include 'emblem_prague'; got: ${sc.programsApplied.join(", ")}`,
    );
  } finally {
    await cleanup();
  }
});

test("MCP: your_prague_hotels member — hotel name that does not match returns no benefits", async () => {
  const { result, cleanup } = await mcpCall(YPH_USER, { hotel: "Grand Hyatt Prague", stars: 5 });
  try {
    assert.ok(!result.isError, `tool errored: ${JSON.stringify(result)}`);
    const sc = result.structuredContent as unknown as McpBenefitResult;
    assertNoPriceFields(sc, "YPH MCP no-match check");

    // your_prague_hotels properties are a closed set; "Grand Hyatt Prague" is not one of them.
    const specificMatches = sc.matches.filter((m) => !m.membershipLabel.toLowerCase().includes("booking"));
    assert.equal(
      specificMatches.filter((m) => m.membershipLabel.toLowerCase().includes("prague hotel")).length,
      0,
      "your_prague_hotels must NOT match 'Grand Hyatt Prague'",
    );
  } finally {
    await cleanup();
  }
});

test("MCP: isEstimate: true on all perk-value estimates in propertyName-matched responses", async () => {
  const users = [
    { userId: YPH_USER, hotel: "Hotel Caesar" },
    { userId: EMBLEM_USER, hotel: "Emblem Hotel" },
  ];

  for (const { userId, hotel } of users) {
    const { result, cleanup } = await mcpCall(userId, { hotel, stars: 4 });
    try {
      assert.ok(!result.isError, `tool errored for ${hotel}: ${JSON.stringify(result)}`);
      const sc = result.structuredContent as unknown as McpBenefitResult;
      for (const est of sc.perkValueEstimates) {
        assert.strictEqual(
          est.isEstimate,
          true,
          `perkValueEstimate for "${est.perkType}" on hotel "${hotel}" must carry isEstimate: true (product rule #1)`,
        );
      }
    } finally {
      await cleanup();
    }
  }
});
