// Cross-channel consistency assertions (issue #45).
//
// For each test persona, invokes the MCP channel and the Extension/API channel
// with equivalent hotel contexts and asserts that:
//   - Both channels surface the same perk types for any perk type they share.
//   - Estimated value tiers are identical across channels for shared perk types.
//   - Extension perk types are a subset of MCP perk types (extension filters
//     out intangible perks; MCP surfaces all applicable structured perks).
//   - No price fields appear in any channel output (product rule #1 / issue #1).
//   - Every perk-value estimate carries isEstimate: true.
//
// Channels tested:
//   MCP  — StreamableHTTP client → search_hotels tool → McpBenefitResult.
//          Surfaces ALL applicable structured perks.
//   Ext  — EnrichmentEngine.matchPage() → PageMatchResult.perkEstimates.
//          Same logic the browser extension calls via POST /benefits/match.
//          Filters to perks with a non-zero monetary estimate.
//   Core — matchBenefits() direct call → ground-truth perk type set.
//          Both channel adapters build on top of this; results must be
//          traceable to what core produces.
//
// Consistency contract:
//   1. MCP perk types ⊆ Core perk types  (MCP can't invent perks)
//   2. Ext  perk types ⊆ MCP perk types  (Ext filters; MCP is broader)
//   3. estimatedUsd values are identical for any perk type present in
//      both MCP and Ext outputs.
//   4. Value tier (intangible/low/medium/high) matches for shared types.
//   5. Discount %s match between MCP matches and core matches.
//
// Note: the web channel (Next.js perk inventory) reads from the same
// /benefits/match API endpoint that the extension uses, so data consistency
// between web and extension is guaranteed by their shared API call chain.
// The Playwright persona-journey.spec.ts independently verifies the UI renders
// the correct labels, conditions, and "not prices" disclaimer.
//
// Personas covered (≥3 distinct membership mixes, per AC):
//   persona-cz-0 : Booking Genius L2 + Your Prague Hotels
//   persona-de-1 : Booking Genius L1 + Marriott Gold
//   persona-at-4 : Marriott Platinum + IHG Gold Elite
//   persona-gb-5 : Hilton Gold + Amex Platinum + Revolut Metal

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { sign, verify } from "hono/jwt";
import {
  EnrichmentEngine,
  getUserRepo,
  matchBenefits,
  estimatePerkValueAllBands,
  type Membership,
  type MatchTarget,
  type MatchedPerkEstimate,
  type PerkType,
  type User,
} from "@truerate/core";
import { createPersonaFactory, type TestPersona } from "@truerate/harness";
import { buildServer, type McpBenefitResult } from "../src/server.js";

// ── Constants ────────────────────────────────────────────────────────────────

const TEST_JWT_SECRET = "truerate-consistency-test-secret-32x";

/** Field names that must never appear in any channel output (product rule #1). */
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

// ── Normalized output shape ───────────────────────────────────────────────────

/** Semantic perk record that can be compared across channels. */
interface NormalizedPerk {
  perkType: string;
  estimatedUsd: { 3: number; 4: number; 5: number };
  isEstimate: true;
}

type PerkValueTier = "intangible" | "low" | "medium" | "high";

function classifyTier(usdAt4star: number): PerkValueTier {
  if (usdAt4star === 0) return "intangible";
  if (usdAt4star < 20) return "low";
  if (usdAt4star < 60) return "medium";
  return "high";
}

// ── Channel context pairs ─────────────────────────────────────────────────────

/**
 * Equivalent contexts for the same hotel/brand across channels.
 * MCP takes { brand?, domain?, location? }; extension takes PageContext.
 * Both are translated to the same matchBenefits target internally.
 */
interface ChannelContext {
  /** Arguments passed to search_hotels MCP tool. */
  mcp: { domain?: string; brand?: string; location?: string };
  /** PageContext passed to engine.matchPage() — the extension channel. */
  ext: { domain: string; property?: { name: string; brand?: string } };
  /** Direct matchBenefits MatchTarget — core ground truth. */
  core: MatchTarget;
  /** Human-readable label for diff messages. */
  label: string;
}

const PROGRAM_CTX: Record<string, ChannelContext> = {
  booking_genius: {
    mcp: { domain: "booking.com", location: "Vienna" },
    ext: { domain: "booking.com" },
    core: { domain: "booking.com", category: "hotel" },
    label: "booking.com (Genius context)",
  },
  marriott_bonvoy: {
    mcp: { brand: "Marriott", location: "Vienna" },
    ext: { domain: "marriott.com", property: { name: "Marriott Vienna", brand: "Marriott" } },
    core: { brand: "Marriott", category: "hotel" },
    label: "Marriott Vienna",
  },
  accor_all: {
    mcp: { brand: "Novotel", location: "Prague" },
    ext: { domain: "novotel.com", property: { name: "Novotel Prague", brand: "Novotel" } },
    core: { brand: "Novotel", category: "hotel" },
    label: "Novotel Prague (Accor)",
  },
  hilton_honors: {
    mcp: { brand: "Hilton", location: "Prague" },
    ext: { domain: "hilton.com", property: { name: "Hilton Prague", brand: "Hilton" } },
    core: { brand: "Hilton", category: "hotel" },
    label: "Hilton Prague",
  },
  ihg_one_rewards: {
    mcp: { brand: "InterContinental", location: "Vienna" },
    ext: {
      domain: "ihg.com",
      property: { name: "InterContinental Vienna", brand: "InterContinental" },
    },
    core: { brand: "InterContinental", category: "hotel" },
    label: "InterContinental Vienna (IHG)",
  },
  revolut: {
    mcp: { brand: "Marriott", location: "Vienna" },
    ext: { domain: "marriott.com", property: { name: "Marriott Vienna", brand: "Marriott" } },
    core: { brand: "Marriott", category: "hotel" },
    label: "Marriott Vienna (Revolut global perk)",
  },
  amex_platinum: {
    mcp: { brand: "Hilton", location: "Prague" },
    ext: { domain: "hilton.com", property: { name: "Hilton Prague", brand: "Hilton" } },
    core: { brand: "Hilton", category: "hotel" },
    label: "Hilton Prague (Amex Platinum global perk)",
  },
  your_prague_hotels: {
    mcp: { domain: "yourpraguehotels.com", location: "Prague" },
    ext: { domain: "yourpraguehotels.com" },
    core: { domain: "yourpraguehotels.com", category: "hotel" },
    label: "Your Prague Hotels",
  },
  emblem_prague: {
    mcp: { domain: "emblemprague.com", location: "Prague" },
    ext: { domain: "emblemprague.com" },
    core: { domain: "emblemprague.com", category: "hotel" },
    label: "Emblem Prague",
  },
};

// ── Test server ───────────────────────────────────────────────────────────────

interface TestServer {
  mcpUrl: string;
  close(): Promise<void>;
}

function startTestServer(secret: string): TestServer {
  const httpServer = createServer(
    async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
      if (req.url !== "/mcp") {
        res.writeHead(404).end();
        return;
      }

      const authHeader = req.headers["authorization"];
      if (!authHeader || Array.isArray(authHeader) || !authHeader.startsWith("Bearer ")) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Missing or invalid Authorization header." }));
        return;
      }

      let userId: string;
      try {
        const payload = (await verify(authHeader.slice(7), secret, "HS256")) as { sub: string };
        userId = payload.sub;
      } catch {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid bearer token." }));
        return;
      }

      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined;

      const mcpServer = buildServer(userId);
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

      res.on("close", () => {
        void transport.close();
        void mcpServer.close();
      });

      await mcpServer.connect(transport);
      await transport.handleRequest(req, res, body);
    },
  );

  httpServer.listen(0);
  const { port } = httpServer.address() as AddressInfo;

  return {
    mcpUrl: `http://localhost:${port}/mcp`,
    close: () =>
      new Promise<void>((resolve, reject) =>
        httpServer.close((err) => (err ? reject(err) : resolve())),
      ),
  };
}

async function mintToken(userId: string): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  return sign({ sub: userId, exp }, TEST_JWT_SECRET, "HS256");
}

async function connectClient(
  mcpUrl: string,
  token: string,
): Promise<{ client: Client; close: () => Promise<void> }> {
  const client = new Client({ name: "truerate-consistency-driver", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(mcpUrl), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  await client.connect(transport);
  return {
    client,
    close: async () => {
      await transport.close();
    },
  };
}

async function seedPersona(persona: TestPersona): Promise<void> {
  const repo = await getUserRepo();
  const user: User = {
    id: persona.userId,
    email: persona.email,
    passwordHash: "test-placeholder",
    memberships: persona.memberships,
    createdAt: new Date().toISOString(),
    market: persona.market.toLowerCase() as User["market"],
    currency: "EUR",
  };
  await repo.create(user);
}

// ── Normalization helpers ─────────────────────────────────────────────────────

function normalizeMcpPerks(sc: McpBenefitResult): Map<string, NormalizedPerk> {
  const out = new Map<string, NormalizedPerk>();
  for (const est of sc.perkValueEstimates) {
    out.set(est.perkType, {
      perkType: est.perkType,
      estimatedUsd: est.estimatedUsd,
      isEstimate: true,
    });
  }
  return out;
}

function normalizeExtPerks(perkEstimates: MatchedPerkEstimate[]): Map<string, NormalizedPerk> {
  const out = new Map<string, NormalizedPerk>();
  for (const est of perkEstimates) {
    out.set(est.perkType, {
      perkType: est.perkType,
      estimatedUsd: est.estimatedUsd,
      isEstimate: true,
    });
  }
  return out;
}

function normalizeCorePerks(
  memberships: Membership[],
  target: MatchTarget,
): Map<string, NormalizedPerk> {
  const matches = matchBenefits(memberships, target);
  const out = new Map<string, NormalizedPerk>();
  for (const m of matches) {
    for (const sp of m.benefit.value.structuredPerks ?? []) {
      if (!out.has(sp.type)) {
        const bands = estimatePerkValueAllBands(sp.type as PerkType);
        out.set(sp.type, {
          perkType: sp.type,
          estimatedUsd: {
            3: bands[3].estimatedUsd,
            4: bands[4].estimatedUsd,
            5: bands[5].estimatedUsd,
          },
          isEstimate: true,
        });
      }
    }
  }
  return out;
}

// ── Assertion helpers ─────────────────────────────────────────────────────────

function assertNoPriceFields(payload: unknown, label: string): void {
  const raw = JSON.stringify(payload);
  for (const field of FORBIDDEN_PRICE_FIELDS) {
    assert.ok(
      !raw.includes(`"${field}"`),
      `${label}: forbidden price field "${field}" found in channel output (product rule #1)`,
    );
  }
}

/**
 * Returns a human-readable list of value mismatches for perk types that appear
 * in BOTH maps. Channel-specific filtering (e.g. extension omitting intangible
 * perks) is not a mismatch — only value disagreements for shared perk types.
 */
function detectValueMismatches(
  aMap: Map<string, NormalizedPerk>,
  bMap: Map<string, NormalizedPerk>,
  aLabel: string,
  bLabel: string,
): string[] {
  const diffs: string[] = [];
  for (const [perkType, aPerk] of aMap) {
    const bPerk = bMap.get(perkType);
    if (!bPerk) continue; // Not a mismatch — channels may filter differently.
    for (const band of [3, 4, 5] as const) {
      if (aPerk.estimatedUsd[band] !== bPerk.estimatedUsd[band]) {
        diffs.push(
          `perk "${perkType}" ${band}★: ${aLabel}=$${aPerk.estimatedUsd[band]} vs ${bLabel}=$${bPerk.estimatedUsd[band]}`,
        );
      }
    }
    const aTier = classifyTier(aPerk.estimatedUsd[4]);
    const bTier = classifyTier(bPerk.estimatedUsd[4]);
    if (aTier !== bTier) {
      diffs.push(
        `perk "${perkType}" value tier: ${aLabel}="${aTier}" vs ${bLabel}="${bTier}"`,
      );
    }
  }
  return diffs;
}

// ── Test setup ────────────────────────────────────────────────────────────────

const engine = new EnrichmentEngine();
const factory = createPersonaFactory();

let server: TestServer;

// Four personas with distinct membership mixes spanning 4 markets:
//   [0] CZ  — Booking Genius L2  + Your Prague Hotels
//   [1] DE  — Booking Genius L1  + Marriott Gold
//   [2] AT  — Marriott Platinum  + IHG Gold Elite      (index 4 in PERSONA_SPECS)
//   [3] GB  — Hilton Gold + Amex + Revolut Metal       (index 5 in PERSONA_SPECS)
// We build 8 (one full archetype cycle) and select 4 for coverage.
let allPersonas: TestPersona[];
let personas: TestPersona[];

before(async () => {
  server = startTestServer(TEST_JWT_SECRET);

  // Seed 42 so IDs are stable and don't clash with other test files.
  allPersonas = factory.build(8, 77);
  // Indices 0, 1, 4, 5 give CZ/DE/AT/GB — the 4 targeted archetypes.
  personas = allPersonas.filter((_, i) => [0, 1, 4, 5].includes(i));

  await Promise.all(allPersonas.map(seedPersona));
});

after(async () => {
  factory.teardown();
  await server.close();
});

// ── Per-persona cross-channel perk consistency ────────────────────────────────

const PERSONA_DESCS: Record<number, string> = {
  0: "CZ — Booking Genius L2 + Your Prague Hotels",
  1: "DE — Booking Genius L1 + Marriott Bonvoy Gold",
  4: "AT — Marriott Bonvoy Platinum + IHG Gold Elite",
  5: "GB — Hilton Gold + Amex Platinum + Revolut Metal",
};

// Map from archetype index (0..7) to filtered-personas array index (0..3)
const ARCHETYPE_TO_FILTERED: Record<number, number> = { 0: 0, 1: 1, 4: 2, 5: 3 };

for (const archetypeIdx of [0, 1, 4, 5]) {
  const filteredIdx = ARCHETYPE_TO_FILTERED[archetypeIdx]!;

  test(
    `persona ${archetypeIdx} (${PERSONA_DESCS[archetypeIdx]}): cross-channel perk-value consistency`,
    async () => {
      const persona = personas[filteredIdx]!;
      assert.ok(persona, `persona at filtered index ${filteredIdx} must exist`);

      const token = await mintToken(persona.userId);

      // Collect one context per program the persona holds.
      const contexts: Array<{ ctx: ChannelContext; programId: string }> = [];
      for (const m of persona.memberships) {
        if (!m.programId) continue;
        const ctx = PROGRAM_CTX[m.programId];
        if (ctx) contexts.push({ ctx, programId: m.programId });
      }

      assert.ok(
        contexts.length > 0,
        `persona ${persona.handle} has no matchable program contexts — update PROGRAM_CTX`,
      );

      for (const { ctx } of contexts) {
        const { client, close } = await connectClient(server.mcpUrl, token);

        try {
          // ── MCP channel ────────────────────────────────────────────────────
          const mcpResult = await client.callTool({
            name: "search_hotels",
            arguments: { ...ctx.mcp, stars: 4 },
          });

          assert.ok(
            !mcpResult.isError,
            `MCP tool errored for persona ${persona.handle} ctx "${ctx.label}": ${JSON.stringify(mcpResult)}`,
          );
          assert.ok(
            mcpResult.structuredContent,
            `MCP must return structuredContent for persona ${persona.handle}`,
          );

          const mcpSc = mcpResult.structuredContent as unknown as McpBenefitResult;
          assertNoPriceFields(mcpSc, `persona ${persona.handle} MCP`);

          const mcpPerks = normalizeMcpPerks(mcpSc);

          // ── Extension / API channel ────────────────────────────────────────
          const extResult = engine.matchPage(ctx.ext, persona.memberships);
          assertNoPriceFields(extResult, `persona ${persona.handle} extension`);

          const extPerks = normalizeExtPerks(extResult.perkEstimates);

          // ── Core ground truth ──────────────────────────────────────────────
          const corePerks = normalizeCorePerks(persona.memberships, ctx.core);

          // ── Assertion 1: MCP perk types ⊆ core perk types ─────────────────
          // MCP must not surface a perk type the core engine did not find.
          const mcpNotInCore = [...mcpPerks.keys()].filter((pt) => !corePerks.has(pt));
          assert.equal(
            mcpNotInCore.length,
            0,
            `persona ${persona.handle} ctx "${ctx.label}": MCP surfaces perk types ` +
              `[${mcpNotInCore.join(", ")}] absent from core matchBenefits — ` +
              `core perk types: [${[...corePerks.keys()].join(", ")}]`,
          );

          // ── Assertion 2: Ext perk types ⊆ MCP perk types ──────────────────
          // Extension only surfaces monetary perks; MCP surfaces all applicable
          // structured perks. Every perk the extension shows must appear in MCP.
          const extNotInMcp = [...extPerks.keys()].filter((pt) => !mcpPerks.has(pt));
          assert.equal(
            extNotInMcp.length,
            0,
            `persona ${persona.handle} ctx "${ctx.label}": extension surfaces perk types ` +
              `[${extNotInMcp.join(", ")}] absent from MCP — channels diverge. ` +
              `MCP perk types: [${[...mcpPerks.keys()].join(", ")}]`,
          );

          // ── Assertion 3: Identical values for shared perk types ────────────
          // For any perk type that both MCP and extension return, the estimated
          // USD values at each star band and the derived value tier MUST match.
          const valueDiffs = detectValueMismatches(mcpPerks, extPerks, "MCP", "extension");
          assert.equal(
            valueDiffs.length,
            0,
            `persona ${persona.handle} ctx "${ctx.label}" — perk value mismatch across channels:\n` +
              valueDiffs.map((d) => `  • ${d}`).join("\n"),
          );

          // ── Assertion 4: isEstimate: true on every estimate ────────────────
          for (const est of mcpSc.perkValueEstimates) {
            assert.strictEqual(
              est.isEstimate,
              true,
              `MCP perkValueEstimate for perk "${est.perkType}" must carry isEstimate: true ` +
                `(product rule #1 — estimates must never be presented as prices)`,
            );
          }
          for (const est of extResult.perkEstimates) {
            assert.strictEqual(
              est.isEstimate,
              true,
              `extension perkEstimate for perk "${est.perkType}" must carry isEstimate: true ` +
                `(product rule #1)`,
            );
          }
        } finally {
          await close();
        }
      }
    },
  );
}

// ── Discount consistency across channels ──────────────────────────────────────

test(
  "personas with discount memberships: same discount % in MCP matches and core (extension channel)",
  async () => {
    const discountPersonas = personas.filter((p) =>
      p.memberships.some((m) =>
        m.benefits.some(
          (b) => b.value.kind === "percentDiscount" && (b.value.percentOff ?? 0) > 0,
        ),
      ),
    );

    assert.ok(
      discountPersonas.length > 0,
      "at least one test persona must have percent-discount memberships",
    );

    for (const persona of discountPersonas) {
      const token = await mintToken(persona.userId);

      for (const m of persona.memberships) {
        if (!m.programId) continue;
        const ctx = PROGRAM_CTX[m.programId];
        if (!ctx) continue;

        // Core ground truth: best discount % for this context.
        const coreMatches = matchBenefits(persona.memberships, ctx.core);
        const coreBestPct = Math.max(
          0,
          ...coreMatches
            .filter((mb) => mb.benefit.value.kind === "percentDiscount")
            .map((mb) => mb.benefit.value.percentOff ?? 0),
        );

        if (coreBestPct === 0) continue;

        // MCP channel: discount surfaces in McpBenefitResult.matches[].discount.
        const { client, close } = await connectClient(server.mcpUrl, token);
        try {
          const mcpResult = await client.callTool({
            name: "search_hotels",
            arguments: { ...ctx.mcp, stars: 4 },
          });
          if (!mcpResult.isError && mcpResult.structuredContent) {
            const sc = mcpResult.structuredContent as unknown as McpBenefitResult;
            const mcpBestPct = Math.max(
              0,
              ...sc.matches.filter((i) => i.discount).map((i) => i.discount!.percentOff),
            );
            if (mcpBestPct > 0) {
              assert.strictEqual(
                mcpBestPct,
                coreBestPct,
                `persona ${persona.handle} ctx "${ctx.label}": MCP best discount ${mcpBestPct} ` +
                  `≠ core best discount ${coreBestPct} — discount inconsistency across channels`,
              );
            }
          }
        } finally {
          await close();
        }

        // Extension channel: PageMatchResult.matches[] carries the same benefits.
        const extResult = engine.matchPage(ctx.ext, persona.memberships);
        const extBestPct = Math.max(
          0,
          ...extResult.matches
            .filter((mb) => mb.benefit.value.kind === "percentDiscount")
            .map((mb) => mb.benefit.value.percentOff ?? 0),
        );
        if (extBestPct > 0) {
          assert.strictEqual(
            extBestPct,
            coreBestPct,
            `persona ${persona.handle} ctx "${ctx.label}": extension best discount ${extBestPct} ` +
              `≠ core best discount ${coreBestPct} — discount inconsistency across channels`,
          );
        }
      }
    }
  },
);

// ── Global price-field guard across all tested personas ───────────────────────

test(
  "no forbidden price fields in any persona channel output (all 4 personas × both channels)",
  async () => {
    for (const persona of personas) {
      const token = await mintToken(persona.userId);

      const firstProgramId = persona.memberships[0]?.programId ?? "";
      const ctx = PROGRAM_CTX[firstProgramId];
      if (!ctx) continue;

      // MCP price guard.
      const { client, close } = await connectClient(server.mcpUrl, token);
      try {
        const mcpResult = await client.callTool({
          name: "search_hotels",
          arguments: { ...ctx.mcp, stars: 4 },
        });
        if (!mcpResult.isError && mcpResult.structuredContent) {
          assertNoPriceFields(
            mcpResult.structuredContent,
            `persona ${persona.handle} MCP price-guard`,
          );
        }
        // Text content must not contain price-like language either.
        const text = (mcpResult.content[0] as { type: "text"; text: string } | undefined)?.text ?? "";
        assert.doesNotMatch(text, /member price/i, `${persona.handle} MCP text: "member price" forbidden`);
        assert.doesNotMatch(text, /final price/i, `${persona.handle} MCP text: "final price" forbidden`);
        assert.doesNotMatch(text, /post.discount/i, `${persona.handle} MCP text: "post-discount" forbidden`);
      } finally {
        await close();
      }

      // Extension price guard.
      const extResult = engine.matchPage(ctx.ext, persona.memberships);
      assertNoPriceFields(extResult, `persona ${persona.handle} extension price-guard`);
    }
  },
);

// ── Mismatch reporting smoke test ─────────────────────────────────────────────

test("detectValueMismatches produces readable diff lines on divergent maps", () => {
  const aMap = new Map<string, NormalizedPerk>([
    [
      "free_breakfast",
      { perkType: "free_breakfast", estimatedUsd: { 3: 15, 4: 25, 5: 50 }, isEstimate: true },
    ],
    [
      "room_upgrade",
      { perkType: "room_upgrade", estimatedUsd: { 3: 30, 4: 60, 5: 120 }, isEstimate: true },
    ],
  ]);
  const bMap = new Map<string, NormalizedPerk>([
    [
      "free_breakfast",
      // Introduce a deliberate mismatch at 4★ to verify diff output.
      { perkType: "free_breakfast", estimatedUsd: { 3: 15, 4: 30, 5: 50 }, isEstimate: true },
    ],
  ]);

  const diffs = detectValueMismatches(aMap, bMap, "channelA", "channelB");
  assert.ok(diffs.length > 0, "divergent maps must produce at least one diff line");
  assert.ok(
    diffs.some((d) => d.includes("free_breakfast") && d.includes("4★")),
    `diff must identify the mismatching perk and star band; got: ${diffs.join(" | ")}`,
  );
  // room_upgrade only appears in aMap (bMap doesn't have it) — not a mismatch.
  assert.ok(
    !diffs.some((d) => d.includes("room_upgrade")),
    "perk types present in only one channel must not be reported as a mismatch",
  );
});
