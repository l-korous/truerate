import { CosmosClient, type Container } from "@azure/cosmos";
import { DefaultAzureCredential } from "@azure/identity";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface FeatureFlag {
  /** Stable machine-readable key, e.g. "mcp.hints.enabled". */
  key: string;
  /** Human-readable label shown in the admin UI. */
  label: string;
  /** Whether the flag is currently enabled. */
  enabled: boolean;
  /** Optional description of what the flag controls. */
  description?: string;
  /** Optional environment scope ("production" | "staging" | "all"). Defaults to "all". */
  environment?: string;
  /** ISO-8601 timestamp of last change. */
  updatedAt: string;
  /** Actor who last changed the flag. */
  updatedBy: string;
}

export interface AppConfig {
  /** Stable machine-readable key, e.g. "catalog.staleness.warn_months". */
  key: string;
  /** Human-readable label shown in the admin UI. */
  label: string;
  /** The config value (string; the consumer interprets the type). */
  value: string;
  /** Optional description of what the config controls. */
  description?: string;
  /** ISO-8601 timestamp of last change. */
  updatedAt: string;
  /** Actor who last changed the config. */
  updatedBy: string;
}

// ─── FeatureFlagRepo interface ────────────────────────────────────────────────

export interface FeatureFlagRepo {
  init(): Promise<void>;
  list(): Promise<FeatureFlag[]>;
  get(key: string): Promise<FeatureFlag | null>;
  upsert(flag: FeatureFlag): Promise<FeatureFlag>;
  delete(key: string): Promise<void>;
}

// ─── AppConfigRepo interface ──────────────────────────────────────────────────

export interface AppConfigRepo {
  init(): Promise<void>;
  list(): Promise<AppConfig[]>;
  get(key: string): Promise<AppConfig | null>;
  upsert(entry: AppConfig): Promise<AppConfig>;
  delete(key: string): Promise<void>;
}

// ─── In-memory backends ───────────────────────────────────────────────────────

class MemoryFeatureFlagRepo implements FeatureFlagRepo {
  private flags = new Map<string, FeatureFlag>();

  async init(): Promise<void> {}

  async list(): Promise<FeatureFlag[]> {
    return [...this.flags.values()].sort((a, b) => a.key.localeCompare(b.key));
  }

  async get(key: string): Promise<FeatureFlag | null> {
    return this.flags.get(key) ?? null;
  }

  async upsert(flag: FeatureFlag): Promise<FeatureFlag> {
    this.flags.set(flag.key, { ...flag });
    return flag;
  }

  async delete(key: string): Promise<void> {
    this.flags.delete(key);
  }
}

class MemoryAppConfigRepo implements AppConfigRepo {
  private configs = new Map<string, AppConfig>();

  async init(): Promise<void> {}

  async list(): Promise<AppConfig[]> {
    return [...this.configs.values()].sort((a, b) => a.key.localeCompare(b.key));
  }

  async get(key: string): Promise<AppConfig | null> {
    return this.configs.get(key) ?? null;
  }

  async upsert(entry: AppConfig): Promise<AppConfig> {
    this.configs.set(entry.key, { ...entry });
    return entry;
  }

  async delete(key: string): Promise<void> {
    this.configs.delete(key);
  }
}

// ─── Cosmos backends ──────────────────────────────────────────────────────────

class CosmosFeatureFlagRepo implements FeatureFlagRepo {
  private container!: Container;

  async init(): Promise<void> {
    const endpoint = process.env.COSMOS_ENDPOINT;
    if (!endpoint) throw new Error("COSMOS_ENDPOINT is required");

    const key = process.env.COSMOS_KEY;
    const client = key
      ? new CosmosClient({ endpoint, key })
      : new CosmosClient({ endpoint, aadCredentials: new DefaultAzureCredential() });

    const dbName = process.env.COSMOS_DATABASE ?? "truerate";
    const { database } = await client.databases.createIfNotExists({ id: dbName });
    const { container } = await database.containers.createIfNotExists({
      id: "feature_flags",
      partitionKey: { paths: ["/key"] },
    });
    this.container = container;
  }

  async list(): Promise<FeatureFlag[]> {
    const { resources } = await this.container.items
      .query<FeatureFlag>({ query: "SELECT * FROM c ORDER BY c.key" })
      .fetchAll();
    return resources;
  }

  async get(key: string): Promise<FeatureFlag | null> {
    const { resource } = await this.container.item(key, key).read<FeatureFlag>();
    return resource ?? null;
  }

  async upsert(flag: FeatureFlag): Promise<FeatureFlag> {
    await this.container.items.upsert({ ...flag, id: flag.key });
    return flag;
  }

  async delete(key: string): Promise<void> {
    await this.container.item(key, key).delete();
  }
}

class CosmosAppConfigRepo implements AppConfigRepo {
  private container!: Container;

  async init(): Promise<void> {
    const endpoint = process.env.COSMOS_ENDPOINT;
    if (!endpoint) throw new Error("COSMOS_ENDPOINT is required");

    const key = process.env.COSMOS_KEY;
    const client = key
      ? new CosmosClient({ endpoint, key })
      : new CosmosClient({ endpoint, aadCredentials: new DefaultAzureCredential() });

    const dbName = process.env.COSMOS_DATABASE ?? "truerate";
    const { database } = await client.databases.createIfNotExists({ id: dbName });
    const { container } = await database.containers.createIfNotExists({
      id: "app_config",
      partitionKey: { paths: ["/key"] },
    });
    this.container = container;
  }

  async list(): Promise<AppConfig[]> {
    const { resources } = await this.container.items
      .query<AppConfig>({ query: "SELECT * FROM c ORDER BY c.key" })
      .fetchAll();
    return resources;
  }

  async get(key: string): Promise<AppConfig | null> {
    const { resource } = await this.container.item(key, key).read<AppConfig>();
    return resource ?? null;
  }

  async upsert(entry: AppConfig): Promise<AppConfig> {
    await this.container.items.upsert({ ...entry, id: entry.key });
    return entry;
  }

  async delete(key: string): Promise<void> {
    await this.container.item(key, key).delete();
  }
}

// ─── Singletons ───────────────────────────────────────────────────────────────

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
