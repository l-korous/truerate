// Unit tests for the persona & test-data factory (#39).
//
// Covers:
//   - Output shape (required fields, types)
//   - Determinism (same seed → identical output)
//   - Diversity (distinct markets/languages/membership mixes)
//   - No price fields anywhere (product rule #1)
//   - Teardown clears in-memory state

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { PROGRAMS } from "@truerate/core";
import {
  createPersonaFactory,
  type TestPersona,
  type ExpectedPerkContract,
} from "../src/persona.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function assertNoPriceFields(obj: unknown, path = "root"): void {
  const PRICE_KEYS = ["price", "nightly", "finalPrice", "memberPrice", "totalAmount", "amountOff", "baseRate"];
  if (typeof obj !== "object" || obj === null) return;
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    // estimatedUsd is explicitly allowed — it is tagged isEstimate: true
    if (k === "estimatedUsd") continue;
    if (PRICE_KEYS.some((bad) => k.toLowerCase().includes(bad.toLowerCase()))) {
      assert.fail(`Price field '${k}' found at ${path}.${k}`);
    }
    if (typeof v === "object") assertNoPriceFields(v, `${path}.${k}`);
  }
}

// ---------------------------------------------------------------------------
// Factory creation
// ---------------------------------------------------------------------------

describe("createPersonaFactory", () => {
  test("returns an object with build and teardown methods", () => {
    const factory = createPersonaFactory();
    assert.equal(typeof factory.build, "function");
    assert.equal(typeof factory.teardown, "function");
  });

  test("throws RangeError when n < 1", () => {
    const factory = createPersonaFactory();
    assert.throws(() => factory.build(0), RangeError);
    assert.throws(() => factory.build(-1), RangeError);
  });
});

// ---------------------------------------------------------------------------
// Output shape
// ---------------------------------------------------------------------------

describe("persona output shape", () => {
  const factory = createPersonaFactory();
  const personas = factory.build(3, 0);

  test("returns exactly n personas", () => {
    assert.equal(personas.length, 3);
  });

  test("each persona has required string fields", () => {
    for (const p of personas) {
      assert.equal(typeof p.handle, "string", "handle must be string");
      assert.equal(typeof p.email, "string", "email must be string");
      assert.equal(typeof p.userId, "string", "userId must be string");
      assert.equal(typeof p.market, "string", "market must be string");
      assert.equal(typeof p.language, "string", "language must be string");
      assert.equal(typeof p.vaultRef, "string", "vaultRef must be string");
      assert.equal(typeof p.mcpUrl, "string", "mcpUrl must be string");
    }
  });

  test("handle matches expected pattern", () => {
    for (const p of personas) {
      assert.match(p.handle, /^persona-[a-z]+-\d+$/, `handle '${p.handle}' has wrong format`);
    }
  });

  test("email is derived from handle", () => {
    for (const p of personas) {
      assert.ok(p.email.startsWith(p.handle), `email '${p.email}' should start with handle`);
      assert.ok(p.email.endsWith("@truerate-test.local"), "email must use test domain");
    }
  });

  test("vaultRef equals userId", () => {
    for (const p of personas) {
      assert.equal(p.vaultRef, p.userId, "vaultRef must equal userId");
    }
  });

  test("mcpUrl contains userId and default base", () => {
    for (const p of personas) {
      assert.ok(p.mcpUrl.includes("mcp.truerate.test"), "mcpUrl uses default base");
      assert.ok(p.mcpUrl.includes(encodeURIComponent(p.userId)), "mcpUrl includes userId");
      assert.ok(p.mcpUrl.endsWith("/sse"), "mcpUrl ends with /sse");
    }
  });

  test("mcpUrl uses custom base when provided", () => {
    const f2 = createPersonaFactory({ mcpBaseUrl: "https://custom.mcp.example.com" });
    const [p] = f2.build(1, 0);
    assert.ok(p!.mcpUrl.startsWith("https://custom.mcp.example.com"), "uses custom base");
  });

  test("each persona has a memberships array with at least one entry", () => {
    for (const p of personas) {
      assert.ok(Array.isArray(p.memberships), "memberships must be array");
      assert.ok(p.memberships.length >= 1, "must have at least one membership");
    }
  });

  test("memberships reference real programs.ts programs", () => {
    const programIds = new Set(PROGRAMS.map((p) => p.id));
    for (const persona of personas) {
      for (const m of persona.memberships) {
        assert.ok(m.programId, "membership must have programId");
        assert.ok(programIds.has(m.programId!), `programId '${m.programId}' must exist in programs.ts`);
      }
    }
  });

  test("memberships have active status", () => {
    for (const p of personas) {
      for (const m of p.memberships) {
        assert.equal(m.status, "active", "test memberships must be active");
      }
    }
  });

  test("each persona has an expectedPerks array", () => {
    for (const p of personas) {
      assert.ok(Array.isArray(p.expectedPerks), "expectedPerks must be array");
    }
  });

  test("expectedPerks entries have required fields", () => {
    const withPerks = personas.filter((p) => p.expectedPerks.length > 0);
    assert.ok(withPerks.length > 0, "at least one persona should have expectedPerks");

    for (const p of withPerks) {
      for (const ep of p.expectedPerks) {
        assert.equal(typeof ep.perkType, "string", "perkType must be string");
        assert.equal(typeof ep.label, "string", "label must be string");
        assert.equal(typeof ep.membershipLabel, "string", "membershipLabel must be string");
        assert.equal(ep.isEstimate, true, "isEstimate must be true");
        assert.ok(["intangible", "low", "medium", "high"].includes(ep.valueTier), `invalid valueTier '${ep.valueTier}'`);
      }
    }
  });

  test("expectedPerks estimatedUsd covers all three star bands", () => {
    for (const p of personas) {
      for (const ep of p.expectedPerks) {
        assert.equal(typeof ep.estimatedUsd[3], "number", "band 3 must be number");
        assert.equal(typeof ep.estimatedUsd[4], "number", "band 4 must be number");
        assert.equal(typeof ep.estimatedUsd[5], "number", "band 5 must be number");
        assert.ok(ep.estimatedUsd[3] >= 0, "band 3 must be non-negative");
        assert.ok(ep.estimatedUsd[4] >= 0, "band 4 must be non-negative");
        assert.ok(ep.estimatedUsd[5] >= 0, "band 5 must be non-negative");
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

describe("determinism", () => {
  test("same seed produces identical handles", () => {
    const factory = createPersonaFactory();
    const a = factory.build(5, 42);
    const b = factory.build(5, 42);
    for (let i = 0; i < a.length; i++) {
      assert.equal(a[i]!.handle, b[i]!.handle);
      assert.equal(a[i]!.email, b[i]!.email);
      assert.equal(a[i]!.userId, b[i]!.userId);
    }
  });

  test("same seed produces identical membership sets", () => {
    const factory = createPersonaFactory();
    const a = factory.build(4, 7);
    const b = factory.build(4, 7);
    for (let i = 0; i < a.length; i++) {
      const aIds = a[i]!.memberships.map((m) => m.programId).sort();
      const bIds = b[i]!.memberships.map((m) => m.programId).sort();
      assert.deepEqual(aIds, bIds, `persona ${i}: membership programIds must match`);
    }
  });

  test("same seed produces identical expectedPerks", () => {
    const factory = createPersonaFactory();
    const a = factory.build(4, 7);
    const b = factory.build(4, 7);
    for (let i = 0; i < a.length; i++) {
      const aPerks = a[i]!.expectedPerks.map((ep) => ep.perkType).sort();
      const bPerks = b[i]!.expectedPerks.map((ep) => ep.perkType).sort();
      assert.deepEqual(aPerks, bPerks, `persona ${i}: expectedPerks perkTypes must match`);
    }
  });

  test("different seeds produce different userIds", () => {
    const factory = createPersonaFactory();
    const seed0 = factory.build(3, 0);
    const seed1 = factory.build(3, 1);
    const ids0 = seed0.map((p) => p.userId);
    const ids1 = seed1.map((p) => p.userId);
    const overlap = ids0.filter((id) => ids1.includes(id));
    assert.equal(overlap.length, 0, "different seeds must produce different userIds");
  });

  test("build is idempotent: calling twice with same args is stable", () => {
    const factory = createPersonaFactory();
    const first = factory.build(2, 99);
    const second = factory.build(2, 99);
    assert.deepEqual(
      first.map((p) => ({ handle: p.handle, userId: p.userId, market: p.market })),
      second.map((p) => ({ handle: p.handle, userId: p.userId, market: p.market })),
    );
  });
});

// ---------------------------------------------------------------------------
// Diversity
// ---------------------------------------------------------------------------

describe("diversity", () => {
  test("8 personas cover all 8 base archetypes (distinct markets)", () => {
    const factory = createPersonaFactory();
    const personas = factory.build(8, 0);
    const markets = new Set(personas.map((p) => p.market));
    assert.ok(markets.size >= 4, `should cover at least 4 markets, got ${[...markets].join(", ")}`);
  });

  test("8 personas cover multiple languages", () => {
    const factory = createPersonaFactory();
    const personas = factory.build(8, 0);
    const langs = new Set(personas.map((p) => p.language));
    assert.ok(langs.size >= 4, `should cover at least 4 languages, got ${[...langs].join(", ")}`);
  });

  test("8 personas cover multiple distinct membership mixes", () => {
    const factory = createPersonaFactory();
    const personas = factory.build(8, 0);
    const mixes = personas.map((p) => p.memberships.map((m) => m.programId).sort().join(","));
    const uniqueMixes = new Set(mixes);
    assert.ok(uniqueMixes.size >= 4, `should have at least 4 distinct membership mixes`);
  });

  test("personas with index > 8 cycle through archetypes", () => {
    const factory = createPersonaFactory();
    const personas = factory.build(16, 0);
    assert.equal(personas.length, 16);
    assert.equal(personas[0]!.market, personas[8]!.market, "index 0 and 8 share the same archetype market");
  });

  test("personas include Czech-market entries (CZ is the first-launch market)", () => {
    const factory = createPersonaFactory();
    const personas = factory.build(8, 0);
    const hasCz = personas.some((p) => p.market === "CZ");
    assert.ok(hasCz, "should include at least one CZ persona");
  });
});

// ---------------------------------------------------------------------------
// No price fields (product rule #1)
// ---------------------------------------------------------------------------

describe("price-field guard (product rule #1)", () => {
  test("no price fields in any persona", () => {
    const factory = createPersonaFactory();
    const personas = factory.build(8, 0);
    for (const p of personas) {
      assertNoPriceFields(p, `persona:${p.handle}`);
    }
  });

  test("no price fields in expectedPerks", () => {
    const factory = createPersonaFactory();
    const personas = factory.build(8, 0);
    for (const p of personas) {
      for (const ep of p.expectedPerks) {
        assertNoPriceFields(ep, `${p.handle}.expectedPerks`);
      }
    }
  });

  test("no price fields in memberships", () => {
    const factory = createPersonaFactory();
    const personas = factory.build(8, 0);
    for (const p of personas) {
      for (const m of p.memberships) {
        assertNoPriceFields(m, `${p.handle}.memberships`);
      }
    }
  });

  test("isEstimate is always true on every ExpectedPerkContract", () => {
    const factory = createPersonaFactory();
    const personas = factory.build(8, 0);
    for (const p of personas) {
      for (const ep of p.expectedPerks) {
        assert.equal(ep.isEstimate, true, `${p.handle}:${ep.perkType} must have isEstimate: true`);
      }
    }
  });

  test("valueTier is a qualitative label, not a number", () => {
    const factory = createPersonaFactory();
    const personas = factory.build(8, 0);
    for (const p of personas) {
      for (const ep of p.expectedPerks) {
        assert.equal(typeof ep.valueTier, "string", "valueTier must be a string label, not a number");
        assert.notEqual(typeof ep.valueTier, "number");
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Teardown
// ---------------------------------------------------------------------------

describe("teardown", () => {
  test("teardown does not throw", () => {
    const factory = createPersonaFactory();
    factory.build(3, 0);
    assert.doesNotThrow(() => factory.teardown());
  });

  test("teardown is idempotent (can be called multiple times)", () => {
    const factory = createPersonaFactory();
    factory.build(2, 0);
    factory.teardown();
    assert.doesNotThrow(() => factory.teardown());
  });

  test("build works normally after teardown", () => {
    const factory = createPersonaFactory();
    factory.build(2, 0);
    factory.teardown();
    const personas = factory.build(2, 0);
    assert.equal(personas.length, 2);
    assert.ok(personas[0]!.handle, "persona should have a handle after re-build");
  });
});
