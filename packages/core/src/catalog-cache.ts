import type { CatalogEntryDoc } from "./types.js";
import type { CatalogRepo } from "./catalog-db.js";
import { getCatalogRepo } from "./catalog-db.js";

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * TTL-based in-memory read cache for published catalog entries.
 * Channels (api, mcp) use this to avoid a Cosmos round-trip on every request.
 * Call invalidate() after a publish event to force a fresh read on next access.
 */
export class CatalogCache {
  private readonly ttlMs: number;
  private listCache = new Map<string, CacheEntry<CatalogEntryDoc[]>>();
  private currentCache = new Map<string, CacheEntry<CatalogEntryDoc | null>>();

  constructor(public readonly repo: CatalogRepo, ttlMs = DEFAULT_TTL_MS) {
    this.ttlMs = ttlMs;
  }

  async listPublished(region?: string): Promise<CatalogEntryDoc[]> {
    const key = region ?? "__all__";
    const hit = this.listCache.get(key);
    if (hit && Date.now() < hit.expiresAt) return hit.value;
    const value = await this.repo.listPublished(region);
    this.listCache.set(key, { value, expiresAt: Date.now() + this.ttlMs });
    return value;
  }

  async getCurrent(programId: string): Promise<CatalogEntryDoc | null> {
    const hit = this.currentCache.get(programId);
    if (hit && Date.now() < hit.expiresAt) return hit.value;
    const value = await this.repo.getCurrent(programId);
    this.currentCache.set(programId, { value, expiresAt: Date.now() + this.ttlMs });
    return value;
  }

  /** Invalidate one program (and all list caches) or the entire cache. */
  invalidate(programId?: string): void {
    if (programId) {
      this.currentCache.delete(programId);
      this.listCache.clear();
    } else {
      this.listCache.clear();
      this.currentCache.clear();
    }
  }
}

let _cache: CatalogCache | null = null;

/** Singleton catalog cache lazily initialized from getCatalogRepo(). */
export async function getCatalogCache(ttlMs?: number): Promise<CatalogCache> {
  if (_cache) return _cache;
  const repo = await getCatalogRepo();
  _cache = new CatalogCache(repo, ttlMs);
  return _cache;
}

/** Reset the catalog cache singleton — tests only. */
export function resetCatalogCache(): void {
  _cache = null;
}
