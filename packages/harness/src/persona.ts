// Persona & test-data factory for the TrueRate synthetic-user harness.
//
// Produces reproducible test personas backed by real programs.ts membership
// data. Each persona carries a typed expected-perks contract for use in
// channel drivers and cross-channel consistency tests.
//
// Hard rules enforced here (matching #1):
//   - No price fields anywhere in personas, contracts, or fixtures.
//   - estimatedUsd values are always tagged isEstimate: true — never prices.
//   - Program data is imported from packages/core — not duplicated.

import type {
  Membership,
  PerkType,
  PerkConditions,
} from "@truerate/core";
import {
  PROGRAMS,
  instantiateBenefits,
  estimatePerkValueAllBands,
} from "@truerate/core";

// ---------------------------------------------------------------------------
// Seeded PRNG (mulberry32) — deterministic persona generation without deps.
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// FNV-1a hash → 8-char hex string. Used to derive stable IDs from strings.
function fnv1a(input: string): string {
  let h = 0x811c9dc5 >>> 0;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Qualitative value tier for a perk, derived from the 4★ USD estimate.
 * Intangible means the perk has no direct monetary replacement cost.
 * This is NOT a price — it is a qualitative classification.
 */
export type PerkValueTier = "intangible" | "low" | "medium" | "high";

/**
 * Expected perk contract for a test persona.
 *
 * Represents what a channel driver or consistency test should observe when
 * the persona's memberships are applied to a matching hotel context.
 *
 * Product rule #1 invariants:
 *   - No price fields. No "price", "discount amount", or "final rate".
 *   - estimatedUsd values are illustrative estimates (isEstimate: true always).
 *   - valueTier is a qualitative label, NOT a computed price.
 */
export interface ExpectedPerkContract {
  perkType: PerkType;
  label: string;
  membershipLabel: string;
  conditions?: PerkConditions;
  /**
   * Illustrative USD replacement-cost estimates at 3★ / 4★ / 5★ bands.
   * Sourced from packages/core perk-value.ts. Always isEstimate: true.
   */
  estimatedUsd: { 3: number; 4: number; 5: number };
  /** Always true — these are NOT prices or discount amounts. */
  isEstimate: true;
  /** Qualitative tier based on the 4★ estimate. */
  valueTier: PerkValueTier;
}

/**
 * A synthetic test persona produced by the factory.
 *
 * Identity is stable for a given (index, seed) pair. Memberships are seeded
 * from the real programs.ts catalog. No price fields anywhere.
 */
export interface TestPersona {
  /** Short stable handle, e.g. "persona-cz-0". */
  handle: string;
  /** Stable test email, e.g. "persona-cz-0@truerate-test.local". */
  email: string;
  /** Deterministic user ID (stable for a given handle + seed). */
  userId: string;
  /** ISO 3166-1 alpha-2 market code, e.g. "CZ", "DE". */
  market: string;
  /** BCP-47 language tag, e.g. "cs", "de-AT". */
  language: string;
  /** Memberships instantiated from real programs.ts data. */
  memberships: Membership[];
  /**
   * Vault reference — the Cosmos partition key / user ID that channels use
   * to look up this user's benefits.
   */
  vaultRef: string;
  /**
   * Per-user MCP URL for AI assistants to connect to.
   * Format: {mcpBaseUrl}/users/{userId}/sse
   */
  mcpUrl: string;
  /**
   * Expected applicable perks at a generic hotel context.
   * Channel drivers import this to verify MCP/API responses.
   * No prices — perks + conditions + estimated value tiers only.
   */
  expectedPerks: ExpectedPerkContract[];
}

// ---------------------------------------------------------------------------
// Persona archetype specs (diverse market/language/program mixes)
// ---------------------------------------------------------------------------

interface ProgramRef {
  programId: string;
  tier?: string;
}

interface PersonaSpec {
  market: string;
  language: string;
  programs: ProgramRef[];
}

/**
 * Eight base archetypes covering the target markets (CZ → DE → PL → AT → SK → HU)
 * and a range of membership combinations drawn from programs.ts.
 *
 * The factory cycles through these (with index-derived variation) for N > 8.
 */
const PERSONA_SPECS: PersonaSpec[] = [
  {
    market: "CZ",
    language: "cs",
    programs: [
      { programId: "booking_genius", tier: "Level 2" },
      { programId: "your_prague_hotels" },
    ],
  },
  {
    market: "DE",
    language: "de",
    programs: [
      { programId: "booking_genius", tier: "Level 1" },
      { programId: "marriott_bonvoy", tier: "Gold" },
    ],
  },
  {
    market: "CZ",
    language: "cs",
    programs: [
      { programId: "accor_all", tier: "Gold" },
      { programId: "emblem_prague" },
    ],
  },
  {
    market: "PL",
    language: "pl",
    programs: [
      { programId: "booking_genius", tier: "Level 1" },
      { programId: "revolut", tier: "Premium" },
    ],
  },
  {
    market: "AT",
    language: "de-AT",
    programs: [
      { programId: "marriott_bonvoy", tier: "Platinum" },
      { programId: "ihg_one_rewards", tier: "Gold Elite" },
    ],
  },
  {
    market: "GB",
    language: "en",
    programs: [
      { programId: "hilton_honors", tier: "Gold" },
      { programId: "amex_platinum" },
      { programId: "revolut", tier: "Metal" },
    ],
  },
  {
    market: "SK",
    language: "sk",
    programs: [
      { programId: "booking_genius", tier: "Level 3" },
      { programId: "accor_all", tier: "Silver" },
    ],
  },
  {
    market: "HU",
    language: "hu",
    programs: [
      { programId: "ihg_one_rewards", tier: "Platinum Elite" },
      { programId: "revolut", tier: "Ultra" },
    ],
  },
];

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function classifyValueTier(usdAt4star: number): PerkValueTier {
  if (usdAt4star === 0) return "intangible";
  if (usdAt4star < 20) return "low";
  if (usdAt4star < 60) return "medium";
  return "high";
}

function buildMembership(ref: ProgramRef, idSuffix: string): Membership | null {
  const program = PROGRAMS.find((p) => p.id === ref.programId);
  if (!program) return null;

  const benefits = instantiateBenefits(program, ref.tier);
  return {
    id: `m-${ref.programId}-${idSuffix}`,
    label: ref.tier ? `${program.name} — ${ref.tier}` : program.name,
    programId: program.id,
    tier: ref.tier,
    attributes: {},
    benefits,
    addedAt: new Date(0).toISOString(),
    status: "active",
  };
}

function deriveExpectedPerks(memberships: Membership[]): ExpectedPerkContract[] {
  const perks: ExpectedPerkContract[] = [];
  const seen = new Set<string>();

  for (const m of memberships) {
    for (const benefit of m.benefits) {
      if (benefit.value.kind !== "perk") continue;
      for (const sp of benefit.value.structuredPerks ?? []) {
        const key = `${sp.type}::${m.label}`;
        if (seen.has(key)) continue;
        seen.add(key);

        const bands = estimatePerkValueAllBands(sp.type);
        perks.push({
          perkType: sp.type,
          label: sp.label,
          membershipLabel: m.label,
          conditions: sp.conditions,
          estimatedUsd: {
            3: bands[3].estimatedUsd,
            4: bands[4].estimatedUsd,
            5: bands[5].estimatedUsd,
          },
          isEstimate: true,
          valueTier: classifyValueTier(bands[4].estimatedUsd),
        });
      }
    }
  }

  return perks;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export interface PersonaFactoryOptions {
  /** Base URL for per-user MCP endpoints. Default: "https://mcp.truerate.test". */
  mcpBaseUrl?: string;
}

export interface PersonaFactory {
  /**
   * Build N synthetic test personas from real programs.ts data.
   *
   * @param n   Number of personas to produce (>= 1).
   * @param seed Integer seed for deterministic generation (default 0).
   *             The same (n, seed) pair always produces identical output.
   */
  build(n: number, seed?: number): TestPersona[];

  /** Clear all personas from the in-memory registry (teardown hook). */
  teardown(): void;
}

/**
 * Create a persona factory for the synthetic-user harness.
 *
 * The factory is stateful only in that it tracks built personas for teardown.
 * It does not provision live infrastructure — use the identity provisioner
 * abstraction (see IdentityProvisioner) to layer in live Entra calls.
 */
export function createPersonaFactory(opts?: PersonaFactoryOptions): PersonaFactory {
  const mcpBaseUrl = opts?.mcpBaseUrl?.replace(/\/$/, "") ?? "https://mcp.truerate.test";
  const registry = new Map<string, TestPersona>();

  return {
    build(n: number, seed = 0): TestPersona[] {
      if (n < 1) throw new RangeError("n must be >= 1");

      // Advance the PRNG to generate unique-looking but stable IDs per seed.
      const rand = mulberry32(seed);
      const personas: TestPersona[] = [];

      for (let i = 0; i < n; i++) {
        const spec = PERSONA_SPECS[i % PERSONA_SPECS.length];
        if (!spec) continue; // TypeScript: spec is always defined here

        const handle = `persona-${spec.market.toLowerCase()}-${i}`;
        const email = `${handle}@truerate-test.local`;

        // userId is stable: hash of (handle, seed) XOR with PRNG sample.
        // The PRNG sample differentiates personas that would otherwise share a
        // handle across seeds; hash keeps it reproducible within a seed.
        const prngSample = Math.floor(rand() * 0xffffff);
        const hashPart = fnv1a(`${handle}:${seed}`);
        const userId = `tst-${hashPart}-${prngSample.toString(16).padStart(6, "0")}`;

        const idSuffix = `${i}-s${seed}`;
        const memberships: Membership[] = [];
        for (const ref of spec.programs) {
          const m = buildMembership(ref, idSuffix);
          if (m) memberships.push(m);
        }

        const persona: TestPersona = {
          handle,
          email,
          userId,
          market: spec.market,
          language: spec.language,
          memberships,
          vaultRef: userId,
          mcpUrl: `${mcpBaseUrl}/users/${encodeURIComponent(userId)}/sse`,
          expectedPerks: deriveExpectedPerks(memberships),
        };

        registry.set(handle, persona);
        personas.push(persona);
      }

      return personas;
    },

    teardown(): void {
      registry.clear();
    },
  };
}
