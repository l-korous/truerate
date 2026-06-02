import { z } from "zod";

// --- Building blocks ---------------------------------------------------------

export const BenefitKindSchema = z.enum(["percentDiscount", "fixedDiscount", "perk", "pointsEarn"]);

export const PerkTypeSchema = z.enum([
  "early_check_in", "late_check_out", "free_breakfast", "room_upgrade",
  "suite_upgrade", "lounge_access", "welcome_amenity", "free_wifi",
  "airport_transfer", "parking", "spa_credit", "guaranteed_availability",
  "points_bonus", "priority_support", "other",
]);

export const BookingChannelSchema = z.enum(["direct", "ota", "phone", "agent"]);

export const PerkConditionsSchema = z.object({
  tierRequired: z.string().optional(),
  minNights: z.number().int().min(1).optional(),
  bookingChannel: z.array(BookingChannelSchema).optional(),
  blackoutDates: z.array(z.string()).optional(),
  subjectToAvailability: z.boolean().optional(),
  enrollmentRequired: z.boolean().optional(),
  notes: z.string().optional(),
});

export const TermProvenanceSchema = z.enum(["catalog", "user-declared", "default-estimate"]);
export const TermConfidenceSchema = z.enum(["verified", "declared", "estimated"]);

export const StructuredPerkSchema = z.object({
  type: PerkTypeSchema,
  label: z.string().min(1),
  conditions: PerkConditionsSchema.optional(),
  provenance: TermProvenanceSchema.optional(),
  confidence: TermConfidenceSchema.optional(),
});

export const BenefitValueSchema = z.object({
  kind: BenefitKindSchema,
  percentOff: z.number().min(0).max(1).optional(),
  amountOff: z.number().min(0).optional(),
  currency: z.string().optional(),
  perks: z.array(z.string()).optional(),
  structuredPerks: z.array(StructuredPerkSchema).optional(),
  pointsPerUnit: z.number().min(0).optional(),
  conditions: z.string().optional(),
});

export const ProgramCategorySchema = z.enum([
  "hotel", "airline", "rail", "carRental", "ota", "card", "subscription",
]);

export const BenefitMatchSchema = z.object({
  brands: z.array(z.string()).optional(),
  domains: z.array(z.string()).optional(),
  propertyNames: z.array(z.string()).optional(),
  categories: z.array(ProgramCategorySchema).optional(),
});

export const BenefitScopeSchema = z.enum(["property", "brand", "domain", "category", "global"]);

export const BenefitInputSchema = z.object({
  scope: BenefitScopeSchema,
  match: BenefitMatchSchema.optional(),
  value: BenefitValueSchema,
});

// --- Shared query / context schemas ------------------------------------------

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const HotelSearchQuerySchema = z.object({
  location: z.string().min(1, "location is required"),
  checkIn: z.string().regex(ISO_DATE, "checkIn must be ISO date (YYYY-MM-DD)"),
  checkOut: z.string().regex(ISO_DATE, "checkOut must be ISO date (YYYY-MM-DD)"),
  adults: z.number().int().min(1).optional(),
  rooms: z.number().int().min(1).optional(),
  currency: z.string().optional(),
  limit: z.number().int().min(1).max(20).optional(),
});

export const PageContextSchema = z.object({
  domain: z.string().min(1, "domain is required"),
  property: z
    .object({
      name: z.string(),
      brand: z.string().optional(),
    })
    .optional(),
});

export const ClientErrorSourceSchema = z.enum([
  "web",
  "extension-background",
  "extension-content",
  "extension-popup",
]);

export const ClientErrorReportSchema = z.object({
  source: ClientErrorSourceSchema,
  message: z.string().min(1),
  stack: z.string().optional(),
  url: z.string().optional(),
  correlationId: z.string().optional(),
  context: z.record(z.unknown()).optional(),
});

// --- Catalog editor schemas ---------------------------------------------------

export const ProgramFieldSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  type: z.enum(["text", "select", "secret"]),
  options: z.array(z.string()).optional(),
  placeholder: z.string().optional(),
  secret: z.boolean().optional(),
});

export const BenefitTemplateSchema = z.object({
  scope: BenefitScopeSchema,
  match: BenefitMatchSchema.optional(),
  value: BenefitValueSchema,
});

const ISO_YEAR_MONTH = /^\d{4}-\d{2}$/;

export const CatalogProvenanceSchema = z.object({
  source: z.enum(["manual-seed", "scrape-proposal", "partner-submission"]),
  sourceUrl: z.string().optional(),
  asOf: z.string().regex(ISO_YEAR_MONTH, "asOf must be YYYY-MM"),
  scrapedAt: z.string().optional(),
  submittedBy: z.string().optional(),
  notes: z.string().optional(),
});

export const CatalogEntryInputSchema = z.object({
  programId: z.string().min(1, "programId is required"),
  provenance: CatalogProvenanceSchema,
  region: z.string().min(1, "region is required"),
  name: z.string().min(1, "name is required"),
  category: ProgramCategorySchema,
  defaultMatch: BenefitMatchSchema,
  tiers: z.array(z.string()).optional(),
  requiresCredential: z.boolean(),
  fields: z.array(ProgramFieldSchema),
  benefits: z.record(z.array(BenefitTemplateSchema)),
});
