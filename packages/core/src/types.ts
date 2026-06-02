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

// ---------------------------------------------------------------------------
// Perk taxonomy
// ---------------------------------------------------------------------------

/**
 * Canonical, stable identifiers for perk kinds.
 *
 * New identifiers must be added here (not invented on the fly) so that the
 * catalog, UI, and MCP surface speak the same language. Use "other" only
 * when a perk genuinely falls outside every existing category.
 *
 * No prices, amounts, or currency — those live in BenefitValue.
 */
export type PerkType =
  | "early_check_in"       // Priority / complimentary early check-in
  | "late_check_out"       // Priority / guaranteed late check-out
  | "free_breakfast"       // Complimentary breakfast (daily or per stay)
  | "room_upgrade"         // Room category upgrade (space-available or guaranteed)
  | "suite_upgrade"        // Suite upgrade (space-available or guaranteed)
  | "lounge_access"        // Executive lounge / club lounge access
  | "welcome_amenity"      // Welcome gift / amenity on arrival
  | "free_wifi"            // Complimentary Wi-Fi
  | "airport_transfer"     // Complimentary or discounted airport transfer
  | "parking"              // Complimentary or discounted on-site parking
  | "spa_credit"           // Spa / F&B / on-property credit
  | "guaranteed_availability" // Guaranteed room availability (even on sold-out nights)
  | "points_bonus"         // Bonus points / miles multiplier
  | "priority_support"     // Dedicated or priority customer service
  | "other";               // Catch-all for perks outside this taxonomy

// ---------------------------------------------------------------------------
// Conditions model
// ---------------------------------------------------------------------------

/**
 * Booking channel via which the perk or benefit is redeemable.
 */
export type BookingChannel = "direct" | "ota" | "phone" | "agent";

/**
 * Structured conditions that qualify when a perk or discount applies.
 *
 * All fields are optional — include only the constraints that apply.
 * Omitted fields mean "no restriction on that dimension".
 *
 * No prices or currency here; see BenefitValue for discount amounts.
 */
export interface PerkConditions {
  /** Minimum tier name required within the program, e.g. "Gold". */
  tierRequired?: string;
  /** Minimum length of stay (nights) for the perk to apply. */
  minNights?: number;
  /** Restricted to specific booking channels. */
  bookingChannel?: BookingChannel[];
  /**
   * ISO-8601 date strings (YYYY-MM-DD) or date ranges ("YYYY-MM-DD/YYYY-MM-DD")
   * during which the perk does NOT apply.
   */
  blackoutDates?: string[];
  /**
   * True when the perk is offered on a space-available / capacity basis
   * (i.e. not guaranteed). Distinct from a hard eligibility condition.
   */
  subjectToAvailability?: boolean;
  /** True when explicit program enrolment or registration is required. */
  enrollmentRequired?: boolean;
  /** Free-text note for conditions that cannot be expressed structurally. */
  notes?: string;
}

/**
 * A single perk expressed in the canonical taxonomy, with optional
 * structured conditions.
 *
 * This is the structured counterpart to the free-text strings in
 * BenefitValue.perks. Both coexist during migration; new catalog entries
 * should prefer StructuredPerk.
 */
export interface StructuredPerk {
  /** Canonical perk identifier from the taxonomy. */
  type: PerkType;
  /** Short human-readable label, e.g. "Free breakfast daily". */
  label: string;
  /** Structured conditions qualifying when the perk applies. */
  conditions?: PerkConditions;
}

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
  /**
   * Structured perks expressed via the canonical perk taxonomy.
   * Preferred for new catalog entries; coexists with free-text `perks`
   * during migration.
   */
  structuredPerks?: StructuredPerk[];
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

// ---------------------------------------------------------------------------
// Activation tracking
// ---------------------------------------------------------------------------

/**
 * Canonical onboarding funnel steps. Never contains prices or PII beyond
 * the user ID (stored on the User document, not in a separate collection).
 */
export type ActivationEventName =
  | "signup"
  | "membership_added"
  | "mcp_url_obtained"
  | "extension_connected";

/**
 * Per-user record of when each activation milestone was first reached.
 * All values are ISO-8601 timestamps set once and never overwritten.
 */
export interface ActivationMilestones {
  signup?: string;
  membership_added?: string;
  mcp_url_obtained?: string;
  extension_connected?: string;
}

/**
 * A user's active per-user MCP URL token, stored hashed (issue #82).
 * Only the SHA-256 hash is persisted — the raw token is shown once at issue
 * time and never stored, so a database read can't reconstruct a working URL.
 */
export interface McpTokenRecord {
  /** SHA-256 (hex) of the opaque token. */
  hash: string;
  /** ISO-8601 timestamp the current token was issued. */
  createdAt: string;
  /** ISO-8601 timestamp the token was last used to authenticate an MCP request. */
  lastUsedAt?: string;
}

export interface User {
  id: string;
  email: string;
  passwordHash: string;
  memberships: Membership[];
  createdAt: string;
  market: string;
  currency: string;
  /** Onboarding funnel milestones; absent on legacy documents (treat as all unset). */
  activationMilestones?: ActivationMilestones;
  /** Active per-user MCP URL token, hashed. Absent until the user mints one (#82). */
  mcpToken?: McpTokenRecord;
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
  /**
   * Staleness/trustworthiness signal for the catalog entry this benefit came
   * from. Present only when a programs map is supplied to matchBenefits().
   * Never derived from or related to any price.
   */
  confidence?: import("./confidence.js").ConfidenceScore;
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
}

export interface EnrichedProperty {
  propertyId: string;
  name: string;
  brand?: string;
  area?: string;
  rating?: number;
  stars?: number;
  thumbnail?: string;
  /** Raw public rate from the third-party provider (passed through, not computed). */
  publicOffer: RateOffer;
  /** Benefits from the user's memberships that apply to this property. */
  matches: MatchedBenefit[];
  /** Perks (no price change) that apply, e.g. "Free breakfast". */
  perks: string[];
}

export interface EnrichmentResult {
  query: HotelSearchQuery;
  currency: string;
  properties: EnrichedProperty[];
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
  };
}

/**
 * An estimated monetary value for a structured perk matched on a page.
 *
 * Values are illustrative estimates at each hotel star band — they are
 * explicitly NOT prices or discounts (isEstimate: true always).
 */
export interface MatchedPerkEstimate {
  perkType: PerkType;
  /** Human-readable perk label from the catalog. */
  label: string;
  /** Estimated USD replacement-cost value at 3★ / 4★ / 5★ hotel bands. */
  estimatedUsd: { 3: number; 4: number; 5: number };
  /** Which membership this perk comes from. */
  membershipLabel: string;
  /** Structured conditions qualifying when the perk applies. */
  conditions?: PerkConditions;
  /** Always true — this is NOT a price or a discount amount. */
  isEstimate: true;
}

export interface PageMatchResult {
  domain: string;
  /** Benefits from the user's memberships that apply to this page/property. */
  matches: MatchedBenefit[];
  /** Perks (no price change) applicable here. */
  perks: string[];
  /**
   * Estimated monetary value for each structured perk matched on this page,
   * across the 3★ / 4★ / 5★ hotel star bands.
   * All estimates are labeled isEstimate: true and must never be presented
   * as a price or subtracted from any price the user sees.
   */
  perkEstimates: MatchedPerkEstimate[];
}

// --- Catalog schema ----------------------------------------------------------

/**
 * Lifecycle status for a catalog entry version.
 *
 * Allowed transitions:
 *   draft → in-review → published → archived
 *   draft → archived (rejected drafts)
 */
export type CatalogStatus = "draft" | "in-review" | "published" | "archived";

/** How a catalog entry version was created or proposed. */
export type CatalogProvenanceSource =
  | "manual-seed"          // seeded from the static programs.ts catalog
  | "scrape-proposal"      // proposed by the scraping job
  | "partner-submission";  // submitted directly by the program operator

/**
 * Provenance metadata for one version of a catalog entry.
 *
 * Mirrors the `sourceUrl` / `asOf` / `region` fields already present on
 * Program but adds structured tracking for how the record was created.
 */
export interface CatalogProvenance {
  source: CatalogProvenanceSource;
  /** URL where the benefits were researched (mirrors Program.sourceUrl). */
  sourceUrl?: string;
  /**
   * "YYYY-MM" string indicating when the benefits were last verified.
   * Mirrors Program.asOf.
   */
  asOf: string;
  /** ISO-8601 timestamp if the record was produced by the scraper. */
  scrapedAt?: string;
  /** Identity (user id or service name) that created this version. */
  submittedBy?: string;
  /** Free-text summary of what changed in this version. */
  notes?: string;
}

/**
 * One versioned snapshot of a loyalty-program catalog entry, stored as a
 * Cosmos NoSQL document in the `catalog` container.
 *
 * ## Partition strategy
 * Partition key: `/programId`
 * All versions of the same program are co-located on a single logical
 * partition, so listing history and finding the current entry never require
 * cross-partition fan-out.
 *
 * ## Document id
 * `{programId}#v{version}` — globally unique within the container; allows
 * point reads when the version number is already known.
 *
 * ## Versioning invariant
 * Exactly ONE document per `programId` may have `isCurrent = true` at any
 * moment.  A `published` entry with `isCurrent = true` is the live catalog
 * record consumed by channels (MCP, extension, web).  Drafts always have
 * `isCurrent = false`.
 *
 * ## No-price invariant (see issue #1)
 * The `benefits` field mirrors `Program.benefits` — it may contain
 * `percentDiscount` and `fixedDiscount` BenefitValues (indicative terms from
 * published program pages), but MUST NOT contain hotel prices, nightly rates,
 * or any amount computed from a property's room price.
 */
export interface CatalogEntryDoc {
  /** Cosmos document id: "{programId}#v{version}". */
  id: string;
  /** Partition key. Matches Program.id for seed entries. */
  programId: string;
  /** Monotonically increasing version counter within a programId. Starts at 1. */
  version: number;
  /**
   * True for the single active entry that consumers should read.
   * Only a `published` entry may be current; exactly one per programId.
   */
  isCurrent: boolean;
  /** Lifecycle status of this version. */
  status: CatalogStatus;

  // ── Provenance ─────────────────────────────────────────────────────────────
  provenance: CatalogProvenance;

  // ── Region ─────────────────────────────────────────────────────────────────
  /**
   * Region this entry applies to.
   * "Global" = no regional restriction.
   * ISO 3166-1 alpha-2 for country-specific entries, e.g. "CZ".
   */
  region: string;

  // ── Program content (mirrors the Program type) ─────────────────────────────
  /** Human-readable program name. */
  name: string;
  /** Program category. */
  category: ProgramCategory;
  /** Default matching rules inherited by all benefits of this program. */
  defaultMatch: BenefitMatch;
  /** Tier names in ascending order. Absent for flat / single-tier programs. */
  tiers?: string[];
  /** Whether a stored credential (API key, membership login) is expected. */
  requiresCredential: boolean;
  /** User-facing form fields (tier selector, optional membership number, …). */
  fields: ProgramField[];
  /**
   * Benefit templates keyed by tier name.
   * Use "*" as base / catch-all tier.
   * Values must not include hotel prices — only % discounts, perk labels,
   * and point-earn rates from the published program terms.
   */
  benefits: Record<string, BenefitTemplate[]>;

  // ── Lifecycle timestamps ───────────────────────────────────────────────────
  createdAt: string;   // ISO-8601
  updatedAt: string;   // ISO-8601
  publishedAt?: string;
  archivedAt?: string;
}

/**
 * Input shape for creating or updating a catalog entry draft.
 * The repo assigns id, version, isCurrent, status, and timestamps.
 */
export type CatalogEntryInput = Omit<
  CatalogEntryDoc,
  "id" | "version" | "isCurrent" | "status" | "createdAt" | "updatedAt" | "publishedAt" | "archivedAt"
>;

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
