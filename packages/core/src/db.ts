import { CosmosClient, type Container } from "@azure/cosmos";
import { DefaultAzureCredential } from "@azure/identity";
import type { ActivationEventName, ActivationMilestones, User } from "./types.js";
import { USER_SCHEMA_VERSION } from "./types.js";

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
  create(user: User): Promise<User>;
  update(user: User): Promise<User>;
  /** Count users that have reached each activation milestone. Admin / observability use only. */
  funnelCounts(): Promise<Record<ActivationEventName, number>>;
}

// ─── Schema normalization ────────────────────────────────────────────────────
//
// During a canary rollout both the old and new revision of a Container App read
// from the same Cosmos container.  A document written by the old revision may
// lack fields added in the new one, and vice-versa.  `normalizeUser` applies
// safe defaults so callers always receive a fully-shaped User regardless of
// which revision originally wrote the document.
//
// Rules (per docs/SCHEMA-MIGRATION.md):
//   • New fields are OPTIONAL in the TypeScript type until a subsequent "contract"
//     deploy removes legacy code paths.
//   • `normalizeUser` fills missing fields with their documented defaults.
//   • `schemaVersion` is set to USER_SCHEMA_VERSION on every write so the
//     document is self-describing for future migrations.
//
// When to update this function:
//   Add a new case whenever USER_SCHEMA_VERSION is incremented.

export function normalizeUser(raw: User): User {
  const version = raw.schemaVersion ?? 1;

  // v1 → current: fill in any fields that were missing before schemaVersion
  // was introduced. Today schemaVersion is the only such field, but future
  // migrations add cases here.
  if (version < USER_SCHEMA_VERSION) {
    // No structural changes between v1 and current beyond schemaVersion itself.
  }

  return {
    ...raw,
    // Ensure every stored doc carries the current version so subsequent reads
    // (from the same or an older revision) see a self-describing document.
    schemaVersion: USER_SCHEMA_VERSION,
    // activationMilestones is optional; keep as-is (may be undefined on old docs).
    activationMilestones: raw.activationMilestones,
  };
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
    const doc = resources[0];
    return doc ? normalizeUser(doc) : null;
  }

  async create(user: User): Promise<User> {
    const versioned = { ...user, schemaVersion: USER_SCHEMA_VERSION };
    const { resource } = await this.container.items.create<User>(versioned);
    return normalizeUser(resource as User);
  }

  async update(user: User): Promise<User> {
    const versioned = { ...user, schemaVersion: USER_SCHEMA_VERSION };
    const { resource } = await this.container.item(user.id, user.id).replace<User>(versioned);
    return normalizeUser(resource as User);
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
    const doc = this.byId.get(id);
    return doc ? normalizeUser(doc) : null;
  }

  async getByEmail(email: string): Promise<User | null> {
    const target = email.toLowerCase();
    for (const u of this.byId.values()) {
      if (u.email === target) return normalizeUser(u);
    }
    return null;
  }

  async create(user: User): Promise<User> {
    const versioned = { ...user, schemaVersion: USER_SCHEMA_VERSION };
    this.byId.set(versioned.id, versioned);
    return normalizeUser(versioned);
  }

  async update(user: User): Promise<User> {
    const versioned = { ...user, schemaVersion: USER_SCHEMA_VERSION };
    this.byId.set(versioned.id, versioned);
    return normalizeUser(versioned);
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
