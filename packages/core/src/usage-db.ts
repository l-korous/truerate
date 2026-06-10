import { CosmosClient, type Container } from "@azure/cosmos";
import { DefaultAzureCredential } from "@azure/identity";
import { randomUUID } from "node:crypto";
import type { BenefitKind, PerkType } from "./types.js";

// Usage analytics store — records every time a benefit/perk is SURFACED to a
// user in a channel (MCP, browser extension), so we can show prospective clients
// (hotels/programs) how often their brand + perks actually appear. This is the
// detailed, per-provider/per-perk usage layer; distinct from the web sign-up
// funnel analytics.
//
// PRIVACY + PRODUCT RULES:
//   • No prices, ever (issue #1). Events carry only which provider/perk/discount
//     surfaced, the channel, an optional country, and a HASHED user id.
//   • No PII and no raw queries are stored — only aggregate-friendly fields.

/** Channel a benefit was surfaced through. */
export type UsageChannel = "mcp" | "extension" | "web";

/** A single "a benefit/perk was surfaced" event. No prices, no PII. */
export interface UsageEvent {
  /** Cosmos document id (uuid). */
  id: string;
  /** Where it surfaced. */
  channel: UsageChannel;
  /** Provider / program id (e.g. "booking_genius"). */
  programId: string;
  /** Canonical perk type when a perk surfaced; omitted for discount-only events. */
  perkType?: PerkType;
  /** Which kind of benefit surfaced (percentDiscount, perk, …). */
  benefitKind: BenefitKind;
  /** ISO-3166 alpha-2 country/market when known. */
  country?: string;
  /** Hashed user id (never the raw id). */
  userIdHash: string;
  /** ISO-8601 timestamp. */
  ts: string;
  /** YYYY-MM-DD — Cosmos partition key + day bucket for range queries. */
  day: string;
}

/** Input to record() — the repo stamps id, ts, and day. An optional `ts` may
 *  be supplied to backdate an event (used by the demo seeder to spread synthetic
 *  demand across days so it lands on many Cosmos `/day` partitions); when absent
 *  the event is stamped "now". */
export type UsageEventInput = Omit<UsageEvent, "id" | "ts" | "day"> & { ts?: string };

/** Filters for an aggregation query. All optional → aggregate everything. */
export interface UsageFilter {
  /** Inclusive lower day bound, YYYY-MM-DD. */
  fromDay?: string;
  /** Inclusive upper day bound, YYYY-MM-DD. */
  toDay?: string;
  country?: string;
  channel?: UsageChannel;
  programId?: string;
}

/** A {key,count} bucket, sorted by count desc (leaderboard-ready). */
export interface UsageBucket {
  key: string;
  count: number;
}

/** Aggregated usage counts across several dimensions. */
export interface UsageAggregation {
  total: number;
  byProvider: UsageBucket[];
  byPerk: UsageBucket[];
  byCountry: UsageBucket[];
  byDay: UsageBucket[];
}

export interface UsageRepo {
  init(): Promise<void>;
  /** Record one surfaced-benefit event. */
  record(input: UsageEventInput): Promise<void>;
  /** Record several events (one call per request). */
  recordMany(inputs: UsageEventInput[]): Promise<void>;
  /** Aggregate counts by provider, perk, country, and day. */
  aggregate(filter?: UsageFilter): Promise<UsageAggregation>;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function dayOf(iso: string): string {
  return iso.slice(0, 10);
}

function stamp(input: UsageEventInput): UsageEvent {
  const ts = input.ts ?? new Date().toISOString();
  return { ...input, id: randomUUID(), ts, day: dayOf(ts) };
}

function sortDesc(buckets: UsageBucket[]): UsageBucket[] {
  return buckets.sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

// ─── Cosmos backend ───────────────────────────────────────────────────────────

class CosmosUsageRepo implements UsageRepo {
  private container!: Container;

  async init(): Promise<void> {
    const endpoint = process.env.COSMOS_ENDPOINT;
    if (!endpoint) throw new Error("COSMOS_ENDPOINT is required for the Cosmos backend.");
    const key = process.env.COSMOS_KEY;
    const client = key
      ? new CosmosClient({ endpoint, key })
      : new CosmosClient({ endpoint, aadCredentials: new DefaultAzureCredential() });
    const dbName = process.env.COSMOS_DATABASE ?? "truerate";
    const { database } = await client.databases.createIfNotExists({ id: dbName });
    const { container } = await database.containers.createIfNotExists({
      id: "usage",
      partitionKey: { paths: ["/day"] },
    });
    this.container = container;
  }

  async record(input: UsageEventInput): Promise<void> {
    await this.container.items.create<UsageEvent>(stamp(input));
  }

  async recordMany(inputs: UsageEventInput[]): Promise<void> {
    await Promise.all(inputs.map((i) => this.container.items.create<UsageEvent>(stamp(i))));
  }

  async aggregate(filter: UsageFilter = {}): Promise<UsageAggregation> {
    const where: string[] = [];
    const parameters: { name: string; value: string }[] = [];
    if (filter.fromDay) { where.push("c.day >= @fromDay"); parameters.push({ name: "@fromDay", value: filter.fromDay }); }
    if (filter.toDay) { where.push("c.day <= @toDay"); parameters.push({ name: "@toDay", value: filter.toDay }); }
    if (filter.country) { where.push("c.country = @country"); parameters.push({ name: "@country", value: filter.country }); }
    if (filter.channel) { where.push("c.channel = @channel"); parameters.push({ name: "@channel", value: filter.channel }); }
    if (filter.programId) { where.push("c.programId = @programId"); parameters.push({ name: "@programId", value: filter.programId }); }
    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const groupBy = async (field: string, alias: string): Promise<UsageBucket[]> => {
      const { resources } = await this.container.items
        .query<{ k: string | null; n: number }>({
          query: `SELECT ${field} AS k, COUNT(1) AS n FROM c ${clause} GROUP BY ${field}`,
          parameters,
        })
        .fetchAll();
      return sortDesc(
        resources
          .filter((r) => r.k !== null && r.k !== undefined)
          .map((r) => ({ key: String(r.k), count: r.n })),
      );
    };

    const [byProvider, byPerk, byCountry, byDay] = await Promise.all([
      groupBy("c.programId", "programId"),
      groupBy("c.perkType", "perkType"),
      groupBy("c.country", "country"),
      groupBy("c.day", "day"),
    ]);
    const total = byProvider.reduce((s, b) => s + b.count, 0);
    return { total, byProvider, byPerk, byCountry, byDay };
  }
}

// ─── In-memory backend (local dev / tests) ──────────────────────────────────

class MemoryUsageRepo implements UsageRepo {
  private events: UsageEvent[] = [];

  async init(): Promise<void> {}

  async record(input: UsageEventInput): Promise<void> {
    this.events.push(stamp(input));
  }

  async recordMany(inputs: UsageEventInput[]): Promise<void> {
    for (const i of inputs) this.events.push(stamp(i));
  }

  async aggregate(filter: UsageFilter = {}): Promise<UsageAggregation> {
    const rows = this.events.filter(
      (e) =>
        (!filter.fromDay || e.day >= filter.fromDay) &&
        (!filter.toDay || e.day <= filter.toDay) &&
        (!filter.country || e.country === filter.country) &&
        (!filter.channel || e.channel === filter.channel) &&
        (!filter.programId || e.programId === filter.programId),
    );
    const tally = (pick: (e: UsageEvent) => string | undefined): UsageBucket[] => {
      const m = new Map<string, number>();
      for (const e of rows) {
        const k = pick(e);
        if (k === undefined) continue;
        m.set(k, (m.get(k) ?? 0) + 1);
      }
      return sortDesc([...m.entries()].map(([key, count]) => ({ key, count })));
    };
    return {
      total: rows.length,
      byProvider: tally((e) => e.programId),
      byPerk: tally((e) => e.perkType),
      byCountry: tally((e) => e.country),
      byDay: tally((e) => e.day),
    };
  }
}

// ─── Singleton factory ───────────────────────────────────────────────────────

let usageRepo: UsageRepo | null = null;

/** Singleton usage repo, chosen by env (mirrors getUserRepo/getCatalogRepo). */
export async function getUsageRepo(): Promise<UsageRepo> {
  if (usageRepo) return usageRepo;
  const inMemory = process.env.TRUERATE_INMEMORY === "true" || !process.env.COSMOS_ENDPOINT;
  usageRepo = inMemory ? new MemoryUsageRepo() : new CosmosUsageRepo();
  await usageRepo.init();
  return usageRepo;
}

/** Reset the singleton — tests only. */
export function resetUsageRepo(): void {
  usageRepo = null;
}

/**
 * Fire-and-forget usage recording for hot paths (MCP/extension). Resolves the
 * repo and records, swallowing ALL errors — analytics must NEVER break or slow a
 * user-facing response. Callers may `void` this without awaiting.
 */
export async function recordUsageSafe(inputs: UsageEventInput[]): Promise<void> {
  if (!inputs.length) return;
  try {
    const repo = await getUsageRepo();
    await repo.recordMany(inputs);
  } catch {
    // Intentionally swallowed — never surface analytics failures to the user.
  }
}
