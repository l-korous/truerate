import { test } from "node:test";
import assert from "node:assert/strict";
import { aggregatePerks, formatConditions, pretty } from "../components/PerkInventory";
import type { PublicMembership } from "../lib/api";

function makeMembership(overrides: Partial<PublicMembership> & { id: string }): PublicMembership {
  return {
    label: "Test membership",
    programId: undefined,
    tier: undefined,
    attributes: {},
    hasCredential: false,
    status: "active",
    benefits: [],
    ...overrides,
  };
}

// ── aggregatePerks ──────────────────────────────────────────────────────────

test("aggregatePerks: extracts structured perks", () => {
  const m = makeMembership({
    id: "m1",
    label: "Booking Genius",
    benefits: [
      {
        id: "b1",
        scope: "domain",
        match: {},
        source: "catalog",
        value: {
          kind: "perk",
          structuredPerks: [
            { type: "free_breakfast", label: "Free breakfast", conditions: { subjectToAvailability: true } },
            { type: "room_upgrade", label: "Room upgrade" },
          ],
        },
      },
    ],
  });
  const items = aggregatePerks([m]);
  assert.equal(items.length, 2);
  assert.equal(items[0].perkType, "free_breakfast");
  assert.equal(items[0].label, "Free breakfast");
  assert.equal(items[0].membershipLabel, "Booking Genius");
  assert.deepEqual(items[0].conditions, { subjectToAvailability: true });
  assert.equal(items[1].perkType, "room_upgrade");
  assert.equal(items[1].conditions, undefined);
});

test("aggregatePerks: falls back to free-text perks when no structuredPerks", () => {
  const m = makeMembership({
    id: "m2",
    label: "Custom",
    benefits: [
      {
        id: "b2",
        scope: "property",
        match: {},
        source: "user-declared",
        value: { kind: "perk", perks: ["Late checkout", "Welcome drink"] },
      },
    ],
  });
  const items = aggregatePerks([m]);
  assert.equal(items.length, 2);
  assert.equal(items[0].perkType, null);
  assert.equal(items[0].label, "Late checkout");
  assert.equal(items[1].label, "Welcome drink");
});

test("aggregatePerks: skips non-perk benefits", () => {
  const m = makeMembership({
    id: "m3",
    label: "Discount only",
    benefits: [
      {
        id: "b3",
        scope: "domain",
        match: {},
        source: "catalog",
        value: { kind: "percentDiscount", percentOff: 0.1 },
      },
    ],
  });
  assert.equal(aggregatePerks([m]).length, 0);
});

test("aggregatePerks: aggregates across multiple memberships", () => {
  const m1 = makeMembership({
    id: "m1",
    label: "A",
    benefits: [{ id: "b1", scope: "global", match: {}, source: "catalog", value: { kind: "perk", perks: ["Free Wi-Fi"] } }],
  });
  const m2 = makeMembership({
    id: "m2",
    label: "B",
    benefits: [{ id: "b2", scope: "global", match: {}, source: "catalog", value: { kind: "perk", perks: ["Early check-in"] } }],
  });
  const items = aggregatePerks([m1, m2]);
  assert.equal(items.length, 2);
  assert.equal(items[0].membershipLabel, "A");
  assert.equal(items[1].membershipLabel, "B");
});

test("aggregatePerks: empty memberships returns empty array", () => {
  assert.equal(aggregatePerks([]).length, 0);
});

test("aggregatePerks: membership with no benefits returns empty array", () => {
  const m = makeMembership({ id: "m1" });
  assert.equal(aggregatePerks([m]).length, 0);
});

// ── formatConditions ────────────────────────────────────────────────────────

test("formatConditions: tierRequired", () => {
  const tags = formatConditions({ tierRequired: "Gold" });
  assert.ok(tags.some((t) => t.includes("Gold")));
});

test("formatConditions: minNights", () => {
  const tags = formatConditions({ minNights: 2 });
  assert.ok(tags.some((t) => t.includes("2")));
});

test("formatConditions: bookingChannel array", () => {
  const tags = formatConditions({ bookingChannel: ["direct", "ota"] });
  assert.equal(tags.length, 1);
  assert.ok(tags[0].includes("booking"));
});

test("formatConditions: subjectToAvailability", () => {
  const tags = formatConditions({ subjectToAvailability: true });
  assert.ok(tags.some((t) => /availability/i.test(t)));
});

test("formatConditions: enrollmentRequired", () => {
  const tags = formatConditions({ enrollmentRequired: true });
  assert.ok(tags.some((t) => /enrollment/i.test(t)));
});

test("formatConditions: notes string", () => {
  const tags = formatConditions({ notes: "Weekend stays only" });
  assert.ok(tags.some((t) => t === "Weekend stays only"));
});

test("formatConditions: empty object returns empty array", () => {
  assert.equal(formatConditions({}).length, 0);
});

test("formatConditions: false / falsy values not included", () => {
  const tags = formatConditions({ subjectToAvailability: false, enrollmentRequired: false });
  assert.equal(tags.length, 0);
});

// ── pretty ──────────────────────────────────────────────────────────────────

test("pretty: converts snake_case to Title Case", () => {
  assert.equal(pretty("free_breakfast"), "Free Breakfast");
  assert.equal(pretty("room_upgrade"), "Room Upgrade");
  assert.equal(pretty("early_check_in"), "Early Check In");
});

// ── No-price invariant ───────────────────────────────────────────────────────

test("aggregatePerks: never produces price-like values in labels", () => {
  const m = makeMembership({
    id: "m1",
    label: "Test",
    benefits: [
      {
        id: "b1",
        scope: "domain",
        match: {},
        source: "catalog",
        value: {
          kind: "perk",
          structuredPerks: [
            { type: "free_breakfast", label: "Free breakfast" },
            { type: "room_upgrade", label: "Room upgrade" },
          ],
        },
      },
    ],
  });
  const items = aggregatePerks([m]);
  for (const item of items) {
    // Labels must not contain computed prices (e.g. "$120", "€90").
    assert.ok(!/\$\d{3}/.test(item.label), `price pattern in label: ${item.label}`);
  }
});
