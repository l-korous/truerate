import { collectPerks, matchBenefits } from "./match.js";
import { BookingProvider } from "./providers/booking.js";
import type { HotelProvider } from "./providers/types.js";
import type {
  EnrichedProperty,
  EnrichmentResult,
  HotelSearchQuery,
  Membership,
  PageContext,
  PageMatchResult,
} from "./types.js";

// The enrichment engine layers the user's BENEFITS over provider results. For
// each property it builds a match target (the provider's domain + the
// property's brand/name + category "hotel"), finds which of the user's benefits
// apply, and produces:
//   - the matched benefits (discounts as % from the catalog)
//   - perks (free breakfast, upgrades, etc.)
// Per product rule #1 TrueRate never returns post-discount/member prices.
// The consumer (AI assistant or channel) applies any discount % to the public
// price they hold from the third-party provider.

export class EnrichmentEngine {
  private providers: HotelProvider[];

  constructor(providers?: HotelProvider[]) {
    this.providers = providers ?? [new BookingProvider()];
  }

  get mode(): "live" | "mock" {
    return this.providers.every((p) => p.isMock) ? "mock" : "live";
  }

  async enrich(query: HotelSearchQuery, memberships: Membership[]): Promise<EnrichmentResult> {
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

        const perks = collectPerks(matched.map((m) => m.benefit.value));

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
          matches: matched,
          perks,
        });
      }
    }

    // Lead with properties that have the most to offer: highest discount % first,
    // then those that at least carry perks.
    properties.sort((a, b) => {
      const aDiscount = bestDiscountPct(a.matches);
      const bDiscount = bestDiscountPct(b.matches);
      if (bDiscount !== aDiscount) return bDiscount - aDiscount;
      return b.perks.length - a.perks.length;
    });

    return {
      query,
      currency: query.currency ?? "EUR",
      properties,
      programsApplied: [...programs],
      generatedAt: new Date().toISOString(),
      mode: this.mode,
    };
  }

  /**
   * Match the user's benefits against a single page the extension is looking at
   * (a results page or a hotel detail page). No search is run; we use the
   * context the extension scraped (domain, optional property name/brand).
   */
  matchPage(context: PageContext, memberships: Membership[]): PageMatchResult {
    const matched = matchBenefits(memberships, {
      domain: context.domain,
      brand: context.property?.brand,
      propertyName: context.property?.name,
      category: "hotel",
    });

    return {
      domain: context.domain,
      matches: matched,
      perks: [...new Set(matched.flatMap((m) => m.benefit.value.perks ?? []))],
    };
  }
}

function bestDiscountPct(matches: ReturnType<typeof matchBenefits>): number {
  let best = 0;
  for (const m of matches) {
    if (m.benefit.value.kind === "percentDiscount" && m.benefit.value.percentOff) {
      best = Math.max(best, m.benefit.value.percentOff);
    }
  }
  return best;
}
