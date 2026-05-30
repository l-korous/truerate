import type {
  Benefit,
  BenefitValue,
  MatchTarget,
  Membership,
  RateOffer,
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

/** The best price-reducing discount among matched benefits (% or fixed). */
export function bestDiscount(
  values: BenefitValue[],
  publicNightly: number,
): { nightly: number; pct: number; label: BenefitValue | null } {
  let best = publicNightly;
  let winner: BenefitValue | null = null;
  for (const v of values) {
    let candidate = publicNightly;
    if (v.kind === "percentDiscount" && v.percentOff) {
      candidate = publicNightly * (1 - v.percentOff);
    } else if (v.kind === "fixedDiscount" && v.amountOff) {
      candidate = Math.max(0, publicNightly - v.amountOff);
    } else {
      continue;
    }
    if (candidate < best) {
      best = candidate;
      winner = v;
    }
  }
  const pct = publicNightly > 0 ? Math.round(((publicNightly - best) / publicNightly) * 1000) / 10 : 0;
  return { nightly: round2(best), pct, label: winner };
}

/** Collect perks (price-neutral benefits) from matched benefit values. */
export function collectPerks(values: BenefitValue[]): string[] {
  const perks = new Set<string>();
  for (const v of values) for (const p of v.perks ?? []) perks.add(p);
  return [...perks];
}

/**
 * Apply matched benefits to a public nightly/total price, producing an
 * indicative member offer when a discount applies. Perks attach to the offer.
 */
export function applyBenefitsToPrice(
  matched: { benefit: Benefit; membershipLabel: string }[],
  publicNightly: number,
  nights: number,
  currency: string,
): { memberOffer: RateOffer | null; perks: string[] } {
  const values = matched.map((m) => m.benefit.value);
  const perks = collectPerks(values);
  const disc = bestDiscount(values, publicNightly);

  if (!disc.label) {
    return { memberOffer: null, perks };
  }
  // Find which membership produced the winning discount for the label.
  const winner = matched.find((m) => m.benefit.value === disc.label);
  return {
    memberOffer: {
      source: winner?.benefit.programId ?? winner?.benefit.id ?? "benefit",
      label: winner ? winner.membershipLabel : "Member rate",
      nightlyAmount: disc.nightly,
      totalAmount: round2(disc.nightly * nights),
      currency,
      perks,
      indicative: true, // declared discounts are estimates until verified live
    },
    perks,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
