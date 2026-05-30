import { CosmosClient, type Container } from "@azure/cosmos";
import { DefaultAzureCredential } from "@azure/identity";
import type { User } from "./types.js";

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
      return resource ?? null;
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
    return resources[0] ?? null;
  }

  async create(user: User): Promise<User> {
    const { resource } = await this.container.items.create<User>(user);
    return resource as User;
  }

  async update(user: User): Promise<User> {
    const { resource } = await this.container.item(user.id, user.id).replace<User>(user);
    return resource as User;
  }
}

// ─── In-memory backend (local dev / demos) ──────────────────────────────────

class MemoryUserRepo implements UserRepo {
  private byId = new Map<string, User>();

  async init(): Promise<void> {}

  async getById(id: string): Promise<User | null> {
    return this.byId.get(id) ?? null;
  }

  async getByEmail(email: string): Promise<User | null> {
    const target = email.toLowerCase();
    for (const u of this.byId.values()) if (u.email === target) return u;
    return null;
  }

  async create(user: User): Promise<User> {
    this.byId.set(user.id, user);
    return user;
  }

  async update(user: User): Promise<User> {
    this.byId.set(user.id, user);
    return user;
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
