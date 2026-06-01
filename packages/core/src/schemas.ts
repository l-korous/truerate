import { z } from "zod";

// --- Building blocks ---------------------------------------------------------

export const BenefitKindSchema = z.enum(["percentDiscount", "fixedDiscount", "perk", "pointsEarn"]);

export const BenefitValueSchema = z.object({
  kind: BenefitKindSchema,
  percentOff: z.number().min(0).max(1).optional(),
  amountOff: z.number().min(0).optional(),
  currency: z.string().optional(),
  perks: z.array(z.string()).optional(),
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
