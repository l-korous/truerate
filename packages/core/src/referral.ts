import { randomBytes } from "node:crypto";
import { CosmosClient, type Container } from "@azure/cosmos";
import { DefaultAzureCredential } from "@azure/identity";

// Referral program (#353): hotels that refer another hotel get a 3-month trial
// extension once the referee activates. One reward per unique activated referee;
// no self-referral. No prices — only lifecycle state (reward = trial extension).

/** An opaque, URL-safe referral code assigned to a hotel. */
export interface HotelReferralCode {
  /** The hotel/org that owns this code. */
  hotelId: string;
  /** The unique referral code. */
  code: string;
  /** When this code was created. */
  createdAt: string;
}

export type ReferralStatus =
  | "pending"  // referee signed up but not yet activated
  | "rewarded"; // referee activated; referrer was rewarded

export interface ReferralRecord {
  /** Unique record id. */
  id: string;
  /** The hotel/org that shared the referral link. */
  referrerId: string;
  /** The hotel/org that signed up via the referral link. */
  refereeId: string;
  /** The code that was used (for audit). */
  code: string;
  /** Current status. */
  status: ReferralStatus;
  /** When this referral was created (referee signed up). */
  createdAt: string;
  /** When the reward was granted (referrer trial extended). */
  rewardedAt?: string;
}

export interface ReferralRepo {
  init(): Promise<void>;
  /** Return the existing referral code for a hotel, or generate and store a new one. */
  getOrCreateCode(hotelId: string): Promise<HotelReferralCode>;
  /** Look up the hotel that owns a given code; null if unknown. */
  lookupByCode(code: string): Promise<HotelReferralCode | null>;
  /** Record that a referee (new hotel) signed up via a referral code. */
  createReferral(referrerId: string, refereeId: string, code: string): Promise<ReferralRecord>;
  /** Find a pending referral where the given hotel is the referee. */
  getPendingForReferee(refereeId: string): Promise<ReferralRecord | null>;
  /** Check whether a referee was already rewarded (idempotency guard). */
  getRewardedForReferee(refereeId: string): Promise<ReferralRecord | null>;
  /** Mark a referral as rewarded. */
  markRewarded(referralId: string): Promise<ReferralRecord>;
  /** List all referrals made by a referrer (for dashboard). */
  listByReferrer(referrerId: string): Promise<ReferralRecord[]>;
}

// ─── Code generation ─────────────────────────────────────────────────────────

// URL-safe chars without ambiguous ones (0/O, 1/I/l).
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
const CODE_LEN = 8;

/** Generate a random URL-safe referral code (no ambiguous chars). */
export function generateReferralCode(): string {
  const buf = randomBytes(CODE_LEN * 2);
  const max = CODE_CHARS.length;
  let code = "";
  for (let i = 0; i < CODE_LEN; i++) {
    code += CODE_CHARS[buf[i]! % max];
  }
  return code;
}

// ─── In-memory backend (local dev / tests) ───────────────────────────────────

class MemoryReferralRepo implements ReferralRepo {
  private codes = new Map<string, HotelReferralCode>(); // hotelId → code doc
  private codeIndex = new Map<string, string>(); // code → hotelId
  private referrals = new Map<string, ReferralRecord>(); // id → record

  async init(): Promise<void> {}

  async getOrCreateCode(hotelId: string): Promise<HotelReferralCode> {
    const existing = this.codes.get(hotelId);
    if (existing) return existing;
    const doc: HotelReferralCode = { hotelId, code: generateReferralCode(), createdAt: new Date().toISOString() };
    this.codes.set(hotelId, doc);
    this.codeIndex.set(doc.code, hotelId);
    return doc;
  }

  async lookupByCode(code: string): Promise<HotelReferralCode | null> {
    const hotelId = this.codeIndex.get(code);
    return hotelId ? (this.codes.get(hotelId) ?? null) : null;
  }

  async createReferral(referrerId: string, refereeId: string, code: string): Promise<ReferralRecord> {
    const id = `ref-${referrerId}-${refereeId}-${Date.now()}`;
    const rec: ReferralRecord = { id, referrerId, refereeId, code, status: "pending", createdAt: new Date().toISOString() };
    this.referrals.set(id, rec);
    return rec;
  }

  async getPendingForReferee(refereeId: string): Promise<ReferralRecord | null> {
    return [...this.referrals.values()].find((r) => r.refereeId === refereeId && r.status === "pending") ?? null;
  }

  async getRewardedForReferee(refereeId: string): Promise<ReferralRecord | null> {
    return [...this.referrals.values()].find((r) => r.refereeId === refereeId && r.status === "rewarded") ?? null;
  }

  async markRewarded(referralId: string): Promise<ReferralRecord> {
    const rec = this.referrals.get(referralId);
    if (!rec) throw new Error(`Referral not found: ${referralId}`);
    const updated: ReferralRecord = { ...rec, status: "rewarded", rewardedAt: new Date().toISOString() };
    this.referrals.set(referralId, updated);
    return updated;
  }

  async listByReferrer(referrerId: string): Promise<ReferralRecord[]> {
    return [...this.referrals.values()].filter((r) => r.referrerId === referrerId);
  }
}

// ─── Cosmos backend ───────────────────────────────────────────────────────────

class CosmosReferralRepo implements ReferralRepo {
  private codes!: Container;
  private referrals!: Container;

  async init(): Promise<void> {
    const endpoint = process.env.COSMOS_ENDPOINT;
    if (!endpoint) throw new Error("COSMOS_ENDPOINT is required for the Cosmos backend.");
    const key = process.env.COSMOS_KEY;
    const client = key
      ? new CosmosClient({ endpoint, key })
      : new CosmosClient({ endpoint, aadCredentials: new DefaultAzureCredential() });
    const dbName = process.env.COSMOS_DATABASE ?? "truerate";
    const { database } = await client.databases.createIfNotExists({ id: dbName });
    const [{ container: codesContainer }, { container: referralsContainer }] = await Promise.all([
      database.containers.createIfNotExists({ id: "referral_codes", partitionKey: { paths: ["/hotelId"] } }),
      database.containers.createIfNotExists({ id: "referrals", partitionKey: { paths: ["/referrerId"] } }),
    ]);
    this.codes = codesContainer;
    this.referrals = referralsContainer;
  }

  async getOrCreateCode(hotelId: string): Promise<HotelReferralCode> {
    try {
      const { resource } = await this.codes.item(hotelId, hotelId).read<HotelReferralCode & { id: string }>();
      if (resource) return resource;
    } catch { /* not found */ }
    const doc = { id: hotelId, hotelId, code: generateReferralCode(), createdAt: new Date().toISOString() };
    const { resource } = await this.codes.items.upsert<HotelReferralCode & { id: string }>(doc);
    return resource!;
  }

  async lookupByCode(code: string): Promise<HotelReferralCode | null> {
    const { resources } = await this.codes.items
      .query<HotelReferralCode>({
        query: "SELECT * FROM c WHERE c.code = @code",
        parameters: [{ name: "@code", value: code }],
      })
      .fetchAll();
    return resources[0] ?? null;
  }

  async createReferral(referrerId: string, refereeId: string, code: string): Promise<ReferralRecord> {
    const id = `ref-${referrerId}-${refereeId}-${Date.now()}`;
    const rec = { id, referrerId, refereeId, code, status: "pending" as ReferralStatus, createdAt: new Date().toISOString() };
    await this.referrals.items.create(rec);
    return rec;
  }

  private async findByReferee(refereeId: string, status?: ReferralStatus): Promise<ReferralRecord | null> {
    const q = status
      ? {
          query: "SELECT * FROM c WHERE c.refereeId = @rid AND c.status = @status",
          parameters: [{ name: "@rid", value: refereeId }, { name: "@status", value: status }],
        }
      : {
          query: "SELECT * FROM c WHERE c.refereeId = @rid",
          parameters: [{ name: "@rid", value: refereeId }],
        };
    const { resources } = await this.referrals.items.query<ReferralRecord>(q).fetchAll();
    return resources[0] ?? null;
  }

  async getPendingForReferee(refereeId: string): Promise<ReferralRecord | null> {
    return this.findByReferee(refereeId, "pending");
  }

  async getRewardedForReferee(refereeId: string): Promise<ReferralRecord | null> {
    return this.findByReferee(refereeId, "rewarded");
  }

  async markRewarded(referralId: string): Promise<ReferralRecord> {
    // Cross-partition lookup — query first to get the partition key (referrerId).
    const { resources } = await this.referrals.items
      .query<ReferralRecord & { id: string }>({
        query: "SELECT * FROM c WHERE c.id = @id",
        parameters: [{ name: "@id", value: referralId }],
      })
      .fetchAll();
    const rec = resources[0];
    if (!rec) throw new Error(`Referral not found: ${referralId}`);
    const updated = { ...rec, status: "rewarded" as ReferralStatus, rewardedAt: new Date().toISOString() };
    await this.referrals.item(rec.id, rec.referrerId).replace(updated);
    return updated;
  }

  async listByReferrer(referrerId: string): Promise<ReferralRecord[]> {
    const { resources } = await this.referrals.items
      .query<ReferralRecord>({
        query: "SELECT * FROM c WHERE c.referrerId = @rid ORDER BY c.createdAt DESC",
        parameters: [{ name: "@rid", value: referrerId }],
      })
      .fetchAll();
    return resources;
  }
}

// ─── Singleton factory ────────────────────────────────────────────────────────

let referralRepo: ReferralRepo | null = null;

export async function getReferralRepo(): Promise<ReferralRepo> {
  if (referralRepo) return referralRepo;
  const inMemory = process.env.TRUERATE_INMEMORY === "true" || !process.env.COSMOS_ENDPOINT;
  referralRepo = inMemory ? new MemoryReferralRepo() : new CosmosReferralRepo();
  await referralRepo.init();
  return referralRepo;
}

export function resetReferralRepo(): void {
  referralRepo = null;
}

/** Number of days to add to the referrer's trial when a referee activates. */
export const REFERRAL_REWARD_DAYS = 90;
