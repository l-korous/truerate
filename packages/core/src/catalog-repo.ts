import { CosmosClient, type Container } from "@azure/cosmos";
import { DefaultAzureCredential } from "@azure/identity";
import type { Program } from "./types.js";

// Catalog data-access layer — mirrors the UserRepo pattern from db.ts.
//
// A CatalogProgram wraps Program with the lifecycle metadata needed to operate
// an ops-editable store: version (source as-of), status, and provenance.
// The Programs are partitioned by /id (point reads, 1 RU).
//
// Two backends share one interface:
//   • CosmosCatalogRepo  — production / Azure (COSMOS_ENDPOINT set)
//   • MemoryCatalogRepo  — local dev + tests (TRUERATE_INMEMORY=true or no endpoint)

export type CatalogStatus = "published" | "draft" | "archived";

export type CatalogProvenance =
  | "manual-seed"
  | "scrape"
  | "admin-edit"
  | "partner-submission";

/** A Program document as stored in Cosmos, with catalog lifecycle metadata. */
export interface CatalogProgram extends Program {
  /** Source as-of date, e.g. "2026-05". Inherited from Program.asOf when seeding. */
  version: string;
  /** Lifecycle state; seeded records start as "published". */
  status: CatalogStatus;
  /** Where this record came from. */
  provenance: CatalogProvenance;
  /** ISO-8601 timestamp of last update in the store. */
  updatedAt: string;
}

export interface CatalogRepo {
  init(): Promise<void>;
  getById(id: string): Promise<CatalogProgram | null>;
  getAll(status?: CatalogStatus): Promise<CatalogProgram[]>;
  upsert(program: CatalogProgram): Promise<CatalogProgram>;
  upsertMany(programs: CatalogProgram[]): Promise<CatalogProgram[]>;
}

// ─── Cosmos backend ──────────────────────────────────────────────────────────

class CosmosCatalogRepo implements CatalogRepo {
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
      id: "catalog",
      partitionKey: { paths: ["/id"] },
    });
    this.container = container;
  }

  async getById(id: string): Promise<CatalogProgram | null> {
    try {
      const { resource } = await this.container.item(id, id).read<CatalogProgram>();
      return resource ?? null;
    } catch {
      return null;
    }
  }

  async getAll(status?: CatalogStatus): Promise<CatalogProgram[]> {
    const query = status
      ? {
          query: "SELECT * FROM c WHERE c.status = @status",
          parameters: [{ name: "@status", value: status }],
        }
      : { query: "SELECT * FROM c" };
    const { resources } = await this.container.items
      .query<CatalogProgram>(query)
      .fetchAll();
    return resources;
  }

  async upsert(program: CatalogProgram): Promise<CatalogProgram> {
    const doc = { ...program, updatedAt: new Date().toISOString() };
    const { resource } = await this.container.items.upsert<CatalogProgram>(doc);
    return resource as CatalogProgram;
  }

  async upsertMany(programs: CatalogProgram[]): Promise<CatalogProgram[]> {
    return Promise.all(programs.map((p) => this.upsert(p)));
  }
}

// ─── In-memory backend (local dev / tests) ───────────────────────────────────

export class MemoryCatalogRepo implements CatalogRepo {
  private byId = new Map<string, CatalogProgram>();

  async init(): Promise<void> {}

  async getById(id: string): Promise<CatalogProgram | null> {
    return this.byId.get(id) ?? null;
  }

  async getAll(status?: CatalogStatus): Promise<CatalogProgram[]> {
    const all = [...this.byId.values()];
    return status ? all.filter((p) => p.status === status) : all;
  }

  async upsert(program: CatalogProgram): Promise<CatalogProgram> {
    const doc = { ...program, updatedAt: new Date().toISOString() };
    this.byId.set(doc.id, doc);
    return doc;
  }

  async upsertMany(programs: CatalogProgram[]): Promise<CatalogProgram[]> {
    return Promise.all(programs.map((p) => this.upsert(p)));
  }
}

let repo: CatalogRepo | null = null;

/** Singleton repo, chosen by env. Call once at startup, then reuse. */
export async function getCatalogRepo(): Promise<CatalogRepo> {
  if (repo) return repo;
  const inMemory = process.env.TRUERATE_INMEMORY === "true" || !process.env.COSMOS_ENDPOINT;
  repo = inMemory ? new MemoryCatalogRepo() : new CosmosCatalogRepo();
  await repo.init();
  return repo;
}

/** Convert a Program + metadata into a CatalogProgram ready for the store. */
export function toCatalogProgram(
  program: Program,
  opts: { provenance?: CatalogProvenance; status?: CatalogStatus } = {},
): CatalogProgram {
  return {
    ...program,
    version: program.asOf ?? "unknown",
    status: opts.status ?? "published",
    provenance: opts.provenance ?? "manual-seed",
    updatedAt: new Date().toISOString(),
  };
}
