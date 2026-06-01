import { test } from "node:test";
import assert from "node:assert/strict";
import type {
  PerkType,
  PerkConditions,
  StructuredPerk,
  BenefitValue,
  BookingChannel,
} from "../src/types.js";

// ---------------------------------------------------------------------------
// PerkType taxonomy invariants
// ---------------------------------------------------------------------------

test("PerkType taxonomy: all expected canonical identifiers exist as string literals", () => {
  const canonical: PerkType[] = [
    "early_check_in",
    "late_check_out",
    "free_breakfast",
    "room_upgrade",
    "suite_upgrade",
    "lounge_access",
    "welcome_amenity",
    "free_wifi",
    "airport_transfer",
    "parking",
    "spa_credit",
    "guaranteed_availability",
    "points_bonus",
    "priority_support",
    "other",
  ];

  // Every identifier must be a non-empty string.
  for (const id of canonical) {
    assert.equal(typeof id, "string");
    assert.ok(id.length > 0, `PerkType '${id}' must not be empty`);
  }

  // No duplicates in the list.
  assert.equal(new Set(canonical).size, canonical.length, "PerkType identifiers must be unique");
});

test("PerkType taxonomy: identifiers follow snake_case convention", () => {
  const canonical: PerkType[] = [
    "early_check_in",
    "late_check_out",
    "free_breakfast",
    "room_upgrade",
    "suite_upgrade",
    "lounge_access",
    "welcome_amenity",
    "free_wifi",
    "airport_transfer",
    "parking",
    "spa_credit",
    "guaranteed_availability",
    "points_bonus",
    "priority_support",
    "other",
  ];

  const snakeCasePattern = /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/;
  for (const id of canonical) {
    assert.match(id, snakeCasePattern, `PerkType '${id}' must be snake_case`);
  }
});

// ---------------------------------------------------------------------------
// BookingChannel values
// ---------------------------------------------------------------------------

test("BookingChannel: all values are valid string literals", () => {
  const channels: BookingChannel[] = ["direct", "ota", "phone", "agent"];
  for (const ch of channels) {
    assert.equal(typeof ch, "string");
    assert.ok(ch.length > 0);
  }
  assert.equal(new Set(channels).size, channels.length);
});

// ---------------------------------------------------------------------------
// PerkConditions shape
// ---------------------------------------------------------------------------

test("PerkConditions: empty object is valid (all fields optional)", () => {
  const empty: PerkConditions = {};
  assert.equal(typeof empty, "object");
  assert.equal(empty.tierRequired, undefined);
  assert.equal(empty.minNights, undefined);
  assert.equal(empty.bookingChannel, undefined);
  assert.equal(empty.blackoutDates, undefined);
  assert.equal(empty.subjectToAvailability, undefined);
  assert.equal(empty.enrollmentRequired, undefined);
  assert.equal(empty.notes, undefined);
});

test("PerkConditions: fully specified object retains all fields correctly", () => {
  const cond: PerkConditions = {
    tierRequired: "Gold",
    minNights: 2,
    bookingChannel: ["direct"],
    blackoutDates: ["2026-12-24/2026-12-26", "2027-01-01"],
    subjectToAvailability: true,
    enrollmentRequired: false,
    notes: "Excludes peak holiday periods",
  };

  assert.equal(cond.tierRequired, "Gold");
  assert.equal(cond.minNights, 2);
  assert.deepEqual(cond.bookingChannel, ["direct"]);
  assert.equal(cond.blackoutDates?.length, 2);
  assert.equal(cond.subjectToAvailability, true);
  assert.equal(cond.enrollmentRequired, false);
  assert.equal(cond.notes, "Excludes peak holiday periods");
});

test("PerkConditions: multiple booking channels are allowed", () => {
  const cond: PerkConditions = {
    bookingChannel: ["direct", "phone"],
  };
  assert.equal(cond.bookingChannel?.length, 2);
  assert.ok(cond.bookingChannel?.includes("direct"));
  assert.ok(cond.bookingChannel?.includes("phone"));
});

// ---------------------------------------------------------------------------
// StructuredPerk shape
// ---------------------------------------------------------------------------

test("StructuredPerk: minimal valid perk (type + label, no conditions)", () => {
  const perk: StructuredPerk = {
    type: "free_breakfast",
    label: "Complimentary breakfast daily",
  };

  assert.equal(perk.type, "free_breakfast");
  assert.equal(perk.label, "Complimentary breakfast daily");
  assert.equal(perk.conditions, undefined);
});

test("StructuredPerk: perk with conditions attached", () => {
  const perk: StructuredPerk = {
    type: "late_check_out",
    label: "4pm late check-out",
    conditions: {
      tierRequired: "Platinum",
      subjectToAvailability: false,
      bookingChannel: ["direct"],
    },
  };

  assert.equal(perk.type, "late_check_out");
  assert.equal(perk.conditions?.tierRequired, "Platinum");
  assert.equal(perk.conditions?.subjectToAvailability, false);
  assert.deepEqual(perk.conditions?.bookingChannel, ["direct"]);
});

test("StructuredPerk: 'other' type is a valid escape hatch", () => {
  const perk: StructuredPerk = {
    type: "other",
    label: "Complimentary shoe-shine service",
    conditions: { notes: "Available on request at the concierge desk" },
  };

  assert.equal(perk.type, "other");
  assert.ok(perk.conditions?.notes);
});

// ---------------------------------------------------------------------------
// BenefitValue integration: structuredPerks coexists with free-text perks
// ---------------------------------------------------------------------------

test("BenefitValue: structuredPerks field is optional and coexists with free-text perks", () => {
  const legacy: BenefitValue = {
    kind: "perk",
    perks: ["Free breakfast", "Late checkout"],
  };
  assert.equal(legacy.structuredPerks, undefined);

  const structured: BenefitValue = {
    kind: "perk",
    structuredPerks: [
      { type: "free_breakfast", label: "Complimentary breakfast" },
      { type: "late_check_out", label: "Late check-out until 4pm" },
    ],
  };
  assert.equal(structured.structuredPerks?.length, 2);
  assert.equal(structured.perks, undefined);

  const mixed: BenefitValue = {
    kind: "perk",
    perks: ["Free breakfast"],
    structuredPerks: [{ type: "free_breakfast", label: "Complimentary breakfast" }],
  };
  assert.equal(mixed.perks?.length, 1);
  assert.equal(mixed.structuredPerks?.length, 1);
});

test("BenefitValue with structuredPerks contains no price or currency fields", () => {
  const value: BenefitValue = {
    kind: "perk",
    structuredPerks: [
      {
        type: "room_upgrade",
        label: "Room upgrade when available",
        conditions: { subjectToAvailability: true },
      },
    ],
  };

  // structuredPerks must not carry price/currency fields.
  const perk = value.structuredPerks![0];
  assert.equal((perk as Record<string, unknown>)["price"], undefined);
  assert.equal((perk as Record<string, unknown>)["amount"], undefined);
  assert.equal((perk as Record<string, unknown>)["currency"], undefined);
  // conditions must not carry price/currency fields.
  const cond = perk.conditions ?? {};
  assert.equal((cond as Record<string, unknown>)["price"], undefined);
  assert.equal((cond as Record<string, unknown>)["amount"], undefined);
  assert.equal((cond as Record<string, unknown>)["currency"], undefined);
});

// ---------------------------------------------------------------------------
// Structural: no price-related properties in taxonomy types
// ---------------------------------------------------------------------------

test("StructuredPerk and PerkConditions carry no price-related keys", () => {
  const priceKeys = ["price", "amount", "currency", "cost", "rate", "discount", "percentOff", "amountOff"];

  const perk: StructuredPerk = {
    type: "lounge_access",
    label: "Executive lounge access",
    conditions: {
      tierRequired: "Diamond",
      notes: "Subject to lounge capacity",
    },
  };

  for (const key of priceKeys) {
    assert.equal(
      (perk as Record<string, unknown>)[key],
      undefined,
      `StructuredPerk must not have key '${key}'`
    );
    assert.equal(
      (perk.conditions as Record<string, unknown>)[key],
      undefined,
      `PerkConditions must not have key '${key}'`
    );
  }
});
