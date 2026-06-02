import type { ProgramCategory } from "./types.js";

// Per-category TTL in months. These govern how quickly catalog entries age
// before confidence degrades — OTA/hotel terms change faster than airline rules.
const CATEGORY_TTL_MONTHS: Record<ProgramCategory, number> = {
  hotel:        6,
  ota:          6,
  card:         6,
  subscription: 3,
  airline:      12,
  rail:         12,
  carRental:    12,
};

const DEFAULT_TTL_MONTHS = 6;

export type ConfidenceLevel = "high" | "medium" | "low" | "stale";

/**
 * Staleness / trustworthiness signal derived from `asOf`, category, and
 * provenance. Never touches prices — applies to terms and perk-value estimates.
 */
export interface ConfidenceScore {
  /** Qualitative band for display / filtering. */
  level: ConfidenceLevel;
  /** 0–1 numeric score (1 = freshest, 0.1 = stale). */
  score: number;
  /** How old the entry is, in whole months. */
  ageMonths: number;
  /** ISO date (YYYY-MM-DD) after which this entry is considered expired. */
  expiresAt: string;
  /** True when the entry has passed its TTL. */
  isExpired: boolean;
}

/**
 * Parse "YYYY-MM" into a Date representing the first day of that month.
 * Returns null if the string is missing or malformed.
 */
function parseAsOf(asOf: string | undefined): Date | null {
  if (!asOf) return null;
  const m = /^(\d{4})-(\d{2})$/.exec(asOf);
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1));
}

function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d;
}

function monthsDiff(from: Date, to: Date): number {
  return (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
}

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Compute a confidence score for a catalog entry based on its age, category
 * TTL, and provenance (sourceUrl presence).
 *
 * @param asOf      The entry's `asOf` field, e.g. "2026-05".
 * @param category  Program category — determines the TTL policy.
 * @param sourceUrl Entry's `sourceUrl`, if any; absence slightly reduces confidence.
 * @param now       Override for current date (used in tests).
 */
export function computeConfidence(
  asOf: string | undefined,
  category: ProgramCategory,
  sourceUrl: string | undefined,
  now?: Date,
): ConfidenceScore {
  const reference = now ?? new Date();
  const ttl = CATEGORY_TTL_MONTHS[category] ?? DEFAULT_TTL_MONTHS;
  const parsed = parseAsOf(asOf);

  const expiresAt = parsed ? toIsoDate(addMonths(parsed, ttl)) : toIsoDate(reference);
  const isExpired = reference >= new Date(expiresAt);

  if (!parsed) {
    // No asOf — treat as maximally stale.
    return { level: "stale", score: 0.1, ageMonths: Infinity, expiresAt, isExpired: true };
  }

  const ageMonths = Math.max(0, monthsDiff(parsed, reference));

  // Raw score: four bands keyed on multiples of TTL.
  // Band 1 (age < 0.5×TTL): 1.0 → 1.0  (high)
  // Band 2 (age < 1.0×TTL): 1.0 → 0.5  (medium)
  // Band 3 (age < 2.0×TTL): 0.5 → 0.1  (low)
  // Band 4 (age >= 2.0×TTL): 0.1        (stale)
  let raw: number;
  let level: ConfidenceLevel;

  if (ageMonths < ttl * 0.5) {
    raw = 1.0;
    level = "high";
  } else if (ageMonths < ttl) {
    const t = (ageMonths - ttl * 0.5) / (ttl * 0.5);
    raw = 1.0 - t * 0.5; // 1.0 → 0.5
    level = "medium";
  } else if (ageMonths < ttl * 2) {
    const t = (ageMonths - ttl) / ttl;
    raw = 0.5 - t * 0.4; // 0.5 → 0.1
    level = "low";
  } else {
    raw = 0.1;
    level = "stale";
  }

  // Provenance factor: missing sourceUrl reduces confidence slightly.
  const provenance = sourceUrl ? 1.0 : 0.9;
  const score = Math.round(raw * provenance * 100) / 100;

  return { level, score, ageMonths, expiresAt, isExpired };
}
