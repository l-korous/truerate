import { CosmosClient, type Container } from "@azure/cosmos";
import { DefaultAzureCredential } from "@azure/identity";
import { randomUUID } from "node:crypto";
import type {
  CatalogEntryDoc,
  CatalogEntryInput,
  CatalogStatus,
  Program,
} from "./types.js";

/**
 * Convert a published CatalogEntryDoc to the Program shape expected by
 * instantiateBenefits / templatesForTier / summariseBenefits.
 */
export function catalogEntryToProgram(entry: CatalogEntryDoc): Program {
  return {
    id: entry.programId,
    name: entry.name,
    category: entry.category,
    defaultMatch: entry.defaultMatch,
    tiers: entry.tiers,
    fields: entry.fields,
    requiresCredential: entry.requiresCredential,
    benefits: entry.benefits,
    sourceUrl: entry.provenance.sourceUrl,
    asOf: entry.provenance.asOf,
    region: entry.region,
  };
}

// CatalogRepo — versioned, provenance-tracked store for the loyalty-program
// catalog.  Two backends share one interface, mirroring the UserRepo pattern:
//   • CosmosCatalogRepo   — production / Azure (catalog container)
//   • MemoryCatalogRepo   — local dev, tests, demos (TRUERATE_INMEMORY=true)
//
// Versioning model:
//   • Each document represents one immutable snapshot of a program entry.
//   • document id = "{programId}-v{version}" (unique; enables point reads)
//     ("#" is illegal in a Cosmos id, so the separator is "-v")
//   • partition key = programId (all versions co-located — no cross-partition queries)
//   • Exactly one document per programId has isCurrent=true (the live entry).
//   • Status lifecycle: draft → in-review → published; published → archived
//
// No price fields are stored.  benefits may contain percentDiscount and
// fixedDiscount indicative terms from published program pages, but never
// hotel room prices or amounts derived from property rates.

export interface CatalogRepo {
  init(): Promise<void>;
  /** Get the current (isCurrent=true) entry for a program. */
  getCurrent(programId: string): Promise<CatalogEntryDoc | null>;
  /** List all published+current entries; filter by region when provided. */
  listPublished(region?: string): Promise<CatalogEntryDoc[]>;
  /** List all entries with a given status across all programs. */
  listByStatus(status: CatalogStatus): Promise<CatalogEntryDoc[]>;
  /** Point-read a specific version. */
  getVersion(programId: string, version: number): Promise<CatalogEntryDoc | null>;
  /** All versions for a program, newest first. */
  getHistory(programId: string): Promise<CatalogEntryDoc[]>;
  /**
   * Create or update the open draft for a program.
   * If no draft exists: creates version maxVersion+1 (or 1 for new programs).
   * If a draft already exists: updates the draft document in place.
   */
  upsertDraft(input: CatalogEntryInput): Promise<CatalogEntryDoc>;
  /**
   * Publish the current draft for a program.
   * Sets draft status → published, isCurrent=true.
   * Marks the previous current entry isCurrent=false.
   */
  publish(programId: string): Promise<CatalogEntryDoc>;
  /**
   * Archive the current published entry for a program.
   * Sets isCurrent=false, status=archived.
   */
  archive(programId: string): Promise<void>;
  /**
   * Seed a batch of entries.  Each entry is upserted as a new published
   * version only when no current entry for that programId already exists.
   * Idempotent: safe to run multiple times on startup.
   */
  seedIfEmpty(entries: CatalogEntryInput[]): Promise<{ seeded: number; skipped: number }>;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeId(programId: string, version: number): string {
  // NOTE: Cosmos DB forbids the characters / \ ? # in a document id. The id is
  // opaque (never parsed back — only used as a point-read key), so the separator
  // just has to be legal and stable. "-v" is URL- and Cosmos-safe and is
  // unambiguous against the underscore-style programId slugs (e.g. booking_genius).
  // Using "#" here silently broke every Cosmos write ("Id contains illegal
  // chars.") while passing in the in-memory repo, which has no such validation.
  return `${programId}-v${version}`;
}

function now(): string {
  return new Date().toISOString();
}

// ─── Cosmos backend ─────────────────────────────────────────────────────────

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
      partitionKey: { paths: ["/programId"] },
    });
    this.container = container;
  }

  async getCurrent(programId: string): Promise<CatalogEntryDoc | null> {
    const { resources } = await this.container.items
      .query<CatalogEntryDoc>({
        query: "SELECT * FROM c WHERE c.programId = @pid AND c.isCurrent = true",
        parameters: [{ name: "@pid", value: programId }],
      })
      .fetchAll();
    return resources[0] ?? null;
  }

  async listPublished(region?: string): Promise<CatalogEntryDoc[]> {
    const base = "SELECT * FROM c WHERE c.isCurrent = true AND c.status = 'published'";
    const query = region
      ? { query: `${base} AND (c.region = @region OR c.region = 'Global')`, parameters: [{ name: "@region", value: region }] }
      : { query: base };
    const { resources } = await this.container.items.query<CatalogEntryDoc>(query).fetchAll();
    return resources;
  }

  async listByStatus(status: CatalogStatus): Promise<CatalogEntryDoc[]> {
    const { resources } = await this.container.items
      .query<CatalogEntryDoc>({
        query: "SELECT * FROM c WHERE c.status = @status",
        parameters: [{ name: "@status", value: status }],
      })
      .fetchAll();
    return resources;
  }

  async getVersion(programId: string, version: number): Promise<CatalogEntryDoc | null> {
    try {
      const id = makeId(programId, version);
      const { resource } = await this.container.item(id, programId).read<CatalogEntryDoc>();
      return resource ?? null;
    } catch {
      return null;
    }
  }

  async getHistory(programId: string): Promise<CatalogEntryDoc[]> {
    const { resources } = await this.container.items
      .query<CatalogEntryDoc>({
        query: "SELECT * FROM c WHERE c.programId = @pid ORDER BY c.version DESC",
        parameters: [{ name: "@pid", value: programId }],
      })
      .fetchAll();
    return resources;
  }

  async upsertDraft(input: CatalogEntryInput): Promise<CatalogEntryDoc> {
    const { programId } = input;
    const history = await this.getHistory(programId);
    const existingDraft = history.find((e) => e.status === "draft");

    if (existingDraft) {
      const updated: CatalogEntryDoc = {
        ...existingDraft,
        ...input,
        id: existingDraft.id,
        programId,
        version: existingDraft.version,
        isCurrent: false,
        status: "draft",
        updatedAt: now(),
      };
      const { resource } = await this.container.item(updated.id, programId).replace<CatalogEntryDoc>(updated);
      return resource as CatalogEntryDoc;
    }

    const maxVersion = history.reduce((max, e) => Math.max(max, e.version), 0);
    const newDoc: CatalogEntryDoc = {
      ...input,
      id: makeId(programId, maxVersion + 1),
      programId,
      version: maxVersion + 1,
      isCurrent: false,
      status: "draft",
      createdAt: now(),
      updatedAt: now(),
    };
    const { resource } = await this.container.items.create<CatalogEntryDoc>(newDoc);
    return resource as CatalogEntryDoc;
  }

  async publish(programId: string): Promise<CatalogEntryDoc> {
    const history = await this.getHistory(programId);
    const draft = history.find((e) => e.status === "draft");
    if (!draft) throw new Error(`No draft found for program '${programId}'.`);

    const prevCurrent = history.find((e) => e.isCurrent);

    // Demote previous current entry
    if (prevCurrent && prevCurrent.id !== draft.id) {
      const demoted: CatalogEntryDoc = { ...prevCurrent, isCurrent: false, updatedAt: now() };
      await this.container.item(demoted.id, programId).replace<CatalogEntryDoc>(demoted);
    }

    const published: CatalogEntryDoc = {
      ...draft,
      isCurrent: true,
      status: "published",
      publishedAt: now(),
      updatedAt: now(),
    };
    const { resource } = await this.container.item(published.id, programId).replace<CatalogEntryDoc>(published);
    return resource as CatalogEntryDoc;
  }

  async archive(programId: string): Promise<void> {
    const current = await this.getCurrent(programId);
    if (!current) return;
    const archived: CatalogEntryDoc = { ...current, isCurrent: false, status: "archived", archivedAt: now(), updatedAt: now() };
    await this.container.item(archived.id, programId).replace<CatalogEntryDoc>(archived);
  }

  async seedIfEmpty(entries: CatalogEntryInput[]): Promise<{ seeded: number; skipped: number }> {
    let seeded = 0;
    let skipped = 0;
    for (const entry of entries) {
      const existing = await this.getCurrent(entry.programId);
      if (existing) { skipped++; continue; }

      const doc: CatalogEntryDoc = {
        ...entry,
        id: makeId(entry.programId, 1),
        version: 1,
        isCurrent: true,
        status: "published",
        createdAt: now(),
        updatedAt: now(),
        publishedAt: now(),
      };
      await this.container.items.create<CatalogEntryDoc>(doc);
      seeded++;
    }
    return { seeded, skipped };
  }
}

// ─── In-memory backend (local dev / tests) ──────────────────────────────────

class MemoryCatalogRepo implements CatalogRepo {
  // All docs keyed by id; programId is used for partition grouping
  private docs = new Map<string, CatalogEntryDoc>();

  async init(): Promise<void> {}

  private forProgram(programId: string): CatalogEntryDoc[] {
    return [...this.docs.values()].filter((d) => d.programId === programId);
  }

  async getCurrent(programId: string): Promise<CatalogEntryDoc | null> {
    return this.forProgram(programId).find((d) => d.isCurrent) ?? null;
  }

  async listPublished(region?: string): Promise<CatalogEntryDoc[]> {
    return [...this.docs.values()].filter(
      (d) =>
        d.isCurrent &&
        d.status === "published" &&
        (!region || d.region === region || d.region === "Global"),
    );
  }

  async listByStatus(status: CatalogStatus): Promise<CatalogEntryDoc[]> {
    return [...this.docs.values()].filter((d) => d.status === status);
  }

  async getVersion(programId: string, version: number): Promise<CatalogEntryDoc | null> {
    return this.docs.get(makeId(programId, version)) ?? null;
  }

  async getHistory(programId: string): Promise<CatalogEntryDoc[]> {
    return this.forProgram(programId).sort((a, b) => b.version - a.version);
  }

  async upsertDraft(input: CatalogEntryInput): Promise<CatalogEntryDoc> {
    const { programId } = input;
    const history = await this.getHistory(programId);
    const existingDraft = history.find((e) => e.status === "draft");

    if (existingDraft) {
      const updated: CatalogEntryDoc = {
        ...existingDraft,
        ...input,
        id: existingDraft.id,
        programId,
        version: existingDraft.version,
        isCurrent: false,
        status: "draft",
        updatedAt: now(),
      };
      this.docs.set(updated.id, updated);
      return updated;
    }

    const maxVersion = history.reduce((max, e) => Math.max(max, e.version), 0);
    const newDoc: CatalogEntryDoc = {
      ...input,
      id: makeId(programId, maxVersion + 1),
      programId,
      version: maxVersion + 1,
      isCurrent: false,
      status: "draft",
      createdAt: now(),
      updatedAt: now(),
    };
    this.docs.set(newDoc.id, newDoc);
    return newDoc;
  }

  async publish(programId: string): Promise<CatalogEntryDoc> {
    const history = await this.getHistory(programId);
    const draft = history.find((e) => e.status === "draft");
    if (!draft) throw new Error(`No draft found for program '${programId}'.`);

    const prevCurrent = history.find((e) => e.isCurrent);
    if (prevCurrent) {
      this.docs.set(prevCurrent.id, { ...prevCurrent, isCurrent: false, updatedAt: now() });
    }

    const published: CatalogEntryDoc = {
      ...draft,
      isCurrent: true,
      status: "published",
      publishedAt: now(),
      updatedAt: now(),
    };
    this.docs.set(published.id, published);
    return published;
  }

  async archive(programId: string): Promise<void> {
    const current = await this.getCurrent(programId);
    if (!current) return;
    this.docs.set(current.id, {
      ...current,
      isCurrent: false,
      status: "archived",
      archivedAt: now(),
      updatedAt: now(),
    });
  }

  async seedIfEmpty(entries: CatalogEntryInput[]): Promise<{ seeded: number; skipped: number }> {
    let seeded = 0;
    let skipped = 0;
    for (const entry of entries) {
      const existing = await this.getCurrent(entry.programId);
      if (existing) { skipped++; continue; }

      const doc: CatalogEntryDoc = {
        ...entry,
        id: makeId(entry.programId, 1),
        version: 1,
        isCurrent: true,
        status: "published",
        createdAt: now(),
        updatedAt: now(),
        publishedAt: now(),
      };
      this.docs.set(doc.id, doc);
      seeded++;
    }
    return { seeded, skipped };
  }
}

// ─── Seeding helper ──────────────────────────────────────────────────────────

/**
 * Convert a static Program entry to a CatalogEntryInput for seeding.
 * Provenance source is "manual-seed" and status will be set to "published"
 * by seedIfEmpty().
 */
export function programToCatalogInput(program: Program): CatalogEntryInput {
  return {
    programId: program.id,
    provenance: {
      source: "manual-seed",
      sourceUrl: program.sourceUrl,
      asOf: program.asOf ?? new Date().toISOString().slice(0, 7),
    },
    region: program.region ?? "Global",
    name: program.name,
    category: program.category,
    defaultMatch: program.defaultMatch,
    tiers: program.tiers,
    requiresCredential: program.requiresCredential,
    fields: program.fields,
    benefits: program.benefits,
  };
}

// ─── Singleton factory ───────────────────────────────────────────────────────

let catalogRepo: CatalogRepo | null = null;

/** Singleton catalog repo, chosen by env. Call once at startup, then reuse. */
export async function getCatalogRepo(): Promise<CatalogRepo> {
  if (catalogRepo) return catalogRepo;
  const inMemory = process.env.TRUERATE_INMEMORY === "true" || !process.env.COSMOS_ENDPOINT;
  catalogRepo = inMemory ? new MemoryCatalogRepo() : new CosmosCatalogRepo();
  await catalogRepo.init();
  return catalogRepo;
}

/** Reset the singleton — for use in tests only. */
export function resetCatalogRepo(): void {
  catalogRepo = null;
}

