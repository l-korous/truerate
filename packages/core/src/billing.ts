import { CosmosClient, type Container } from "@azure/cosmos";
import { DefaultAzureCredential } from "@azure/identity";

// Hotel subscription billing (#351 / #352). Stores the Stripe-backed subscription
// status per claimed hotel so the rest of the app can gate access (analytics,
// listing edits) on "trialing | active". Card data NEVER touches us — Stripe
// Checkout/Portal handle capture + PCI; we only persist status + the Stripe IDs.
// No prices here (rule #1): only the lifecycle state.

export type SubscriptionStatus =
  | "none" // never started
  | "trialing" // in the free trial, card on file
  | "active" // paying
  | "past_due" // payment failed, in grace
  | "canceled"; // ended

export interface HotelSubscription {
  /** The claimed hotel (or partner org) this subscription is for — the doc key. */
  hotelId: string;
  status: SubscriptionStatus;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  /** Trial end (ISO date), when known from Stripe. */
  trialEndsAt?: string;
  /** Last update (ISO timestamp). */
  updatedAt: string;
}

/** Map a Stripe subscription.status to our coarser lifecycle state. Pure. */
export function mapStripeStatus(stripeStatus: string): SubscriptionStatus {
  switch (stripeStatus) {
    case "trialing":
      return "trialing";
    case "active":
      return "active";
    case "past_due":
    case "unpaid":
      return "past_due";
    case "canceled":
    case "incomplete_expired":
      return "canceled";
    default:
      return "none";
  }
}

/** True for states that may use the paid features (trial counts). */
export function subscriptionEntitled(s: SubscriptionStatus): boolean {
  return s === "trialing" || s === "active";
}

/**
 * Full entitlement check including trial expiry.
 * Returns true when a hotel's offers should surface in channels.
 * A "trialing" subscription is only entitled while trialEndsAt is in the future.
 */
export function isEntitled(sub: HotelSubscription | null | undefined): boolean {
  if (!sub) return false;
  if (sub.status === "active") return true;
  if (sub.status === "trialing") {
    if (sub.trialEndsAt) return new Date(sub.trialEndsAt) > new Date();
    return true; // trialing with no expiry — assumed valid
  }
  return false;
}

/**
 * Days remaining in a free trial, rounded up.
 * Returns null if the subscription is not in "trialing" status or has no trialEndsAt.
 * Returns 0 if the trial has expired.
 */
export function trialDaysRemaining(sub: HotelSubscription): number | null {
  if (sub.status !== "trialing" || !sub.trialEndsAt) return null;
  const msLeft = new Date(sub.trialEndsAt).getTime() - Date.now();
  return Math.max(0, Math.ceil(msLeft / (1000 * 60 * 60 * 24)));
}

/** Default trial length in days for new hotel onboarding. */
export const DEFAULT_TRIAL_DAYS = 90;

export interface SubscriptionRepo {
  init(): Promise<void>;
  get(hotelId: string): Promise<HotelSubscription | null>;
  /** Upsert the status for a hotel (called from the Stripe webhook). */
  upsert(sub: HotelSubscription): Promise<void>;
  /** Look up by Stripe IDs (webhook payloads reference these, not hotelId). */
  byStripeCustomer(customerId: string): Promise<HotelSubscription | null>;
  bySubscription(subscriptionId: string): Promise<HotelSubscription | null>;
  /**
   * Return all trialing subscriptions whose trialEndsAt falls within the next
   * `withinDays` days (i.e. trialEndsAt > now AND trialEndsAt <= now + withinDays).
   * Used by the reminder-email job.
   */
  listExpiringSoon(withinDays: number): Promise<HotelSubscription[]>;
}

// ─── Cosmos backend ───────────────────────────────────────────────────────────

class CosmosSubscriptionRepo implements SubscriptionRepo {
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
      id: "subscriptions",
      partitionKey: { paths: ["/hotelId"] },
    });
    this.container = container;
  }

  async get(hotelId: string): Promise<HotelSubscription | null> {
    try {
      const { resource } = await this.container.item(hotelId, hotelId).read<HotelSubscription & { id: string }>();
      return resource ?? null;
    } catch {
      return null;
    }
  }

  async upsert(sub: HotelSubscription): Promise<void> {
    await this.container.items.upsert({ id: sub.hotelId, ...sub });
  }

  private async queryOne(field: string, value: string): Promise<HotelSubscription | null> {
    const { resources } = await this.container.items
      .query<HotelSubscription>({ query: `SELECT * FROM c WHERE c.${field} = @v`, parameters: [{ name: "@v", value }] })
      .fetchAll();
    return resources[0] ?? null;
  }
  byStripeCustomer(customerId: string): Promise<HotelSubscription | null> {
    return this.queryOne("stripeCustomerId", customerId);
  }
  bySubscription(subscriptionId: string): Promise<HotelSubscription | null> {
    return this.queryOne("stripeSubscriptionId", subscriptionId);
  }
  async listExpiringSoon(withinDays: number): Promise<HotelSubscription[]> {
    const now = new Date().toISOString();
    const cutoff = new Date(Date.now() + withinDays * 24 * 60 * 60 * 1000).toISOString();
    const { resources } = await this.container.items
      .query<HotelSubscription>({
        query: `SELECT * FROM c WHERE c.status = 'trialing' AND c.trialEndsAt > @now AND c.trialEndsAt <= @cutoff`,
        parameters: [
          { name: "@now", value: now },
          { name: "@cutoff", value: cutoff },
        ],
      })
      .fetchAll();
    return resources;
  }
}

// ─── In-memory backend (local dev / tests) ──────────────────────────────────

class MemorySubscriptionRepo implements SubscriptionRepo {
  private byHotel = new Map<string, HotelSubscription>();
  async init(): Promise<void> {}
  async get(hotelId: string): Promise<HotelSubscription | null> {
    return this.byHotel.get(hotelId) ?? null;
  }
  async upsert(sub: HotelSubscription): Promise<void> {
    this.byHotel.set(sub.hotelId, sub);
  }
  async byStripeCustomer(customerId: string): Promise<HotelSubscription | null> {
    return [...this.byHotel.values()].find((s) => s.stripeCustomerId === customerId) ?? null;
  }
  async bySubscription(subscriptionId: string): Promise<HotelSubscription | null> {
    return [...this.byHotel.values()].find((s) => s.stripeSubscriptionId === subscriptionId) ?? null;
  }
  async listExpiringSoon(withinDays: number): Promise<HotelSubscription[]> {
    const now = Date.now();
    const cutoff = now + withinDays * 24 * 60 * 60 * 1000;
    return [...this.byHotel.values()].filter((s) => {
      if (s.status !== "trialing" || !s.trialEndsAt) return false;
      const end = new Date(s.trialEndsAt).getTime();
      return end > now && end <= cutoff;
    });
  }
}

// ─── Singleton factory ───────────────────────────────────────────────────────

let subRepo: SubscriptionRepo | null = null;

/** Singleton subscription repo, chosen by env (mirrors getUsageRepo). */
export async function getSubscriptionRepo(): Promise<SubscriptionRepo> {
  if (subRepo) return subRepo;
  const inMemory = process.env.TRUERATE_INMEMORY === "true" || !process.env.COSMOS_ENDPOINT;
  subRepo = inMemory ? new MemorySubscriptionRepo() : new CosmosSubscriptionRepo();
  await subRepo.init();
  return subRepo;
}

/** Reset the singleton — tests only. */
export function resetSubscriptionRepo(): void {
  subRepo = null;
}
