import { CosmosClient, type Container } from "@azure/cosmos";
import { DefaultAzureCredential } from "@azure/identity";

/**
 * Canonical support / admin action names recorded in the audit log.
 * Append-only — never remove entries once in production.
 */
export type AuditAction =
  | "support.user.view"
  | "support.user.search"
  | "support.user.mcp_url.rotate"
  | "support.user.mcp_url.revoke";

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
  /** Target entity type, e.g. "user". */
  targetType: string;
  /** Optional free-text or structured context; must never contain prices or raw PII. */
  notes?: string;
}

export interface AuditRepo {
  init(): Promise<void>;
  append(entry: Omit<AuditEntry, "id" | "timestamp">): Promise<AuditEntry>;
  listByTarget(targetId: string, limit?: number): Promise<AuditEntry[]>;
  listRecent(limit?: number): Promise<AuditEntry[]>;
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
