import type { PerkType } from "./types.js";

// ---------------------------------------------------------------------------
// Perk-value estimation engine
//
// Maps each canonical PerkType × hotel star band (3★ / 4★ / 5★) to an
// estimated monetary value in USD. These are curated estimates of the
// *real-world replacement cost* of a perk, not prices or discounts.
//
// Invariants (enforced by tests):
//  - isEstimate: true is always present so callers cannot confuse this with a
//    real price.
//  - No currency calculation is applied here; channels do any currency
//    conversion they need.
//  - 0 means "no tangible monetary value" (e.g. guaranteed_availability);
//    the perk is still real but its value is intangible or context-dependent.
// ---------------------------------------------------------------------------

export type StarBand = 3 | 4 | 5;

export interface PerkEstimate {
  perkType: PerkType;
  starBand: StarBand;
  /** Estimated monetary value in USD. 0 = intangible / context-dependent. */
  estimatedUsd: number;
  /** Always true — this is explicitly NOT a price or a discount amount. */
  isEstimate: true;
  /** Always "default-estimate" — values come from the curated estimation table. */
  estimateProvenance: "default-estimate";
  /** Always "estimated" — these are heuristic values, not verified amounts. */
  estimateConfidence: "estimated";
}

/**
 * Estimation table: perk type × star band → approximate USD value.
 *
 * Values represent the realistic replacement-cost / market value of the perk
 * at that hotel tier (e.g. early check-in ≈ $20 at 3★, $40 at 4★, $60 at 5★).
 * Sources: published hotel fee schedules, industry surveys, and TrueRate
 * editorial judgment. Treat all figures as illustrative estimates.
 */
const PERK_VALUE_TABLE: Record<PerkType, Record<StarBand, number>> = {
  early_check_in:          { 3: 20,  4: 40,  5: 60  },
  late_check_out:          { 3: 20,  4: 40,  5: 60  },
  free_breakfast:          { 3: 15,  4: 25,  5: 50  },
  room_upgrade:            { 3: 30,  4: 60,  5: 120 },
  suite_upgrade:           { 3: 80,  4: 150, 5: 300 },
  lounge_access:           { 3: 0,   4: 30,  5: 60  },
  welcome_amenity:         { 3: 10,  4: 20,  5: 40  },
  free_wifi:               { 3: 5,   4: 10,  5: 15  },
  airport_transfer:        { 3: 20,  4: 40,  5: 80  },
  parking:                 { 3: 10,  4: 20,  5: 40  },
  spa_credit:              { 3: 20,  4: 50,  5: 100 },
  guaranteed_availability: { 3: 0,   4: 0,   5: 0   },
  points_bonus:            { 3: 5,   4: 10,  5: 20  },
  priority_support:        { 3: 0,   4: 0,   5: 0   },
  other:                   { 3: 10,  4: 20,  5: 40  },
};

/**
 * Returns an estimate for a single perk at a given star band.
 * Always returns an object with `isEstimate: true`.
 */
export function estimatePerkValue(perkType: PerkType, starBand: StarBand): PerkEstimate {
  const row = PERK_VALUE_TABLE[perkType];
  const estimatedUsd = row ? (row[starBand] ?? 0) : 0;
  return { perkType, starBand, estimatedUsd, isEstimate: true, estimateProvenance: "default-estimate", estimateConfidence: "estimated" };
}

/**
 * Returns estimates for all three star bands for a single perk type.
 * Useful for channels that display a per-band breakdown (e.g. web perk inventory).
 */
export function estimatePerkValueAllBands(
  perkType: PerkType,
): { 3: PerkEstimate; 4: PerkEstimate; 5: PerkEstimate } {
  return {
    3: estimatePerkValue(perkType, 3),
    4: estimatePerkValue(perkType, 4),
    5: estimatePerkValue(perkType, 5),
  };
}

/**
 * Returns true when a perk type has a non-zero estimated value in at least one
 * star band. Useful for filtering out intangible perks in UI contexts.
 */
export function perkHasMonetaryEstimate(perkType: PerkType): boolean {
  const row = PERK_VALUE_TABLE[perkType];
  return row ? Object.values(row).some((v) => v > 0) : false;
}
