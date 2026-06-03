import { CosmosClient, type Container } from "@azure/cosmos";
import { DefaultAzureCredential } from "@azure/identity";
import { USER_SCHEMA_VERSION } from "./types.js";
import type { ActivationEventName, ActivationMilestones, User } from "./types.js";

// ─── Schema normalization ────────────────────────────────────────────────────
//
// normalizeUser() brings any stored User document up to the current schema shape
// without mutating persistent storage. Call it on every document read so callers
// always work against the current User type regardless of which revision wrote
// the document. See docs/SCHEMA-MIGRATION.md for the expand/migrate/contract
// policy that governs how schema changes are introduced across deploys.

/**
 * Upgrade a raw User document from Cosmos to the current schema shape.
 *
 * Version transitions handled here:
 *   v0 (undefined) → v1: set schemaVersion = 1 (the field was added; all other
 *                         fields are unchanged — this is a pure expand step).
 *
 * The returned object is always tagged with USER_SCHEMA_VERSION. Callers MUST
 * NOT persist the returned document back to Cosmos as part of a normalization-
 * only read — only persist it when the document was already being updated for
 * a real business reason (to avoid spurious write amplification).
 */
export function normalizeUser(raw: User): User {
  const version = raw.schemaVersion ?? 0;
  if (version >= USER_SCHEMA_VERSION) return raw;

  // v0 → v1: schemaVersion field did not exist; add it.
  return { ...raw, schemaVersion: USER_SCHEMA_VERSION };
}

// Data access for TrueRate. The store is Azure Cosmos DB (NoSQL, serverless):
// fully managed, scales with usage, no servers or Redis to operate. Users are
// single documents partitioned by `id`; reads/writes are point operations
// (1 RU) so we don't need a cache layer at MVP scale.
//
// Two backends share one interface:
//   • CosmosUserRepo  — production / Azure
//   • MemoryUserRepo  — local dev + demos (TRUERATE_INMEMORY=true)

export interface UserRepo {
  init(): Promise<void>;
  getById(id: string): Promise<User | null>;
  getByEmail(email: string): Promise<User | null>;
  /** Find a user by the SHA-256 hash of their per-user MCP URL token (#82). Null if none/revoked. */
  getByMcpTokenHash(hash: string): Promise<User | null>;
  create(user: User): Promise<User>;
  update(user: User): Promise<User>;
  /** Count users that have reached each activation milestone. Admin / observability use only. */
  funnelCounts(): Promise<Record<ActivationEventName, number>>;
}

// ─── Shared helpers ─────────────────────────────────────────────────────────

const ACTIVATION_EVENTS: ActivationEventName[] = [
  "signup",
  "membership_added",
  "mcp_url_obtained",
  "extension_connected",
];

function tallyMilestones(
  milestones: (ActivationMilestones | undefined)[],
): Record<ActivationEventName, number> {
  const counts = Object.fromEntries(ACTIVATION_EVENTS.map((e) => [e, 0])) as Record<ActivationEventName, number>;
  for (const m of milestones) {
    if (!m) continue;
    for (const event of ACTIVATION_EVENTS) {
      if (m[event]) counts[event]++;
    }
  }
  return counts;
}

// ─── Cosmos backend ─────────────────────────────────────────────────────────

class CosmosUserRepo implements UserRepo {
  private container!: Container;

  async init(): Promise<void> {
    const endpoint = process.env.COSMOS_ENDPOINT;
    if (!endpoint) throw new Error("COSMOS_ENDPOINT is required for the Cosmos backend.");

    // Prefer managed identity in Azure; fall back to a key for local use
    // against a real account. Never ship the key path to production.
    const key = process.env.COSMOS_KEY;
    const client = key
      ? new CosmosClient({ endpoint, key })
      : new CosmosClient({ endpoint, aadCredentials: new DefaultAzureCredential() });

    const dbName = process.env.COSMOS_DATABASE ?? "truerate";
    const { database } = await client.databases.createIfNotExists({ id: dbName });
    const { container } = await database.containers.createIfNotExists({
      id: "users",
      partitionKey: { paths: ["/id"] },
      // Serverless containers ignore throughput; left implicit on purpose.
    });
    this.container = container;
  }

  async getById(id: string): Promise<User | null> {
    try {
      const { resource } = await this.container.item(id, id).read<User>();
      return resource ? normalizeUser(resource) : null;
    } catch {
      return null;
    }
  }

  async getByEmail(email: string): Promise<User | null> {
    const { resources } = await this.container.items
      .query<User>({
        query: "SELECT * FROM c WHERE c.email = @email",
        parameters: [{ name: "@email", value: email.toLowerCase() }],
      })
      .fetchAll();
    return resources[0] ? normalizeUser(resources[0]) : null;
  }

  async getByMcpTokenHash(hash: string): Promise<User | null> {
    const { resources } = await this.container.items
      .query<User>({
        query: "SELECT * FROM c WHERE c.mcpToken.hash = @hash",
        parameters: [{ name: "@hash", value: hash }],
      })
      .fetchAll();
    return resources[0] ? normalizeUser(resources[0]) : null;
  }

  async create(user: User): Promise<User> {
    const stamped: User = { ...user, schemaVersion: USER_SCHEMA_VERSION };
    const { resource } = await this.container.items.create<User>(stamped);
    return resource as User;
  }

  async update(user: User): Promise<User> {
    const stamped: User = { ...user, schemaVersion: USER_SCHEMA_VERSION };
    const { resource } = await this.container.item(stamped.id, stamped.id).replace<User>(stamped);
    return resource as User;
  }

  async funnelCounts(): Promise<Record<ActivationEventName, number>> {
    const { resources } = await this.container.items
      .query<Pick<User, "activationMilestones">>({ query: "SELECT c.activationMilestones FROM c" })
      .fetchAll();
    return tallyMilestones(resources.map((r) => r.activationMilestones));
  }
}

// ─── In-memory backend (local dev / demos) ──────────────────────────────────

class MemoryUserRepo implements UserRepo {
  private byId = new Map<string, User>();

  async init(): Promise<void> {}

  async getById(id: string): Promise<User | null> {
    const u = this.byId.get(id);
    return u ? normalizeUser(u) : null;
  }

  async getByEmail(email: string): Promise<User | null> {
    const target = email.toLowerCase();
    for (const u of this.byId.values()) if (u.email === target) return normalizeUser(u);
    return null;
  }

  async getByMcpTokenHash(hash: string): Promise<User | null> {
    for (const u of this.byId.values()) if (u.mcpToken?.hash === hash) return normalizeUser(u);
    return null;
  }

  async create(user: User): Promise<User> {
    const stamped: User = { ...user, schemaVersion: USER_SCHEMA_VERSION };
    this.byId.set(stamped.id, stamped);
    return stamped;
  }

  async update(user: User): Promise<User> {
    const stamped: User = { ...user, schemaVersion: USER_SCHEMA_VERSION };
    this.byId.set(stamped.id, stamped);
    return stamped;
  }

  async funnelCounts(): Promise<Record<ActivationEventName, number>> {
    return tallyMilestones([...this.byId.values()].map((u) => u.activationMilestones));
  }
}

let repo: UserRepo | null = null;

/** Singleton repo, chosen by env. Call once at startup, then reuse. */
export async function getUserRepo(): Promise<UserRepo> {
  if (repo) return repo;
  const inMemory = process.env.TRUERATE_INMEMORY === "true" || !process.env.COSMOS_ENDPOINT;
  repo = inMemory ? new MemoryUserRepo() : new CosmosUserRepo();
  await repo.init();
  return repo;
}
