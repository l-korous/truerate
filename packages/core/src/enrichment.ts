import { applyBenefitsToPrice, matchBenefits } from "./match.js";
import { BookingProvider } from "./providers/booking.js";
import type { HotelProvider } from "./providers/types.js";
import type {
  EnrichedProperty,
  EnrichmentResult,
  HotelSearchQuery,
  Membership,
  PageContext,
  PageMatchResult,
  RateOffer,
} from "./types.js";

// The enrichment engine layers the user's BENEFITS over public rates. For each
// property it builds a match target (the provider's domain + the property's
// brand/name + category "hotel"), finds which of the user's benefits apply, and
// produces:
//   - an indicative member price when a % or fixed discount applies, and/or
//   - perks (free breakfast, upgrades) that apply with no price change.
// This is the whole "no integration needed" model: rule from the benefit,
// public price from the provider, combined here. Discounts are flagged
// `indicative` because a user-declared rule is an estimate until verified live.

export class EnrichmentEngine {
  private providers: HotelProvider[];

  constructor(providers?: HotelProvider[]) {
    this.providers = providers ?? [new BookingProvider()];
  }

  get mode(): "live" | "mock" {
    return this.providers.every((p) => p.isMock) ? "mock" : "live";
  }

  async enrich(query: HotelSearchQuery, memberships: Membership[]): Promise<EnrichmentResult> {
    const currency = query.currency ?? "EUR";
    const nights = nightsBetween(query.checkIn, query.checkOut);

    const perProvider = await Promise.all(
      this.providers.map((provider) =>
        provider
          .search(query)
          .then((props) => ({ provider, props }))
          .catch((err) => {
            console.error(`[enrich] provider ${provider.id} failed:`, err);
            return { provider, props: [] as Awaited<ReturnType<typeof provider.search>> };
          }),
      ),
    );

    const properties: EnrichedProperty[] = [];
    const programs = new Set<string>();

    for (const { provider, props } of perProvider) {
      for (const p of props) {
        const matched = matchBenefits(memberships, {
          domain: provider.domain,
          brand: p.brand,
          propertyName: p.name,
          category: "hotel",
        });

        const { memberOffer, perks } = applyBenefitsToPrice(
          matched.map((m) => ({ benefit: m.benefit, membershipLabel: m.membershipLabel })),
          p.publicOffer.nightlyAmount,
          nights,
          currency,
        );

        const memberOffers = memberOffer ? [memberOffer] : [];
        const best = memberOffer ?? p.publicOffer;
        const savings = round2(p.publicOffer.totalAmount - best.totalAmount);
        const pct =
          p.publicOffer.totalAmount > 0
            ? Math.round((savings / p.publicOffer.totalAmount) * 1000) / 10
            : 0;

        for (const m of matched) programs.add(m.benefit.programId ?? m.benefit.id);

        properties.push({
          propertyId: p.externalId,
          name: p.name,
          brand: p.brand,
          area: p.area,
          rating: p.rating,
          stars: p.stars,
          thumbnail: p.thumbnail,
          publicOffer: p.publicOffer,
          memberOffers,
          bestOffer: best,
          perks,
          savingsAmount: Math.max(0, savings),
          savingsPercent: Math.max(0, pct),
          indicative: Boolean(memberOffer?.indicative),
        });
      }
    }

    // Lead with the rows that have the most to offer: cash savings first, then
    // properties that at least carry perks.
    properties.sort((a, b) => {
      if (b.savingsAmount !== a.savingsAmount) return b.savingsAmount - a.savingsAmount;
      return b.perks.length - a.perks.length;
    });

    const totalSavings = round2(properties.reduce((s, p) => s + p.savingsAmount, 0));

    return {
      query,
      currency,
      properties,
      totalSavings,
      programsApplied: [...programs],
      generatedAt: new Date().toISOString(),
      mode: this.mode,
    };
  }

  /**
   * Match the user's benefits against a single page the extension is looking at
   * (a results page or a hotel detail page). No search is run; we use the
   * context the extension scraped (domain, optional property + public price).
   */
  matchPage(context: PageContext, memberships: Membership[]): PageMatchResult {
    const matched = matchBenefits(memberships, {
      domain: context.domain,
      brand: context.property?.brand,
      propertyName: context.property?.name,
      category: "hotel",
    });

    const result: PageMatchResult = {
      domain: context.domain,
      matches: matched,
      perks: [...new Set(matched.flatMap((m) => m.benefit.value.perks ?? []))],
    };

    const prop = context.property;
    if (prop?.publicNightly && prop.publicNightly > 0) {
      const currency = prop.currency ?? "EUR";
      const nights = prop.publicTotal ? Math.max(1, Math.round(prop.publicTotal / prop.publicNightly)) : 1;
      const publicOffer: RateOffer = {
        source: "public",
        label: "Public rate",
        nightlyAmount: prop.publicNightly,
        totalAmount: prop.publicTotal ?? prop.publicNightly,
        currency,
      };
      const { memberOffer } = applyBenefitsToPrice(
        matched.map((m) => ({ benefit: m.benefit, membershipLabel: m.membershipLabel })),
        prop.publicNightly,
        nights,
        currency,
      );
      result.publicOffer = publicOffer;
      if (memberOffer) result.indicativeOffer = memberOffer;
    }

    return result;
  }
}

function nightsBetween(checkIn: string, checkOut: string): number {
  const n = Math.round((new Date(checkOut).getTime() - new Date(checkIn).getTime()) / 86_400_000);
  return Math.max(1, n);
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
