import type { HotelSearchQuery, RateOffer } from "../types.js";

// A HotelProvider returns properties with their PUBLIC rate (the price anyone
// sees, no login). Member value is computed by the enrichment engine from the
// user's benefits matched against each property's brand/domain - the provider
// itself never needs to know the user's memberships. This is what lets the
// product work with no provider integration.

export interface ProviderProperty {
  providerId: string;
  externalId: string;
  name: string;
  /** Brand/chain, used to match brand-scoped benefits (e.g. Marriott). */
  brand?: string;
  area?: string;
  rating?: number;
  stars?: number;
  thumbnail?: string;
  publicOffer: RateOffer;
}

export interface HotelProvider {
  readonly id: string;
  /** The domain searches run against, used for domain-scoped benefits. */
  readonly domain: string;
  search(query: HotelSearchQuery): Promise<ProviderProperty[]>;
  readonly isMock: boolean;
}
