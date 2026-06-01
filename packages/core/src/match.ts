import type {
  Benefit,
  BenefitValue,
  MatchTarget,
  Membership,
} from "./types.js";

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
): { benefit: Benefit; membershipId: string; membershipLabel: string }[] {
  const out: { benefit: Benefit; membershipId: string; membershipLabel: string }[] = [];
  for (const ms of memberships) {
    if (ms.status === "invalid") continue;
    for (const b of ms.benefits) {
      if (benefitMatches(b, target)) {
        out.push({ benefit: b, membershipId: ms.id, membershipLabel: ms.label });
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

