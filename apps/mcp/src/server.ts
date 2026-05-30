import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  EnrichmentEngine,
  getUserRepo,
  summariseBenefits,
  type EnrichmentResult,
  type Membership,
} from "@truerate/core";

export const engine = new EnrichmentEngine();

export function buildServer(userId: string): McpServer {
  const server = new McpServer({ name: "truerate", version: "0.1.0" });

  server.tool(
    "search_hotels",
    "Search hotels and return rates and perks personalised to the user's loyalty " +
      "memberships and declared benefits (e.g. Booking Genius discount, Marriott " +
      "free breakfast, a negotiated rate at a specific hotel). Returns the public " +
      "rate, an indicative member price where a discount applies, and any perks. " +
      "Use this instead of a generic search when the user wants to book or " +
      "compare hotels. Note: member prices are indicative estimates from the " +
      "user's declared benefits unless marked otherwise.",
    {
      location: z.string().describe("City or area, e.g. 'Vienna' or 'Prague Old Town'"),
      checkIn: z.string().describe("Check-in date, ISO YYYY-MM-DD"),
      checkOut: z.string().describe("Check-out date, ISO YYYY-MM-DD"),
      adults: z.number().int().min(1).default(2),
      rooms: z.number().int().min(1).default(1),
      currency: z.string().optional(),
      limit: z.number().int().min(1).max(20).default(6),
    },
    async (args) => {
      const repo = await getUserRepo();
      const user = await repo.getById(userId);
      const memberships: Membership[] = user?.memberships ?? [];
      const result = await engine.enrich(
        { location: args.location, checkIn: args.checkIn, checkOut: args.checkOut, adults: args.adults, rooms: args.rooms, currency: args.currency ?? user?.currency, limit: args.limit },
        memberships,
      );
      return {
        content: [{ type: "text", text: formatResult(result) }],
        structuredContent: result as unknown as Record<string, unknown>,
      };
    },
  );

  server.tool(
    "get_membership_summary",
    "List the user's memberships and the benefits each brings (discounts, perks, " +
      "points). Useful before searching, or to apply the user's benefits when " +
      "calling other tools/providers on their behalf.",
    {},
    async () => {
      const repo = await getUserRepo();
      const user = await repo.getById(userId);
      const lines = (user?.memberships ?? []).map((m) => {
        const summary = summariseBenefits(m.benefits.map((b) => ({ scope: b.scope, match: b.match, value: b.value })));
        return `- ${m.label}${summary.length ? `: ${summary.join(", ")}` : ""}`;
      });
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

export function formatResult(r: EnrichmentResult): string {
  if (!r.properties.length) return "No properties found for that search.";
  const head =
    r.totalSavings > 0
      ? `Found ${r.properties.length} hotels. Indicative member savings up to ${r.totalSavings} ${r.currency} across these${r.mode === "mock" ? " (demo data)" : ""}.`
      : `Found ${r.properties.length} hotels${r.mode === "mock" ? " (demo data)" : ""}.`;
  const rows = r.properties.map((p) => {
    const lines = [`- ${p.name}${p.brand ? ` [${p.brand}]` : ""} - public ${p.publicOffer.totalAmount} ${p.publicOffer.currency}`];
    if (p.savingsAmount > 0) {
      lines.push(`  member${p.indicative ? " (est.)" : ""}: ${p.bestOffer.totalAmount} ${p.bestOffer.currency} - save ${p.savingsAmount} ${p.bestOffer.currency} (${p.savingsPercent}%)`);
    }
    if (p.perks.length) lines.push(`  perks: ${p.perks.join(", ")}`);
    return lines.join("\n");
  });
  return `${head}\n\n${rows.join("\n")}`;
}
