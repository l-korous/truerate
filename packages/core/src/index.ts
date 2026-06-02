export * from "./types.js";
export * from "./schemas.js";
export * from "./programs.js";
export * from "./catalog-repo.js";
export * from "./match.js";
export * from "./confidence.js";
export * from "./crypto.js";
export * from "./db.js";
export * from "./catalog-db.js";
export * from "./catalog-cache.js";
export * from "./enrichment.js";
export * from "./logger.js";
export * from "./perk-value.js";
export * from "./partner.js";
export { BookingProvider } from "./providers/booking.js";
export type { HotelProvider, ProviderProperty } from "./providers/types.js";
export { RateLimiter, createRateLimiter } from "./rate-limiter.js";
export type { RateLimiterConfig, RateLimitResult } from "./rate-limiter.js";

// --- Disambiguation (resolves TS2308) ---
// Two catalog stores landed in parallel: `catalog-repo.ts` (CatalogProgram-based)
// and `catalog-db.ts` (CatalogEntryDoc-based), and the catalog status/provenance
// types live in both `types.ts` and `catalog-repo.ts`. The explicit re-exports
// below pick a single source for each clashing name so the `export *` barrel
// compiles. Proper consolidation of the two stores is tracked as a follow-up.
export type { CatalogStatus, CatalogProvenance } from "./types.js";
export type { CatalogRepo } from "./catalog-repo.js";
export { getCatalogRepo } from "./catalog-repo.js";
