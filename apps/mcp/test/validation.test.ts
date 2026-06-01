/**
 * Zod schema validation tests for MCP tool args.
 * Confirms the shared HotelSearchQuerySchema is in use and validates correctly.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { HotelSearchQuerySchema } from "@truerate/core";

test("HotelSearchQuerySchema: validates a complete valid payload", () => {
  const result = HotelSearchQuerySchema.safeParse({
    location: "Vienna",
    checkIn: "2026-07-10",
    checkOut: "2026-07-12",
    adults: 2,
    rooms: 1,
    currency: "EUR",
    limit: 5,
  });
  assert.ok(result.success);
});

test("HotelSearchQuerySchema: validates minimal payload (location + dates)", () => {
  const result = HotelSearchQuerySchema.safeParse({
    location: "Prague",
    checkIn: "2026-08-01",
    checkOut: "2026-08-03",
  });
  assert.ok(result.success);
});

test("HotelSearchQuerySchema: rejects missing location", () => {
  const result = HotelSearchQuerySchema.safeParse({
    checkIn: "2026-07-10",
    checkOut: "2026-07-12",
  });
  assert.ok(!result.success);
  assert.ok(result.error.issues.some((i) => i.path.includes("location")));
});

test("HotelSearchQuerySchema: rejects non-ISO checkIn", () => {
  const result = HotelSearchQuerySchema.safeParse({
    location: "Berlin",
    checkIn: "July 10",
    checkOut: "2026-07-12",
  });
  assert.ok(!result.success);
  assert.ok(result.error.issues.some((i) => i.path.includes("checkIn")));
});

test("HotelSearchQuerySchema: rejects non-ISO checkOut", () => {
  const result = HotelSearchQuerySchema.safeParse({
    location: "Berlin",
    checkIn: "2026-07-10",
    checkOut: "12/07/2026",
  });
  assert.ok(!result.success);
  assert.ok(result.error.issues.some((i) => i.path.includes("checkOut")));
});

test("HotelSearchQuerySchema: rejects limit > 20", () => {
  const result = HotelSearchQuerySchema.safeParse({
    location: "Berlin",
    checkIn: "2026-07-10",
    checkOut: "2026-07-12",
    limit: 21,
  });
  assert.ok(!result.success);
  assert.ok(result.error.issues.some((i) => i.path.includes("limit")));
});

test("HotelSearchQuerySchema: rejects adults < 1", () => {
  const result = HotelSearchQuerySchema.safeParse({
    location: "Berlin",
    checkIn: "2026-07-10",
    checkOut: "2026-07-12",
    adults: 0,
  });
  assert.ok(!result.success);
  assert.ok(result.error.issues.some((i) => i.path.includes("adults")));
});
