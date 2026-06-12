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
// Provenance + confidence labeling
// ---------------------------------------------------------------------------

/**
 * Where a specific perk term, condition, or value estimate originated.
 *
 * - "catalog"          — from TrueRate's curated program catalog
 * - "user-declared"    — the user manually declared they hold this perk
 * - "default-estimate" — derived from the curated estimation table (values only)
 */
export type TermProvenance = "catalog" | "user-declared" | "default-estimate";

/**
 * How trustworthy a specific perk term, condition, or value estimate is.
 *
 * - "verified"  — confirmed from an authoritative source (catalog with sourceUrl
 *                 and recent asOf, or live provider data)
 * - "declared"  — stated by the user, or from the catalog without explicit live
 *                 verification
 * - "estimated" — derived from heuristic / estimation table; not sourced from
 *                 program terms
 */
export type TermConfidence = "verified" | "declared" | "estimated";

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
  /** Where this perk term originated in TrueRate's data pipeline. */
  provenance?: TermProvenance;
  /** How trustworthy this perk term is. */
  confidence?: TermConfidence;
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
  /**
   * Direct-booking ("realization") URL where this benefit is actually redeemed
   * — e.g. the hotel's own booking page. Channels surface it as
   * "members save X% — book direct at <URL>". This is NOT a price; the
   * consumer/AI does any math. Distinct from Program.sourceUrl (provenance).
   */
  realizationUrl?: string;
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
  /**
   * Default direct-booking ("realization") URL for this program's benefits —
   * where a guest books to actually get the discount/perks. Per-benefit
   * BenefitValue.realizationUrl overrides it. Never a price.
   */
  realizationUrl?: string;
  /**
   * Whether this membership/program is OPEN TO ANYONE — i.e. a guest can simply
   * register (free, no status or invite) and immediately get the discount/perks.
   * When true, channels may tell a NON-enrolled guest "register at <realizationUrl>
   * and save X% booking direct". Paid cards/subscriptions or invite-only programs
   * are false. (X% is a discount, not a price — the consumer does any math.)
   */
  openToAnyone?: boolean;
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

/**
 * Current document schema version for User documents stored in Cosmos.
 *
 * Version history:
 *   undefined / 0 — original shape (no schemaVersion field)
 *   1             — schemaVersion field added; all new docs written at v1
 *
 * When reading a document, always pass it through normalizeUser() from db.ts
 * so that callers work against the current shape regardless of the stored version.
 * See docs/SCHEMA-MIGRATION.md for the expand/migrate/contract policy.
 */
export const USER_SCHEMA_VERSION = 1;

export interface User {
  id: string;
  email: string;
  passwordHash: string;
  memberships: Membership[];
  createdAt: string;
  market: string;
  currency: string;
  /**
   * Document schema version. Absent on documents written before versioning was
   * introduced (treat as version 0). Always written as USER_SCHEMA_VERSION on
   * new documents. See docs/SCHEMA-MIGRATION.md.
   */
  schemaVersion?: number;
  /** Onboarding funnel milestones; absent on legacy documents (treat as all unset). */
  activationMilestones?: ActivationMilestones;
  /** Active per-user MCP URL token, hashed. Absent until the user mints one (#82). */
  mcpToken?: McpTokenRecord;
}

// ---------------------------------------------------------------------------
// Conflict / stacking model
// ---------------------------------------------------------------------------

/**
 * How multiple matched benefits of the same conflict group interact when more
 * than one applies to the same target.
 *
 * - "take-best"  Non-stackable. The benefit with the highest scope precedence
 *                (property > domain > brand > category > global), then highest
 *                value, is kept. The rest in the group are suppressed.
 * - "stack"      All matched benefits in the group apply independently; none
 *                are suppressed.
 */
export type StackingBehavior = "take-best" | "stack";

/**
 * A benefit suppressed during conflict resolution because a higher-precedence
 * benefit of the same conflict group already covers it.
 */
export interface SuppressedBenefit {
  /** The matched benefit that was suppressed. */
  benefit: MatchedBenefit;
  /** The benefit that won the conflict group and superseded this one. */
  supersededBy: MatchedBenefit;
  /**
   * The conflict group key that triggered suppression, for diagnostics.
   * Examples: "discount:domain:booking.com", "perk:room_upgrade".
   */
  conflictGroup: string;
}

/**
 * The output of conflict/stacking resolution: a coherent set of applicable
 * benefits with no contradictory combinations, plus transparency about what
 * was suppressed and why.
 *
 * Use `applicable` for the final output to channels (MCP, extension).
 * Use `suppressed` for diagnostics and UI (e.g. "better benefit from X applies").
 */
export interface ConflictResolution {
  /** Benefits that apply after conflict/stacking resolution. */
  applicable: MatchedBenefit[];
  /**
   * Benefits suppressed because every conflict group they participate in is
   * already covered by a higher-precedence benefit.
   */
  suppressed: SuppressedBenefit[];
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
  /** Where the perk term itself originated. Derived from the benefit source. */
  termProvenance: TermProvenance;
  /** Trustworthiness of the perk term. */
  termConfidence: TermConfidence;
  /** Always "default-estimate" — monetary values come from the estimation table. */
  estimateProvenance: "default-estimate";
  /** Always "estimated" — these are heuristic values, not verified amounts. */
  estimateConfidence: "estimated";
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
 * `{programId}-v{version}` — globally unique within the container; allows
 * point reads when the version number is already known. ("#" is illegal in a
 * Cosmos document id, so the separator is "-v".)
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
  /** Cosmos document id: "{programId}-v{version}" ("#" is illegal in a Cosmos id). */
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

  /**
   * Default direct-booking ("realization") URL for this program — where a guest
   * books to actually get the discount/perks. Channels surface it as
   * "members save X% — book direct at <URL>". Never a price.
   */
  realizationUrl?: string;

  /**
   * Whether this program is open to anyone — a guest can simply register
   * (free, no status) and immediately get the discount/perks.
   */
  openToAnyone?: boolean;

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
