import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getProgram,
  instantiateBenefits,
  PROGRAMS,
  summariseBenefits,
  templatesForTier,
} from "../src/programs.js";
import { BookingProvider } from "../src/providers/booking.js";
import type { StructuredPerk } from "../src/types.js";

test("catalog is non-empty with unique ids", () => {
  assert.ok(PROGRAMS.length > 0);
  const ids = PROGRAMS.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("getProgram resolves known and unknown ids", () => {
  assert.equal(getProgram("booking_genius")?.name, "Booking.com Genius");
  assert.equal(getProgram("nope"), undefined);
});

test("instantiateBenefits builds catalog-sourced benefits with resolved match", () => {
  const program = getProgram("booking_genius")!;
  const benefits = instantiateBenefits(program, "Level 3");
  assert.ok(benefits.length >= 1);
  for (const b of benefits) {
    assert.equal(b.source, "catalog");
    assert.equal(b.programId, "booking_genius");
    assert.ok(b.match, "match must be resolved (inherited from defaultMatch)");
    assert.ok(b.id);
  }
  // Level 3 should include a 20% discount.
  assert.ok(benefits.some((b) => b.value.kind === "percentDiscount" && b.value.percentOff === 0.2));
});

test("Revolut Metal benefits include real partner perks (FT, lounge)", () => {
  const program = getProgram("revolut")!;
  const benefits = instantiateBenefits(program, "Metal");
  const perks = benefits.flatMap((b) => b.value.perks ?? []);
  assert.ok(perks.some((p) => /financial times/i.test(p)));
  assert.ok(perks.some((p) => /lounge/i.test(p)));
});

test("summariseBenefits renders human-readable lines", () => {
  const program = getProgram("hilton_honors")!;
  const summary = summariseBenefits(templatesForTier(program, "Gold"));
  assert.ok(summary.some((s) => /breakfast/i.test(s)));
});

test("Booking mock is deterministic and carries brands", async () => {
  const q = { location: "Vienna", checkIn: "2026-08-01", checkOut: "2026-08-03", adults: 2, rooms: 1, currency: "EUR", limit: 6 };
  const a = await new BookingProvider().search(q);
  const b = await new BookingProvider().search(q);
  assert.deepEqual(a.map((x) => [x.name, x.publicOffer.nightlyAmount]), b.map((x) => [x.name, x.publicOffer.nightlyAmount]));
  assert.ok(a.some((x) => x.brand === "Marriott"));
  assert.ok(a.some((x) => x.brand === undefined), "expected some independent hotels");
});

// ---------------------------------------------------------------------------
// Perk taxonomy migration: every perk benefit must have structuredPerks
// ---------------------------------------------------------------------------

test("every kind:perk BenefitValue in the catalog has structuredPerks", () => {
  for (const program of PROGRAMS) {
    for (const [tier, templates] of Object.entries(program.benefits)) {
      for (const template of templates) {
        if (template.value.kind === "perk") {
          assert.ok(
            template.value.structuredPerks && template.value.structuredPerks.length > 0,
            `${program.id}[${tier}] has kind:perk but no structuredPerks`
          );
        }
      }
    }
  }
});

test("structuredPerks carry no price-related keys", () => {
  const priceKeys = ["price", "amount", "currency", "cost", "rate", "discount", "percentOff", "amountOff"];
  for (const program of PROGRAMS) {
    for (const templates of Object.values(program.benefits)) {
      for (const template of templates) {
        for (const perk of template.value.structuredPerks ?? []) {
          for (const key of priceKeys) {
            assert.equal(
              (perk as Record<string, unknown>)[key],
              undefined,
              `${program.id}: structuredPerk '${perk.label}' must not have key '${key}'`
            );
            if (perk.conditions) {
              assert.equal(
                (perk.conditions as Record<string, unknown>)[key],
                undefined,
                `${program.id}: perk conditions for '${perk.label}' must not have key '${key}'`
              );
            }
          }
        }
      }
    }
  }
});

test("structuredPerks use only valid PerkType identifiers", () => {
  const validTypes = new Set([
    "early_check_in", "late_check_out", "free_breakfast", "room_upgrade",
    "suite_upgrade", "lounge_access", "welcome_amenity", "free_wifi",
    "airport_transfer", "parking", "spa_credit", "guaranteed_availability",
    "points_bonus", "priority_support", "other",
  ]);
  for (const program of PROGRAMS) {
    for (const [tier, templates] of Object.entries(program.benefits)) {
      for (const template of templates) {
        for (const perk of template.value.structuredPerks ?? []) {
          assert.ok(
            validTypes.has(perk.type),
            `${program.id}[${tier}]: unknown PerkType '${perk.type}'`
          );
        }
      }
    }
  }
});

test("structuredPerks have non-empty string labels", () => {
  for (const program of PROGRAMS) {
    for (const [tier, templates] of Object.entries(program.benefits)) {
      for (const template of templates) {
        for (const perk of template.value.structuredPerks ?? []) {
          assert.equal(typeof perk.label, "string", `${program.id}[${tier}]: perk label must be a string`);
          assert.ok(perk.label.length > 0, `${program.id}[${tier}]: perk label must not be empty`);
        }
      }
    }
  }
});

// ---------------------------------------------------------------------------
// Per-program structured perk spot-checks
// ---------------------------------------------------------------------------

test("your_prague_hotels has early_check_in, late_check_out, room_upgrade structuredPerks", () => {
  const program = getProgram("your_prague_hotels")!;
  const allPerks: StructuredPerk[] = program.benefits["*"]!.flatMap((t) => t.value.structuredPerks ?? []);
  assert.ok(allPerks.some((p) => p.type === "early_check_in"));
  assert.ok(allPerks.some((p) => p.type === "late_check_out"));
  assert.ok(allPerks.some((p) => p.type === "room_upgrade"));
  // All should be direct-booking only
  for (const p of allPerks) {
    if (p.conditions?.bookingChannel) {
      assert.ok(p.conditions.bookingChannel.includes("direct"));
    }
  }
});

test("emblem_prague has spa_credit, room_upgrade, early_check_in, late_check_out structuredPerks", () => {
  const program = getProgram("emblem_prague")!;
  const allPerks: StructuredPerk[] = program.benefits["*"]!.flatMap((t) => t.value.structuredPerks ?? []);
  assert.ok(allPerks.some((p) => p.type === "spa_credit"));
  assert.ok(allPerks.some((p) => p.type === "room_upgrade"));
  assert.ok(allPerks.some((p) => p.type === "early_check_in"));
  assert.ok(allPerks.some((p) => p.type === "late_check_out"));
});

test("hilton_honors Gold has free_breakfast and room_upgrade structuredPerks", () => {
  const program = getProgram("hilton_honors")!;
  const templates = templatesForTier(program, "Gold");
  const allPerks: StructuredPerk[] = templates.flatMap((t) => t.value.structuredPerks ?? []);
  assert.ok(allPerks.some((p) => p.type === "free_breakfast"), "Gold must have free_breakfast");
  assert.ok(allPerks.some((p) => p.type === "room_upgrade"), "Gold must have room_upgrade");
});

test("hilton_honors Diamond has lounge_access and guaranteed_availability structuredPerks", () => {
  const program = getProgram("hilton_honors")!;
  const templates = templatesForTier(program, "Diamond");
  const allPerks: StructuredPerk[] = templates.flatMap((t) => t.value.structuredPerks ?? []);
  assert.ok(allPerks.some((p) => p.type === "lounge_access"), "Diamond must have lounge_access");
  assert.ok(allPerks.some((p) => p.type === "guaranteed_availability"), "Diamond must have guaranteed_availability");
});

test("marriott_bonvoy Platinum has free_breakfast, lounge_access, suite_upgrade, late_check_out", () => {
  const program = getProgram("marriott_bonvoy")!;
  const templates = templatesForTier(program, "Platinum");
  const allPerks: StructuredPerk[] = templates.flatMap((t) => t.value.structuredPerks ?? []);
  assert.ok(allPerks.some((p) => p.type === "free_breakfast"));
  assert.ok(allPerks.some((p) => p.type === "lounge_access"));
  assert.ok(allPerks.some((p) => p.type === "suite_upgrade"));
  assert.ok(allPerks.some((p) => p.type === "late_check_out"));
});

test("accor_all Platinum has guaranteed_availability and suite_upgrade structuredPerks", () => {
  const program = getProgram("accor_all")!;
  const templates = templatesForTier(program, "Platinum");
  const allPerks: StructuredPerk[] = templates.flatMap((t) => t.value.structuredPerks ?? []);
  assert.ok(allPerks.some((p) => p.type === "guaranteed_availability"));
  assert.ok(allPerks.some((p) => p.type === "suite_upgrade"));
});

test("ihg_one_rewards Diamond Elite has priority_support and welcome_amenity structuredPerks", () => {
  const program = getProgram("ihg_one_rewards")!;
  const templates = templatesForTier(program, "Diamond Elite");
  const allPerks: StructuredPerk[] = templates.flatMap((t) => t.value.structuredPerks ?? []);
  assert.ok(allPerks.some((p) => p.type === "priority_support"));
  assert.ok(allPerks.some((p) => p.type === "welcome_amenity"));
});

test("revolut Metal has lounge_access and points_bonus structuredPerks", () => {
  const program = getProgram("revolut")!;
  const templates = templatesForTier(program, "Metal");
  const allPerks: StructuredPerk[] = templates.flatMap((t) => t.value.structuredPerks ?? []);
  assert.ok(allPerks.some((p) => p.type === "lounge_access"));
  assert.ok(allPerks.some((p) => p.type === "points_bonus"));
});

test("revolut Ultra has lounge_access structuredPerk", () => {
  const program = getProgram("revolut")!;
  const templates = templatesForTier(program, "Ultra");
  const allPerks: StructuredPerk[] = templates.flatMap((t) => t.value.structuredPerks ?? []);
  assert.ok(allPerks.some((p) => p.type === "lounge_access"));
});

test("amex_platinum has free_breakfast and lounge_access structuredPerks", () => {
  const program = getProgram("amex_platinum")!;
  const templates = templatesForTier(program);
  const allPerks: StructuredPerk[] = templates.flatMap((t) => t.value.structuredPerks ?? []);
  assert.ok(allPerks.some((p) => p.type === "free_breakfast"));
  assert.ok(allPerks.some((p) => p.type === "lounge_access"));
});

test("miles_and_more has points_bonus structuredPerk", () => {
  const program = getProgram("miles_and_more")!;
  const templates = templatesForTier(program);
  const allPerks: StructuredPerk[] = templates.flatMap((t) => t.value.structuredPerks ?? []);
  assert.ok(allPerks.some((p) => p.type === "points_bonus"));
});

test("expedia_one_key resolves with expected tiers and earn rates", () => {
  const program = getProgram("expedia_one_key")!;
  assert.ok(program, "expedia_one_key must be in catalog");
  assert.equal(program.category, "ota");

  // Blue: 2% OneKeyCash
  const bluePerks: StructuredPerk[] = instantiateBenefits(program, "Blue").flatMap((b) => b.value.structuredPerks ?? []);
  assert.ok(bluePerks.some((p) => p.type === "points_bonus" && /2%/.test(p.label)));

  // Platinum: 5% + priority support
  const platPerks: StructuredPerk[] = instantiateBenefits(program, "Platinum").flatMap((b) => b.value.structuredPerks ?? []);
  assert.ok(platPerks.some((p) => p.type === "points_bonus" && /5%/.test(p.label)));
  assert.ok(platPerks.some((p) => p.type === "priority_support"));

  // All tiers: no price-related keys in structuredPerks
  for (const tier of program.tiers ?? []) {
    const benefits = instantiateBenefits(program, tier);
    for (const benefit of benefits) {
      assert.equal(benefit.source, "catalog");
      assert.equal(benefit.programId, "expedia_one_key");
    }
  }
});

test("subjectToAvailability conditions are booleans when present", () => {
  for (const program of PROGRAMS) {
    for (const templates of Object.values(program.benefits)) {
      for (const template of templates) {
        for (const perk of template.value.structuredPerks ?? []) {
          if (perk.conditions?.subjectToAvailability !== undefined) {
            assert.equal(
              typeof perk.conditions.subjectToAvailability,
              "boolean",
              `${program.id}: subjectToAvailability must be boolean for perk '${perk.label}'`
            );
          }
        }
      }
    }
  }
});
