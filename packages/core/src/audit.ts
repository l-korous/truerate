import { CosmosClient, type Container, type SqlParameter } from "@azure/cosmos";
import { DefaultAzureCredential } from "@azure/identity";

/**
 * Canonical support / admin action names recorded in the audit log.
 * Append-only — never remove entries once in production.
 */
export type AuditAction =
  // Support: user management
  | "support.user.view"
  | "support.user.search"
  | "support.user.mcp_url.rotate"
  | "support.user.mcp_url.revoke"
  // Admin: catalog
  | "admin.catalog.draft.create"
  | "admin.catalog.draft.update"
  | "admin.catalog.publish"
  | "admin.catalog.archive"
  | "admin.catalog.restore"
  // Admin: partner orgs
  | "admin.partner.create"
  | "admin.partner.approve"
  | "admin.partner.reject"
  // Admin: submissions
  | "admin.submission.edit"
  | "admin.submission.approve"
  | "admin.submission.reject"
  // Admin: feature flags
  | "admin.flag.create"
  | "admin.flag.update"
  | "admin.flag.delete"
  // Admin: app config
  | "admin.config.create"
  | "admin.config.update"
  | "admin.config.delete";

export interface AuditEntry {
  /** Unique document id. */
  id: string;
  /** ISO-8601 timestamp of the action. */
  timestamp: string;
  /** Identity of the admin / support actor. */
  actor: string;
  /** Canonical action name. */
  action: AuditAction;
  /** Primary entity this action was performed on (e.g. userId). */
  targetId: string;
  /** Target entity type, e.g. "user", "catalog", "partner", "submission". */
  targetType: string;
  /** State snapshot before the action (no prices, no raw PII). */
  before?: Record<string, unknown>;
  /** State snapshot after the action (no prices, no raw PII). */
  after?: Record<string, unknown>;
  /** Optional free-text or structured context; must never contain prices or raw PII. */
  notes?: string;
}

export interface AuditFilter {
  actor?: string;
  action?: AuditAction;
  targetId?: string;
  targetType?: string;
  /** ISO-8601 lower bound (inclusive). */
  since?: string;
  /** ISO-8601 upper bound (inclusive). */
  until?: string;
}

export interface AuditRepo {
  init(): Promise<void>;
  append(entry: Omit<AuditEntry, "id" | "timestamp">): Promise<AuditEntry>;
  listByTarget(targetId: string, limit?: number): Promise<AuditEntry[]>;
  listRecent(limit?: number): Promise<AuditEntry[]>;
  listFiltered(filter: AuditFilter, limit?: number): Promise<AuditEntry[]>;
}

// ─── In-memory backend ──────────────────────────────────────────────────────

class MemoryAuditRepo implements AuditRepo {
  private entries: AuditEntry[] = [];
  private counter = 0;

  async init(): Promise<void> {}

  async append(entry: Omit<AuditEntry, "id" | "timestamp">): Promise<AuditEntry> {
    const full: AuditEntry = {
      ...entry,
      id: `audit-${++this.counter}`,
      timestamp: new Date().toISOString(),
    };
    this.entries.push(full);
    return full;
  }

  async listByTarget(targetId: string, limit = 50): Promise<AuditEntry[]> {
    return this.entries
      .filter((e) => e.targetId === targetId)
      .slice(-limit)
      .reverse();
  }

  async listRecent(limit = 50): Promise<AuditEntry[]> {
    return [...this.entries].reverse().slice(0, limit);
  }

  async listFiltered(filter: AuditFilter, limit = 50): Promise<AuditEntry[]> {
    return this.entries
      .filter((e) => {
        if (filter.actor && e.actor !== filter.actor) return false;
        if (filter.action && e.action !== filter.action) return false;
        if (filter.targetId && e.targetId !== filter.targetId) return false;
        if (filter.targetType && e.targetType !== filter.targetType) return false;
        if (filter.since && e.timestamp < filter.since) return false;
        if (filter.until && e.timestamp > filter.until) return false;
        return true;
      })
      .reverse()
      .slice(0, limit);
  }
}

// ─── Cosmos backend ─────────────────────────────────────────────────────────

class CosmosAuditRepo implements AuditRepo {
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
      id: "audit",
      partitionKey: { paths: ["/targetId"] },
    });
    this.container = container;
  }

  async append(entry: Omit<AuditEntry, "id" | "timestamp">): Promise<AuditEntry> {
    const full: AuditEntry = {
      ...entry,
      id: `${entry.action}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      timestamp: new Date().toISOString(),
    };
    await this.container.items.create(full);
    return full;
  }

  async listByTarget(targetId: string, limit = 50): Promise<AuditEntry[]> {
    const { resources } = await this.container.items
      .query<AuditEntry>({
        query: "SELECT * FROM c WHERE c.targetId = @targetId ORDER BY c.timestamp DESC OFFSET 0 LIMIT @limit",
        parameters: [
          { name: "@targetId", value: targetId },
          { name: "@limit", value: limit },
        ],
      })
      .fetchAll();
    return resources;
  }

  async listRecent(limit = 50): Promise<AuditEntry[]> {
    const { resources } = await this.container.items
      .query<AuditEntry>({
        query: "SELECT * FROM c ORDER BY c.timestamp DESC OFFSET 0 LIMIT @limit",
        parameters: [{ name: "@limit", value: limit }],
      })
      .fetchAll();
    return resources;
  }

  async listFiltered(filter: AuditFilter, limit = 50): Promise<AuditEntry[]> {
    const conditions: string[] = [];
    const parameters: SqlParameter[] = [{ name: "@limit", value: limit }];

    if (filter.actor) {
      conditions.push("c.actor = @actor");
      parameters.push({ name: "@actor", value: filter.actor });
    }
    if (filter.action) {
      conditions.push("c.action = @action");
      parameters.push({ name: "@action", value: filter.action });
    }
    if (filter.targetId) {
      conditions.push("c.targetId = @targetId");
      parameters.push({ name: "@targetId", value: filter.targetId });
    }
    if (filter.targetType) {
      conditions.push("c.targetType = @targetType");
      parameters.push({ name: "@targetType", value: filter.targetType });
    }
    if (filter.since) {
      conditions.push("c.timestamp >= @since");
      parameters.push({ name: "@since", value: filter.since });
    }
    if (filter.until) {
      conditions.push("c.timestamp <= @until");
      parameters.push({ name: "@until", value: filter.until });
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const { resources } = await this.container.items
      .query<AuditEntry>({
        query: `SELECT * FROM c ${where} ORDER BY c.timestamp DESC OFFSET 0 LIMIT @limit`,
        parameters,
      })
      .fetchAll();
    return resources;
  }
}

let auditRepo: AuditRepo | null = null;

export async function getAuditRepo(): Promise<AuditRepo> {
  if (auditRepo) return auditRepo;
  const inMemory = process.env.TRUERATE_INMEMORY === "true" || !process.env.COSMOS_ENDPOINT;
  auditRepo = inMemory ? new MemoryAuditRepo() : new CosmosAuditRepo();
  await auditRepo.init();
  return auditRepo;
}

export function resetAuditRepo(): void {
  auditRepo = null;
}
