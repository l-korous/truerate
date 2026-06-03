// Mirrors packages/core/src/confidence.ts logic for use in the web admin.
// No dependency on @truerate/core to avoid adding it as a web dependency.

export type ConfidenceLevel = "high" | "medium" | "low" | "stale";

// Per-category TTLs in months — must stay in sync with core/src/confidence.ts
const CATEGORY_TTL_MONTHS: Record<string, number> = {
  hotel: 6, ota: 6, card: 6, subscription: 3, airline: 12, rail: 12, carRental: 12,
};

/**
 * Compute staleness level from an asOf "YYYY-MM" string and program category.
 *
 * Mirrors the band logic in packages/core/src/confidence.ts.
 * Applies to terms/conditions freshness only — never to prices.
 */
export function computeStalenessLevel(
  asOf: string | undefined,
  category: string,
  now?: Date,
): ConfidenceLevel {
  if (!asOf) return "stale";
  const m = /^(\d{4})-(\d{2})$/.exec(asOf);
  if (!m) return "stale";
  const entryDate = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1));
  const reference = now ?? new Date();
  const ttl = CATEGORY_TTL_MONTHS[category] ?? 6;
  const ageMonths =
    (reference.getFullYear() - entryDate.getUTCFullYear()) * 12 +
    (reference.getMonth() - entryDate.getUTCMonth());
  if (ageMonths < ttl * 0.5) return "high";
  if (ageMonths < ttl) return "medium";
  if (ageMonths < ttl * 2) return "low";
  return "stale";
}
