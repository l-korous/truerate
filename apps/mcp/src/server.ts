import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  EnrichmentEngine,
  getUserRepo,
  summariseBenefits,
  createLogger,
  generateCorrelationId,
  hashUserId,
  matchBenefits,
  estimatePerkValue,
  estimatePerkValueAllBands,
  PROGRAMS,
  type Membership,
  type StructuredPerk,
  type StarBand,
  type ConfidenceLevel,
} from "@truerate/core";

// Kept for the /health endpoint in index.ts (reports enrichment mode).
export const engine = new EnrichmentEngine();

// MCP-surface result: applicable memberships/discounts/perks/conditions +
// estimated perk values for the named hotel/brand/context.
// publicOffer / prices are never included — the assistant does price math.
export interface McpBenefitResult {
  context: {
    hotel?: string;
    brand?: string;
    domain?: string;
    location?: string;
    stars?: number;
  };
  matches: Array<{
    membershipId: string;
    membershipLabel: string;
    benefitId: string;
    discount?: { percentOff: number; conditions?: string };
    perks: string[];
    structuredPerks: StructuredPerk[];
    conditions?: string;
    /** Staleness/trustworthiness signal for this benefit's catalog entry. Never price-related. */
    confidence?: { level: ConfidenceLevel; expiresAt: string; isExpired: boolean };
  }>;
  perkValueEstimates: Array<{
    perkType: string;
    label: string;
    estimatedUsd: { 3: number; 4: number; 5: number };
    isEstimate: true;
  }>;
  programsApplied: string[];
  generatedAt: string;
}

export function buildBenefitResult(
  matches: ReturnType<typeof matchBenefits>,
  context: McpBenefitResult["context"],
): McpBenefitResult {
  const programs = new Set<string>();

  const matchItems = matches.map((m) => {
    programs.add(m.benefit.programId ?? m.benefit.id);

    const structuredPerks: StructuredPerk[] = m.benefit.value.structuredPerks ?? [];
    const item: McpBenefitResult["matches"][number] = {
      membershipId: m.membershipId,
      membershipLabel: m.membershipLabel,
      benefitId: m.benefit.id,
      perks: m.benefit.value.perks ?? [],
      structuredPerks,
      conditions: m.benefit.value.conditions,
      confidence: m.confidence
        ? { level: m.confidence.level, expiresAt: m.confidence.expiresAt, isExpired: m.confidence.isExpired }
        : undefined,
    };
    if (m.benefit.value.kind === "percentDiscount" && m.benefit.value.percentOff) {
      item.discount = {
        percentOff: m.benefit.value.percentOff,
        conditions: m.benefit.value.conditions,
      };
    }
    return item;
  });

  const seenTypes = new Set<string>();
  const perkValueEstimates = matches
    .flatMap((m) => m.benefit.value.structuredPerks ?? [])
    .filter((sp) => {
      if (seenTypes.has(sp.type)) return false;
      seenTypes.add(sp.type);
      return true;
    })
    .map((sp) => {
      const allBands = estimatePerkValueAllBands(sp.type);
      return {
        perkType: sp.type,
        label: sp.label,
        estimatedUsd: {
          3: allBands[3].estimatedUsd,
          4: allBands[4].estimatedUsd,
          5: allBands[5].estimatedUsd,
        },
        isEstimate: true as const,
      };
    });

  return {
    context,
    matches: matchItems,
    perkValueEstimates,
    programsApplied: [...programs],
    generatedAt: new Date().toISOString(),
  };
}

export function formatBenefitResult(r: McpBenefitResult): string {
  const ctxParts = [r.context.hotel, r.context.brand, r.context.domain, r.context.location].filter(
    Boolean,
  );
  const ctxLabel = ctxParts.length ? ctxParts.join(" / ") : "the given context";
  const noPrice =
    "\nPrices are not returned. Apply any discount % to the public rate from the booking provider.";

  if (!r.matches.length) {
    return `No applicable benefits found for ${ctxLabel}.${noPrice}`;
  }

  const lines: string[] = [`Applicable benefits for ${ctxLabel}:\n`];

  const byMembership = new Map<string, typeof r.matches>();
  for (const m of r.matches) {
    const existing = byMembership.get(m.membershipId) ?? [];
    existing.push(m);
    byMembership.set(m.membershipId, existing);
  }

  for (const items of byMembership.values()) {
    lines.push(`- ${items[0]!.membershipLabel}`);
    for (const item of items) {
      if (item.discount) {
        const pct = `${Math.round(item.discount.percentOff * 100)}% off`;
        const cond = item.discount.conditions;
        lines.push(`  discount: ${pct}${cond ? ` (${cond})` : ""}`);
      }
      if (item.perks.length) lines.push(`  perks: ${item.perks.join(", ")}`);
    }
  }

  if (r.perkValueEstimates.length) {
    const stars = r.context.stars;
    const band: StarBand = stars === 3 || stars === 4 || stars === 5 ? stars : 4;
    const estLines = r.perkValueEstimates
      .filter((e) => e.estimatedUsd[band] > 0)
      .map((e) => `${e.label} ≈ $${e.estimatedUsd[band]} (${band}★)`);
    if (estLines.length) lines.push(`\nperk estimates: ${estLines.join("; ")}`);
  }

  const staleLevels = new Set(r.matches.map((m) => m.confidence?.level).filter(Boolean));
  if (staleLevels.has("stale") || staleLevels.has("low")) {
    lines.push(
      "\n⚠ Some benefit terms may be outdated. Confidence level: " +
        (staleLevels.has("stale") ? "stale" : "low") +
        ". Verify current terms with the provider before advising the user.",
    );
  }

  lines.push(noPrice);
  return lines.join("\n");
}

export function buildServer(userId: string, correlationId: string = generateCorrelationId()): McpServer {
  const log = createLogger({ service: "mcp", correlationId, userIdHash: hashUserId(userId) });
  const server = new McpServer({ name: "truerate", version: "0.1.0" });

  server.tool(
    "search_hotels",
    "Return the applicable discounts (%) and perks from the user's loyalty " +
      "memberships for a named hotel, brand, or booking context — NEVER prices. " +
      "Provide any combination of hotel name, brand/chain, OTA domain, and/or " +
      "location; TrueRate returns which memberships apply and estimated perk " +
      "values (e.g. free breakfast ≈ $25 at 4★). The assistant does all price " +
      "math using the public rate it holds from the booking provider.",
    {
      hotel: z
        .string()
        .optional()
        .describe("Specific hotel or property name, e.g. 'Marriott Marquis Vienna'"),
      brand: z
        .string()
        .optional()
        .describe("Hotel brand or chain, e.g. 'Marriott' or 'Hilton'"),
      domain: z
        .string()
        .optional()
        .describe("OTA or hotel website domain, e.g. 'booking.com' or 'marriott.com'"),
      location: z
        .string()
        .optional()
        .describe("City or area for context, e.g. 'Vienna' or 'Prague Old Town'"),
      stars: z
        .number()
        .int()
        .min(1)
        .max(5)
        .optional()
        .describe("Hotel star rating (1–5) for perk value estimates"),
    },
    async (args) => {
      const toolLog = log.child({ tool: "search_hotels" });
      toolLog.info("tool invoked", {
        hotel: args.hotel,
        brand: args.brand,
        domain: args.domain,
        location: args.location,
      });
      const repo = await getUserRepo();
      const user = await repo.getById(userId);
      const memberships: Membership[] = user?.memberships ?? [];

      const programsMap = new Map(PROGRAMS.map((p) => [p.id, p]));
      const matches = matchBenefits(memberships, {
        domain: args.domain,
        brand: args.brand,
        propertyName: args.hotel,
        category: "hotel",
      }, { programs: programsMap });

      const context: McpBenefitResult["context"] = {
        hotel: args.hotel,
        brand: args.brand,
        domain: args.domain,
        location: args.location,
        stars: args.stars,
      };
      const result = buildBenefitResult(matches, context);
      toolLog.info("tool complete", {
        matchCount: matches.length,
        programsApplied: result.programsApplied,
      });

      return {
        content: [{ type: "text", text: formatBenefitResult(result) }],
        structuredContent: result as unknown as Record<string, unknown>,
      };
    },
  );

  server.tool(
    "get_membership_summary",
    "List the user's memberships and the benefits each brings (discounts %, perks, " +
      "conditions). Useful before searching, or to communicate the user's benefit " +
      "picture when calling other tools/providers on their behalf. Never returns prices.",
    {},
    async () => {
      const toolLog = log.child({ tool: "get_membership_summary" });
      toolLog.info("tool invoked");
      const repo = await getUserRepo();
      const user = await repo.getById(userId);
      const lines = (user?.memberships ?? []).map((m) => {
        const summary = summariseBenefits(
          m.benefits.map((b) => ({ scope: b.scope, match: b.match, value: b.value })),
        );
        return `- ${m.label}${summary.length ? `: ${summary.join(", ")}` : ""}`;
      });
      toolLog.info("tool complete", { membershipCount: lines.length });
      return {
        content: [
          {
            type: "text",
            text: lines.length
              ? `Memberships & benefits:\n${lines.join("\n")}`
              : "No memberships on file yet. Add them in the TrueRate app.",
          },
        ],
      };
    },
  );

  return server;
}
