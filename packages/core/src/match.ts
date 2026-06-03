import type {
  Benefit,
  BenefitScope,
  BenefitValue,
  ConflictResolution,
  MatchTarget,
  MatchedBenefit,
  Membership,
  PerkType,
  Program,
  StackingBehavior,
  SuppressedBenefit,
} from "./types.js";
import { computeConfidence } from "./confidence.js";
import type { ConfidenceScore } from "./confidence.js";

// Pure matching logic: given the benefits a user holds and a target (a page or
// a search-result property), decide which benefits apply and what price/perks
// follow. No node or browser dependencies — safe to run anywhere and trivial
// to unit-test. This is the engine of the "no integration needed" thesis: the
// rule comes from the benefit, the public price comes from the page, and we
// combine them ourselves.

function norm(s: string): string {
  return s.toLowerCase().trim();
}

/** Does a single benefit apply to the target? */
export function benefitMatches(benefit: Benefit, target: MatchTarget): boolean {
  const m = benefit.match;

  // Domain match (most precise for "this exact hotel's own site").
  if (m.domains?.length && target.domain) {
    const d = norm(target.domain);
    if (m.domains.some((x) => d === norm(x) || d.endsWith("." + norm(x)))) return true;
  }
  // Specific property name.
  if (m.propertyNames?.length && target.propertyName) {
    const p = norm(target.propertyName);
    if (m.propertyNames.some((x) => p.includes(norm(x)) || norm(x).includes(p))) return true;
  }
  // Brand (e.g. any Marriott property).
  if (m.brands?.length && target.brand) {
    const b = norm(target.brand);
    if (m.brands.some((x) => b.includes(norm(x)) || norm(x).includes(b))) return true;
  }
  // Whole category (e.g. an OTA-wide discount on any hotel).
  if (m.categories?.length && target.category) {
    if (m.categories.includes(target.category)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Conflict / stacking resolution
// ---------------------------------------------------------------------------

/**
 * Scope precedence for conflict resolution.
 * More-specific scope wins over a broader one when benefits conflict.
 */
const SCOPE_PRECEDENCE: Record<BenefitScope, number> = {
  property: 5,
  domain:   4,
  brand:    3,
  category: 2,
  global:   1,
};

/**
 * Stacking behavior per PerkType.
 *
 * "take-best" — non-stackable. When two benefits provide the same perk type
 *   the one with the most specific scope (then most guaranteed delivery) wins
 *   and the other is suppressed. Appropriate for perks where receiving multiple
 *   instances is not additive (one room upgrade per stay; one breakfast; one
 *   checkout time).
 *
 * "stack" — all sources of this perk type are genuinely additive or represent
 *   distinct products (different lounge networks, point earn across multiple
 *   programs, separate F&B credits from separate sources).
 */
export const PERK_STACKING: Record<PerkType, StackingBehavior> = {
  early_check_in:          "take-best",
  late_check_out:          "take-best",
  free_breakfast:          "take-best",
  room_upgrade:            "take-best",
  suite_upgrade:           "take-best",
  welcome_amenity:         "take-best",
  airport_transfer:        "take-best",
  parking:                 "take-best",
  guaranteed_availability: "take-best",
  lounge_access:           "stack",
  free_wifi:               "stack",
  spa_credit:              "stack",
  points_bonus:            "stack",
  priority_support:        "stack",
  other:                   "stack",
};

/**
 * Determine which dimension of a benefit's match actually fired for the given
 * target, returning a stable string anchor used to group conflicting benefits.
 *
 * The anchor is prefixed with the dimension so that, e.g., a domain-level
 * discount and a brand-level discount targeting the same "hilton.com" and
 * "Hilton" brand respectively are NOT placed in the same conflict group —
 * they represent distinct booking products.
 */
function matchAnchor(benefit: Benefit, target: MatchTarget): string {
  const m = benefit.match;
  if (m.domains?.length && target.domain) {
    const d = norm(target.domain);
    if (m.domains.some((x) => d === norm(x) || d.endsWith("." + norm(x)))) {
      return `domain:${d}`;
    }
  }
  if (m.propertyNames?.length && target.propertyName) {
    const p = norm(target.propertyName);
    if (m.propertyNames.some((x) => p.includes(norm(x)) || norm(x).includes(p))) {
      return `property:${p}`;
    }
  }
  if (m.brands?.length && target.brand) {
    const b = norm(target.brand);
    const hit = m.brands.find((x) => b.includes(norm(x)) || norm(x).includes(b));
    if (hit) return `brand:${norm(hit)}`;
  }
  if (m.categories?.length && target.category) {
    if (m.categories.includes(target.category)) return `category:${target.category}`;
  }
  return "global";
}

/**
 * Returns the conflict group keys for a matched benefit.
 *
 * - Discount benefits (percentDiscount / fixedDiscount) compete per anchor:
 *   key = "discount:{anchor}". Two discounts targeting the same domain or
 *   brand anchor are in the same conflict group; take-best (highest value) wins.
 *
 * - Perk benefits compete per take-best PerkType:
 *   key = "perk:{perkType}". Stack-type perks emit no conflict key and are
 *   never suppressed.
 *
 * Benefits with no conflict keys are always included in the output.
 */
function conflictGroupKeys(mb: MatchedBenefit, target: MatchTarget): string[] {
  const b = mb.benefit;
  const keys: string[] = [];

  if (b.value.kind === "percentDiscount" || b.value.kind === "fixedDiscount") {
    keys.push(`discount:${matchAnchor(b, target)}`);
  }

  if (b.value.kind === "perk") {
    for (const sp of b.value.structuredPerks ?? []) {
      if (PERK_STACKING[sp.type] === "take-best") {
        keys.push(`perk:${sp.type}`);
      }
    }
  }

  return keys;
}

/**
 * A numeric "goodness" score for a benefit, used as a secondary sort after
 * scope precedence when selecting the winner in a conflict group.
 *
 * Higher = better for the user.
 * - percentDiscount: percentage value (0.20 > 0.15)
 * - fixedDiscount: absolute amount
 * - pointsEarn: earn rate
 * - perk: 1 if any structured perk is guaranteed (subjectToAvailability ≠ true),
 *         0 if all are space-available
 */
function valueScore(b: Benefit): number {
  if (b.value.kind === "percentDiscount") return b.value.percentOff ?? 0;
  if (b.value.kind === "fixedDiscount") return b.value.amountOff ?? 0;
  if (b.value.kind === "pointsEarn") return b.value.pointsPerUnit ?? 0;
  const sperks = b.value.structuredPerks ?? [];
  return sperks.some((sp) => sp.conditions?.subjectToAvailability !== true) ? 1 : 0;
}

/**
 * Total order for conflict-group winner selection.
 * Returns positive when a > b (a is better), negative when b > a.
 *
 * Primary: scope precedence (property > domain > brand > category > global).
 * Secondary: value score (higher benefit wins).
 * Tertiary: stable tie-breaking by membershipId then benefit.id (lexicographic).
 */
function compareBenefits(a: MatchedBenefit, b: MatchedBenefit): number {
  const scopeDiff = (SCOPE_PRECEDENCE[a.benefit.scope] ?? 0) - (SCOPE_PRECEDENCE[b.benefit.scope] ?? 0);
  if (scopeDiff !== 0) return scopeDiff;
  const valDiff = valueScore(a.benefit) - valueScore(b.benefit);
  if (valDiff !== 0) return valDiff;
  if (a.membershipId !== b.membershipId) return a.membershipId < b.membershipId ? -1 : 1;
  return a.benefit.id < b.benefit.id ? -1 : 1;
}

/**
 * Given a list of matched benefits and the target they were matched against,
 * resolve conflicts and return the coherent set that actually applies.
 *
 * Resolution algorithm:
 * 1. For each conflict group, find the winner (highest compareBenefits rank).
 * 2. A benefit is suppressed iff it participates in at least one conflict group,
 *    loses in every such group, AND contains no stack-type perks. A benefit with
 *    mixed perks (some take-best, some stack) is kept because the stack-type
 *    perks still provide unique value even after the take-best types are covered.
 * 3. Benefits with no conflict keys (all stack-type, pointsEarn, other) are
 *    always included.
 *
 * The result carries `applicable` (for channel output) and `suppressed` (for
 * diagnostics / "better alternative available" UI hints). No prices or amounts
 * are computed — resolution operates purely on scope and perk-term metadata.
 */
export function resolveConflicts(
  matches: MatchedBenefit[],
  target: MatchTarget,
): ConflictResolution {
  if (matches.length === 0) return { applicable: [], suppressed: [] };

  // Pass 1: determine the winner for each conflict group.
  const groupWinners = new Map<string, MatchedBenefit>();
  for (const mb of matches) {
    for (const key of conflictGroupKeys(mb, target)) {
      const current = groupWinners.get(key);
      if (!current || compareBenefits(mb, current) > 0) {
        groupWinners.set(key, mb);
      }
    }
  }

  // Pass 2: classify each benefit as applicable or suppressed.
  const applicable: MatchedBenefit[] = [];
  const suppressed: SuppressedBenefit[] = [];

  for (const mb of matches) {
    const groups = conflictGroupKeys(mb, target);

    if (groups.length === 0) {
      // No conflict groups (all-stack perks / pointsEarn / unknown kind) → always keep.
      applicable.push(mb);
      continue;
    }

    const lostGroups = groups.filter((key) => groupWinners.get(key) !== mb);

    if (lostGroups.length < groups.length) {
      // Wins at least one conflict group → keep.
      applicable.push(mb);
    } else {
      // Lost in every conflict group. But the benefit may still carry unique
      // value through stack-type perks that have no conflict key (e.g.
      // lounge_access alongside a room_upgrade that was superseded). In that
      // case, keep the benefit so the stackable perks appear in the output.
      const hasStackValue =
        mb.benefit.value.kind === "perk" &&
        (mb.benefit.value.structuredPerks ?? []).some(
          (sp) => PERK_STACKING[sp.type] === "stack",
        );

      if (hasStackValue) {
        applicable.push(mb);
      } else {
        // No unique remaining value → suppress.
        const supersededBy = groupWinners.get(lostGroups[0]!)!;
        suppressed.push({
          benefit: mb,
          supersededBy,
          conflictGroup: lostGroups.join(","),
        });
      }
    }
  }

  return { applicable, suppressed };
}

// ---------------------------------------------------------------------------
// matchBenefits
// ---------------------------------------------------------------------------

/** All benefits across a user's memberships that apply to the target. */
export function matchBenefits(
  memberships: Membership[],
  target: MatchTarget,
  options?: {
    /**
     * Map of programId → Program used to derive confidence scores.
     * When provided, each matched benefit receives a `confidence` field
     * derived from the program's `asOf`, `category`, and `sourceUrl`.
     * No price data is used.
     */
    programs?: Map<string, Program>;
    /** Override "now" for deterministic testing. */
    now?: Date;
    /**
     * When true, apply conflict/stacking rules and return only the coherent
     * applicable set (suppressed benefits are discarded).
     * When false or absent (default), all matched benefits are returned
     * without conflict resolution (existing behaviour, fully backward-compatible).
     *
     * For full transparency including suppressed benefits, call
     * resolveConflicts(matchBenefits(...), target) directly.
     */
    applyStackingRules?: boolean;
  },
): MatchedBenefit[] {
  const out: MatchedBenefit[] = [];
  for (const ms of memberships) {
    if (ms.status === "invalid") continue;
    for (const b of ms.benefits) {
      if (benefitMatches(b, target)) {
        let confidence: ConfidenceScore | undefined;
        if (options?.programs && b.programId) {
          const prog = options.programs.get(b.programId);
          if (prog) {
            confidence = computeConfidence(prog.asOf, prog.category, prog.sourceUrl, options.now);
          }
        }
        out.push({ benefit: b, membershipId: ms.id, membershipLabel: ms.label, confidence });
      }
    }
  }
  if (options?.applyStackingRules) {
    return resolveConflicts(out, target).applicable;
  }
  return out;
}

/** Collect perks (price-neutral benefits) from matched benefit values. */
export function collectPerks(values: BenefitValue[]): string[] {
  const perks = new Set<string>();
  for (const v of values) for (const p of v.perks ?? []) perks.add(p);
  return [...perks];
}

