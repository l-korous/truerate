import { CosmosClient, type Container } from "@azure/cosmos";
import { DefaultAzureCredential } from "@azure/identity";
import type { FeatureFlag, AppConfig } from "./types.js";

// Feature flags and app config repository.
//
// Two containers, two repo interfaces, two backend pairs (Cosmos + Memory),
// following the same pattern as catalog-db.ts.
//
// Flags: boolean feature toggles (non-secret).
// Config: string key/value operational settings (non-secret).
//
// Neither may store prices or secrets.

// ─── FeatureFlagRepo ─────────────────────────────────────────────────────────

export interface FeatureFlagRepo {
  init(): Promise<void>;
  list(environment?: string): Promise<FeatureFlag[]>;
  get(key: string): Promise<FeatureFlag | null>;
  create(flag: FeatureFlag): Promise<FeatureFlag>;
  update(flag: FeatureFlag): Promise<FeatureFlag>;
  delete(key: string): Promise<void>;
}

// ─── AppConfigRepo ───────────────────────────────────────────────────────────

export interface AppConfigRepo {
  init(): Promise<void>;
  list(environment?: string): Promise<AppConfig[]>;
  get(key: string): Promise<AppConfig | null>;
  create(entry: AppConfig): Promise<AppConfig>;
  update(entry: AppConfig): Promise<AppConfig>;
  delete(key: string): Promise<void>;
}

function now(): string {
  return new Date().toISOString();
}

// ─── Cosmos: FeatureFlagRepo ─────────────────────────────────────────────────

class CosmosFeatureFlagRepo implements FeatureFlagRepo {
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
      id: "flags",
      partitionKey: { paths: ["/key"] },
    });
    this.container = container;
  }

  async list(environment?: string): Promise<FeatureFlag[]> {
    const query = environment
      ? {
          query: "SELECT * FROM c WHERE c.environment = @env OR NOT IS_DEFINED(c.environment)",
          parameters: [{ name: "@env", value: environment }],
        }
      : { query: "SELECT * FROM c" };
    const { resources } = await this.container.items.query<FeatureFlag>(query).fetchAll();
    return resources;
  }

  async get(key: string): Promise<FeatureFlag | null> {
    try {
      const { resource } = await this.container.item(key, key).read<FeatureFlag>();
      return resource ?? null;
    } catch {
      return null;
    }
  }

  async create(flag: FeatureFlag): Promise<FeatureFlag> {
    const { resource } = await this.container.items.create<FeatureFlag>(flag);
    return resource as FeatureFlag;
  }

  async update(flag: FeatureFlag): Promise<FeatureFlag> {
    const { resource } = await this.container.item(flag.key, flag.key).replace<FeatureFlag>(flag);
    return resource as FeatureFlag;
  }

  async delete(key: string): Promise<void> {
    await this.container.item(key, key).delete();
  }
}

// ─── Cosmos: AppConfigRepo ───────────────────────────────────────────────────

class CosmosAppConfigRepo implements AppConfigRepo {
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
      id: "appconfig",
      partitionKey: { paths: ["/key"] },
    });
    this.container = container;
  }

  async list(environment?: string): Promise<AppConfig[]> {
    const query = environment
      ? {
          query: "SELECT * FROM c WHERE c.environment = @env OR NOT IS_DEFINED(c.environment)",
          parameters: [{ name: "@env", value: environment }],
        }
      : { query: "SELECT * FROM c" };
    const { resources } = await this.container.items.query<AppConfig>(query).fetchAll();
    return resources;
  }

  async get(key: string): Promise<AppConfig | null> {
    try {
      const { resource } = await this.container.item(key, key).read<AppConfig>();
      return resource ?? null;
    } catch {
      return null;
    }
  }

  async create(entry: AppConfig): Promise<AppConfig> {
    const { resource } = await this.container.items.create<AppConfig>(entry);
    return resource as AppConfig;
  }

  async update(entry: AppConfig): Promise<AppConfig> {
    const { resource } = await this.container.item(entry.key, entry.key).replace<AppConfig>(entry);
    return resource as AppConfig;
  }

  async delete(key: string): Promise<void> {
    await this.container.item(key, key).delete();
  }
}

// ─── In-memory: FeatureFlagRepo ──────────────────────────────────────────────

class MemoryFeatureFlagRepo implements FeatureFlagRepo {
  private flags = new Map<string, FeatureFlag>();

  async init(): Promise<void> {}

  async list(environment?: string): Promise<FeatureFlag[]> {
    const all = [...this.flags.values()];
    if (!environment) return all;
    return all.filter((f) => !f.environment || f.environment === environment);
  }

  async get(key: string): Promise<FeatureFlag | null> {
    return this.flags.get(key) ?? null;
  }

  async create(flag: FeatureFlag): Promise<FeatureFlag> {
    this.flags.set(flag.key, flag);
    return flag;
  }

  async update(flag: FeatureFlag): Promise<FeatureFlag> {
    this.flags.set(flag.key, flag);
    return flag;
  }

  async delete(key: string): Promise<void> {
    this.flags.delete(key);
  }
}

// ─── In-memory: AppConfigRepo ────────────────────────────────────────────────

class MemoryAppConfigRepo implements AppConfigRepo {
  private entries = new Map<string, AppConfig>();

  async init(): Promise<void> {}

  async list(environment?: string): Promise<AppConfig[]> {
    const all = [...this.entries.values()];
    if (!environment) return all;
    return all.filter((e) => !e.environment || e.environment === environment);
  }

  async get(key: string): Promise<AppConfig | null> {
    return this.entries.get(key) ?? null;
  }

  async create(entry: AppConfig): Promise<AppConfig> {
    this.entries.set(entry.key, entry);
    return entry;
  }

  async update(entry: AppConfig): Promise<AppConfig> {
    this.entries.set(entry.key, entry);
    return entry;
  }

  async delete(key: string): Promise<void> {
    this.entries.delete(key);
  }
}

// ─── Singletons ──────────────────────────────────────────────────────────────

let flagRepo: FeatureFlagRepo | null = null;
let configRepo: AppConfigRepo | null = null;

export async function getFeatureFlagRepo(): Promise<FeatureFlagRepo> {
  if (flagRepo) return flagRepo;
  const inMemory = process.env.TRUERATE_INMEMORY === "true" || !process.env.COSMOS_ENDPOINT;
  flagRepo = inMemory ? new MemoryFeatureFlagRepo() : new CosmosFeatureFlagRepo();
  await flagRepo.init();
  return flagRepo;
}

export function resetFeatureFlagRepo(): void {
  flagRepo = null;
}

export async function getAppConfigRepo(): Promise<AppConfigRepo> {
  if (configRepo) return configRepo;
  const inMemory = process.env.TRUERATE_INMEMORY === "true" || !process.env.COSMOS_ENDPOINT;
  configRepo = inMemory ? new MemoryAppConfigRepo() : new CosmosAppConfigRepo();
  await configRepo.init();
  return configRepo;
}

export function resetAppConfigRepo(): void {
  configRepo = null;
}

export { now as _flagsNow };
