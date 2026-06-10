import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createRequire } from "node:module";
import path from "node:path";
import { readFileSync } from "node:fs";
import {
  EnrichmentEngine,
  getUserRepo,
  summariseBenefits,
  createLogger,
  generateCorrelationId,
  hashUserId,
  matchBenefits,
  matchHotelDirectory,
  estimatePerkValue,
  estimatePerkValueAllBands,
  recordUsageSafe,
  PROGRAMS,
  type UsageEventInput,
  type Membership,
  type StructuredPerk,
  type StarBand,
  type ConfidenceLevel,
  type HotelDirectoryEntry,
} from "@truerate/core";

const _require = createRequire(import.meta.url);

// Fail-soft loader: returns [] on any read/parse error so a missing data file
// degrades gracefully instead of crashing the server.
function loadHotelDirectory(): HotelDirectoryEntry[] {
  try {
    const pkgDir = path.dirname(_require.resolve("@truerate/core/package.json"));
    const raw = readFileSync(path.join(pkgDir, "data", "hotel-directory.json"), "utf-8");
    return JSON.parse(raw) as HotelDirectoryEntry[];
  } catch {
    return [];
  }
}

const hotelDirectory = loadHotelDirectory();

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
    /** Direct-booking ("realization") URL where the benefit is redeemed — never a price. */
    realizationUrl?: string;
    /**
     * Staleness level for the catalog entry behind this benefit.
     * "high"/"medium" = fresh; "low" = getting old; "stale" = past TTL.
     * Applies to terms/conditions freshness only — never to prices.
     */
    termsConfidenceLevel?: ConfidenceLevel;
  }>;
  perkValueEstimates: Array<{
    perkType: string;
    label: string;
    estimatedUsd: { 3: number; 4: number; 5: number };
    isEstimate: true;
  }>;
  programsApplied: string[];
  generatedAt: string;
  /**
   * Hotels from the directory that match the query, for "Book direct at <URL>".
   * Never includes prices — only name, city, country, and the direct-booking URL.
   */
  directBookingOptions: Array<{
    name: string;
    realizationUrl: string;
    city?: string;
    country: string;
  }>;
  /**
   * Human-readable staleness warnings for any matches whose catalog entry is
   * low-confidence or stale. Empty array when all terms are fresh.
   * These apply to terms/conditions freshness only, never to prices.
   */
  stalenessWarnings: string[];
}

export function buildBenefitResult(
  matches: ReturnType<typeof matchBenefits>,
  context: McpBenefitResult["context"],
  directBookingOptions: McpBenefitResult["directBookingOptions"] = [],
): McpBenefitResult {
  const programs = new Set<string>();
  const stalenessWarnings: string[] = [];

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
      realizationUrl: m.benefit.value.realizationUrl,
      termsConfidenceLevel: m.confidence?.level,
    };
    if (m.benefit.value.kind === "percentDiscount" && m.benefit.value.percentOff) {
      item.discount = {
        percentOff: m.benefit.value.percentOff,
        conditions: m.benefit.value.conditions,
      };
    }
    if (m.confidence?.level === "stale" || m.confidence?.isExpired) {
      stalenessWarnings.push(
        `Terms for "${m.membershipLabel}" may be outdated (last verified: ${m.confidence.expiresAt ?? "unknown"}). Verify at the program website.`,
      );
    } else if (m.confidence?.level === "low") {
      stalenessWarnings.push(
        `Terms for "${m.membershipLabel}" were verified some time ago — conditions may have changed.`,
      );
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
    directBookingOptions,
    stalenessWarnings,
  };
}

export function formatBenefitResult(r: McpBenefitResult): string {
  const ctxParts = [r.context.hotel, r.context.brand, r.context.domain, r.context.location].filter(
    Boolean,
  );
  const ctxLabel = ctxParts.length ? ctxParts.join(" / ") : "the given context";
  const noPrice =
    "\nPrices are not returned. Apply any discount % to the public rate from the booking provider.";

  if (!r.matches.length && !r.directBookingOptions?.length) {
    return `No applicable benefits found for ${ctxLabel}.${noPrice}`;
  }

  const lines: string[] = r.matches.length ? [`Applicable benefits for ${ctxLabel}:\n`] : [];

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
      if (item.realizationUrl) lines.push(`  book direct: ${item.realizationUrl}`);
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

  if (r.directBookingOptions?.length) {
    lines.push(`\nBook direct:`);
    for (const h of r.directBookingOptions) {
      const loc = [h.city, h.country].filter(Boolean).join(", ");
      lines.push(`  ${h.name}${loc ? ` (${loc})` : ""} — ${h.realizationUrl}`);
    }
  }

  if (r.stalenessWarnings.length) {
    lines.push(`\nTerms freshness notes:`);
    for (const w of r.stalenessWarnings) lines.push(`  ⚠ ${w}`);
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

      // Parse city/country from location ("Prague" or "Prague, CZ").
      let city: string | undefined;
      let country: string | undefined;
      if (args.location) {
        const parts = args.location.split(",").map((s: string) => s.trim());
        city = parts[0];
        if (parts[1]?.length === 2) country = parts[1].toUpperCase();
      }

      const directMatches = matchHotelDirectory(hotelDirectory, {
        hotel: args.hotel,
        domain: args.domain,
        city,
        country,
      });

      const context: McpBenefitResult["context"] = {
        hotel: args.hotel,
        brand: args.brand,
        domain: args.domain,
        location: args.location,
        stars: args.stars,
      };
      const directBookingOptions = directMatches.map((h) => ({
        name: h.name,
        realizationUrl: h.realizationUrl,
        city: h.city,
        country: h.country,
      }));
      const result = buildBenefitResult(matches, context, directBookingOptions);
      toolLog.info("tool complete", {
        matchCount: matches.length,
        programsApplied: result.programsApplied,
      });

      // Usage analytics (#333): record which provider/perk surfaced, for client
      // ROI insight. Fire-and-forget + fail-soft — never blocks/breaks the tool.
      // No prices, hashed user id only.
      const usageEvents: UsageEventInput[] = [];
      const uHash = hashUserId(userId);
      for (const m of matches) {
        const programId = m.benefit.programId ?? m.benefit.id;
        if (m.benefit.value.kind === "percentDiscount" && m.benefit.value.percentOff) {
          usageEvents.push({ channel: "mcp", programId, benefitKind: "percentDiscount", country, userIdHash: uHash });
        }
        for (const sp of m.benefit.value.structuredPerks ?? []) {
          usageEvents.push({ channel: "mcp", programId, benefitKind: "perk", perkType: sp.type, country, userIdHash: uHash });
        }
      }
      void recordUsageSafe(usageEvents);

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
