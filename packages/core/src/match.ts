import type {
  Benefit,
  BenefitValue,
  MatchTarget,
  Membership,
  Program,
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
  },
): { benefit: Benefit; membershipId: string; membershipLabel: string; confidence?: ConfidenceScore }[] {
  const out: { benefit: Benefit; membershipId: string; membershipLabel: string; confidence?: ConfidenceScore }[] = [];
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
  return out;
}

/** Collect perks (price-neutral benefits) from matched benefit values. */
export function collectPerks(values: BenefitValue[]): string[] {
  const perks = new Set<string>();
  for (const v of values) for (const p of v.perks ?? []) perks.add(p);
  return [...perks];
}

