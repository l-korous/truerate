// Core domain model for TrueRate.
//
// THE CENTRAL PRIMITIVE IS A *BENEFIT* — a structured rule the user holds:
// "15% at Hotel PECR", "free breakfast at Marriott", "-10% Avis". A benefit
// carries everything needed to (a) recognise the relevant context on the web or
// in an assistant, and (b) state what the user gets. Crucially, the benefit's
// *rule* comes from the user (or TrueRate's curated catalog), NOT from a live
// provider API - so the product delivers value with zero integration. A
// `source` field lets a benefit later be replaced/verified with a live-fetched
// value, but that is optional, not required.
//
// The program catalog (programs.ts) is a curated library of benefit TEMPLATES:
// "what each membership program brings". The user selects the programs/tiers
// they have, and TrueRate instantiates the matching benefits into their profile.

export type ProgramCategory =
  | "hotel"
  | "airline"
  | "rail"
  | "carRental"
  | "ota"
  | "card"
  | "subscription";

/** What a benefit gives the user. */
export type BenefitKind = "percentDiscount" | "fixedDiscount" | "perk" | "pointsEarn";

export interface BenefitValue {
  kind: BenefitKind;
  /** percentDiscount: 0.15 == 15% off. */
  percentOff?: number;
  /** fixedDiscount: flat amount off, in `currency`. */
  amountOff?: number;
  currency?: string;
  /** perk: free-text perks, e.g. ["Free breakfast", "Late checkout"]. */
  perks?: string[];
  /** pointsEarn: points/miles per currency unit spent. */
  pointsPerUnit?: number;
  /** Conditions/caveats shown to the user, e.g. "direct booking only". */
  conditions?: string;
}

/** How a benefit is recognised against a page / search target. */
export interface BenefitMatch {
  /** Brand names, e.g. ["Marriott", "Marriott Bonvoy"]. */
  brands?: string[];
  /** Domains, e.g. ["pecr.cz", "booking.com"]. */
  domains?: string[];
  /** Specific property names, e.g. ["Hotel PECR"]. */
  propertyNames?: string[];
  /** Apply to a whole category (e.g. every "hotel"). */
  categories?: ProgramCategory[];
}

/** Benefit scope, mostly for display/precedence. */
export type BenefitScope = "property" | "brand" | "domain" | "category" | "global";

/** A benefit template (catalog) - no id/source yet; match may be inherited. */
export interface BenefitTemplate {
  scope: BenefitScope;
  /** If omitted, inherits the program's defaultMatch at instantiation. */
  match?: BenefitMatch;
  value: BenefitValue;
}

/** A concrete benefit the user holds. */
export interface Benefit extends BenefitTemplate {
  id: string;
  match: BenefitMatch; // always resolved for an instantiated benefit
  source: "catalog" | "user-declared" | "provider-live";
  /** Catalog program this came from, if any. */
  programId?: string;
  /** Set when confirmed/fetched live from the provider (future). */
  verifiedAt?: string;
}

// --- Program catalog (templates) --------------------------------------------

export interface ProgramField {
  key: string;
  label: string;
  type: "text" | "select" | "secret";
  options?: string[];
  placeholder?: string;
  secret?: boolean;
}

export interface Program {
  id: string;
  name: string;
  category: ProgramCategory;
  /** How this program's benefits are recognised on the web (shared default). */
  defaultMatch: BenefitMatch;
  tiers?: string[];
  fields: ProgramField[];
  requiresCredential: boolean;
  /**
   * Benefit templates keyed by tier name. Use the key "*" for programs without
   * tiers, or as a base applied to every tier in addition to tier-specific ones.
   */
  benefits: Record<string, BenefitTemplate[]>;
  // Provenance — loyalty terms change constantly. Record where each entry came
  // from and when, and which region it reflects, so the catalog can be audited
  // and refreshed (and eventually moved to an ops-editable store).
  sourceUrl?: string;
  asOf?: string; // e.g. "2026-05"
  region?: string; // e.g. "CZ", "Global", "US (varies by region)"
}

// --- User + memberships ------------------------------------------------------

/**
 * A membership groups the benefits the user holds from one source - either a
 * catalog program ("Marriott Bonvoy - Gold") or a custom declaration
 * ("Hotel PECR"). Benefits are embedded; they are not secret and are safe to
 * return to clients. Credentials (if any) remain separately encrypted.
 */
export interface Membership {
  id: string;
  label: string;
  programId?: string; // catalog link; absent for custom memberships
  tier?: string;
  attributes: Record<string, string>;
  encryptedCredential?: string;
  benefits: Benefit[];
  addedAt: string;
  verifiedAt?: string;
  status: "active" | "unverified" | "invalid";
}

export interface User {
  id: string;
  email: string;
  passwordHash: string;
  memberships: Membership[];
  createdAt: string;
  market: string;
  currency: string;
}

// --- Matching + enrichment I/O -----------------------------------------------

/** A target to match benefits against (a page, or a search result property). */
export interface MatchTarget {
  domain?: string;
  brand?: string;
  propertyName?: string;
  category?: ProgramCategory;
}

/** A benefit that matched a target, with the membership it came from. */
export interface MatchedBenefit {
  benefit: Benefit;
  membershipId: string;
  membershipLabel: string;
}

export interface HotelSearchQuery {
  location: string;
  checkIn: string;
  checkOut: string;
  adults: number;
  rooms: number;
  currency?: string;
  limit?: number;
}

export interface RateOffer {
  source: string; // "public" or a benefit/program id
  label: string;
  nightlyAmount: number;
  totalAmount: number;
  currency: string;
  perks?: string[];
  pointsEarned?: number;
  pointsValue?: number;
  /** True when the price is an estimate from a user-declared discount. */
  indicative?: boolean;
}

export interface EnrichedProperty {
  propertyId: string;
  name: string;
  brand?: string;
  area?: string;
  rating?: number;
  stars?: number;
  thumbnail?: string;
  publicOffer: RateOffer;
  memberOffers: RateOffer[];
  bestOffer: RateOffer;
  /** Perks that apply but carry no price change (e.g. free breakfast). */
  perks: string[];
  savingsAmount: number;
  savingsPercent: number;
  /** True when bestOffer is an indicative (estimated) price. */
  indicative: boolean;
}

export interface EnrichmentResult {
  query: HotelSearchQuery;
  currency: string;
  properties: EnrichedProperty[];
  totalSavings: number;
  programsApplied: string[];
  generatedAt: string;
  mode: "live" | "mock";
}

/** Context the extension sends for a single page (results or hotel detail). */
export interface PageContext {
  domain: string;
  property?: {
    name: string;
    brand?: string;
    /** Public price visible on the page, if any. */
    publicNightly?: number;
    publicTotal?: number;
    currency?: string;
  };
}

export interface PageMatchResult {
  domain: string;
  /** Benefits active on this page/property, with indicative pricing applied. */
  matches: MatchedBenefit[];
  /** Perks (no price change) applicable here. */
  perks: string[];
  /** If a public price was supplied and a discount applies, the estimate. */
  indicativeOffer?: RateOffer;
  publicOffer?: RateOffer;
}

// --- Client-side error reporting ---------------------------------------------

export type ClientErrorSource =
  | "web"
  | "extension-background"
  | "extension-content"
  | "extension-popup";

/**
 * Payload sent from browser clients (web, extension) to POST /client-errors.
 * Must never contain prices, secrets, tokens, or raw PII — the API scrubs
 * before logging, but senders should pre-scrub context as well.
 */
export interface ClientErrorReport {
  source: ClientErrorSource;
  message: string;
  stack?: string;
  /** Page URL or extension page identifier. */
  url?: string;
  /** Propagated correlation ID when available. */
  correlationId?: string;
  /** Arbitrary structured context; scrubbed server-side. */
  context?: Record<string, unknown>;
}
