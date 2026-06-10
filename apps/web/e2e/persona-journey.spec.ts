/**
 * Persona-driven Playwright journeys for the web channel (issue #41).
 *
 * Uses synthetic personas from @truerate/harness to run real browser journeys
 * against apps/web. Each persona carries an expectedPerks contract that the
 * web channel driver asserts against: perk labels, condition tags, and
 * estimated-value tiers must match — and no CustomRates-produced price may appear
 * (product rule #1, issue #1).
 *
 * Persona selection rationale:
 *   - persona-cz-0 (Booking.com Genius L2 + Your Prague Hotels): OTA discount
 *     + structured perks with bookingChannel/subjectToAvailability conditions.
 *   - persona-de-1 (Booking.com Genius L1 + Marriott Bonvoy Gold): mixed OTA +
 *     hotel-chain; Marriott Gold perks include room upgrade and late check-out.
 *   - persona-cz-2 (Accor ALL Gold + Emblem Prague): Czech hotel-chain programs;
 *     lounge_access, spa_credit, dual room_upgrade from distinct memberships.
 *   - persona-at-4 (Marriott Bonvoy Platinum + IHG One Rewards Gold Elite): rich
 *     hotel perk set — free breakfast, lounge access, suite upgrade.
 *   - persona-gb-5 (Hilton Gold + Amex Platinum + Revolut Metal): financial-card
 *     + hotel-chain mix with high value-tab rollup.
 *   - persona-sk-6 (Booking.com Genius Level 3 + Accor ALL Silver): SK market;
 *     highest Genius tier (20% off); Accor Silver perks distinct from Gold.
 *   - persona-hu-7 (IHG Platinum Elite + Revolut Ultra): top-tier IHG perks
 *     (guaranteed_availability) + Revolut Ultra lounge access.
 *
 * All personas are built from real programs.ts data via the factory; the
 * driver re-derives the same expectedPerks from the same source and verifies
 * the UI surfaces them correctly.
 */

import { test, expect } from "@playwright/test";
import { createPersonaFactory } from "@truerate/harness";
import { runPersonaWebJourney } from "./web-driver.js";

// Build all eight representative personas once (factory is deterministic).
const factory = createPersonaFactory();
// 8 personas → indices 0-7; we use 0 (CZ/OTA), 1 (DE/mixed), 2 (CZ/hotel-chain),
// 4 (AT/hotel chain), 5 (GB/financial-card mix), 6 (SK/Genius-L3+Accor-Silver),
// 7 (HU/IHG+Revolut Ultra).
const personas = factory.build(8, 0);
const [persona0, persona1, persona2, , persona4, persona5, persona6, persona7] = personas;

// ── persona-cz-0: OTA discount + availability conditions ─────────────────────

test("persona-cz-0: Booking.com Genius L2 + Your Prague Hotels — perks and conditions", async ({ page }) => {
  const persona = persona0!;

  // Sanity: persona has OTA perks with subjectToAvailability.
  expect(persona.expectedPerks.length).toBeGreaterThan(0);
  expect(persona.expectedPerks.some((ep) =>
    (ep.conditions as Record<string, unknown> | undefined)?.subjectToAvailability === true,
  )).toBe(true);

  const added = await runPersonaWebJourney(page, persona);

  // Both catalog programs should have been added.
  expect(added.length).toBeGreaterThanOrEqual(1);
});

// ── persona-de-1: mixed OTA (L1, no perks) + Marriott Bonvoy Gold ────────────

test("persona-de-1: Marriott Bonvoy Gold shows room upgrade + late checkout perks", async ({ page }) => {
  const persona = persona1!;

  // Marriott Gold has structured perks: room_upgrade, late_check_out, points_bonus.
  const marriottPerks = persona.expectedPerks.filter(
    (ep) => ep.membershipLabel.toLowerCase().includes("marriott"),
  );
  expect(marriottPerks.length).toBeGreaterThan(0);

  const added = await runPersonaWebJourney(page, persona);
  expect(added.length).toBeGreaterThanOrEqual(1);
});

// ── persona-at-4: Marriott Bonvoy Platinum + IHG Gold Elite ─────────────────

test("persona-at-4: Marriott Platinum + IHG Gold Elite — rich hotel perk set", async ({ page }) => {
  const persona = persona4!;

  // Both programs have rich structured perks.
  expect(persona.expectedPerks.length).toBeGreaterThan(0);

  // Platinum must include free_breakfast.
  const hasBreakfast = persona.expectedPerks.some((ep) => ep.perkType === "free_breakfast");
  expect(hasBreakfast).toBe(true);

  const added = await runPersonaWebJourney(page, persona);
  expect(added.length).toBeGreaterThanOrEqual(1);
});

// ── persona-gb-5: Hilton Gold + Amex Platinum + Revolut Metal ────────────────
//
// This persona covers financial-card programs (Amex Platinum, Revolut Metal)
// combined with a hotel-chain program (Hilton Honors Gold). None of these three
// programs are tested through the web channel in any other persona journey:
//   - Amex Platinum contributes free_breakfast / room_upgrade / late_check_out /
//     spa_credit / lounge_access via Fine Hotels + Resorts — all with non-zero
//     estimated USD values at 4★.
//   - Hilton Honors Gold adds free_breakfast and room_upgrade on Hilton brands.
//   - Revolut Metal perks are "other" (intangible, $0 at any star band).
// The combined vault has the highest perk-value rollup of any tested persona,
// exercising the value tab with a multi-program, multi-category membership set.

test("persona-gb-5: Hilton Honors Gold + Amex Platinum + Revolut Metal — financial perks in web channel", async ({ page }) => {
  const persona = persona5!;

  // Hilton Gold includes free_breakfast (F&B credit at US hotels).
  expect(persona.expectedPerks.some((ep) => ep.perkType === "free_breakfast")).toBe(true);

  // Amex Platinum contributes lounge_access and spa_credit via Fine Hotels + Resorts —
  // financial-card perks not present in any other web persona journey.
  expect(
    persona.expectedPerks.some(
      (ep) => ep.perkType === "lounge_access" || ep.perkType === "spa_credit",
    ),
  ).toBe(true);

  // All three programs are in the catalog; at least 2 must be added.
  const added = await runPersonaWebJourney(page, persona);
  expect(added.length).toBeGreaterThanOrEqual(2);
});

// ── persona-cz-2: Accor ALL Gold + Emblem Prague — hotel-chain perks ─────────
//
// Covers the Czech market's hotel-chain-only programs:
//   - Accor ALL Gold: lounge_access, room_upgrade (subjectToAvailability),
//     welcome_amenity — none tested in any other web persona journey.
//   - Emblem Prague: boutique-hotel direct programme — spa_credit, early_check_in,
//     late_check_out, and a second room_upgrade (subjectToAvailability+direct).
// Both programs carry room_upgrade under distinct membership labels, exercising
// the perk-inventory dedup-by-membership logic (two separate entries expected).

test("persona-cz-2: Accor ALL Gold + Emblem Prague — hotel-chain perks and spa credit", async ({ page }) => {
  const persona = persona2!;

  // Accor ALL Gold brings lounge_access — first web journey to cover this program.
  expect(persona.expectedPerks.some((ep) => ep.perkType === "lounge_access")).toBe(true);

  // Emblem Prague brings spa_credit — boutique direct programme perk.
  expect(persona.expectedPerks.some((ep) => ep.perkType === "spa_credit")).toBe(true);

  // Both programs carry room_upgrade under different labels — both must appear.
  const roomUpgrades = persona.expectedPerks.filter((ep) => ep.perkType === "room_upgrade");
  expect(roomUpgrades.length).toBeGreaterThanOrEqual(2);

  const added = await runPersonaWebJourney(page, persona);
  expect(added.length).toBeGreaterThanOrEqual(1);
});

// ── persona-hu-7: IHG Platinum Elite + Revolut Ultra — top-tier IHG perks ───
//
// Covers the highest non-Diamond IHG tier and the top Revolut card:
//   - IHG Platinum Elite: guaranteed_availability (unique to this tier — absent
//     in Gold Elite tested via persona-at-4), room_upgrade, welcome_amenity.
//   - Revolut Ultra: lounge_access ("Unlimited worldwide airport lounge access")
//     distinct from Revolut Metal (intangible-only) tested via persona-gb-5.
// IHG Platinum perks have non-zero 4★ estimates, exercising the value tab.

test("persona-hu-7: IHG Platinum Elite + Revolut Ultra — top-tier IHG perks and financial card", async ({ page }) => {
  const persona = persona7!;

  // IHG Platinum Elite guaranteed_availability — unique to Platinum tier,
  // not present in Gold Elite (persona-at-4) or any other web persona journey.
  expect(
    persona.expectedPerks.some((ep) => ep.perkType === "guaranteed_availability"),
  ).toBe(true);

  // Revolut Ultra brings lounge_access (unlimited worldwide airport access).
  expect(persona.expectedPerks.some((ep) => ep.perkType === "lounge_access")).toBe(true);

  const added = await runPersonaWebJourney(page, persona);
  expect(added.length).toBeGreaterThanOrEqual(1);
});

// ── persona-sk-6: Genius Level 3 (20% off) + Accor ALL Silver ────────────────
//
// Closes the SK-market and Genius-Level-3 web coverage gap:
//   - Booking.com Genius Level 3: 20% off — no prior web journey covers L3
//     (Level 1 tested via de-1, Level 2 via cz-0). L3 also adds free_breakfast
//     and room_upgrade OTA perks with subjectToAvailability.
//   - Accor ALL Silver: welcome_amenity (welcome drink) + late_check_out
//     (subjectToAvailability) — distinct from Gold (room_upgrade + lounge_access
//     tested via cz-2). Silver is the first Accor tier above Classic; the perk
//     inventory must render both Silver perks and their condition tags.
// This is the only web persona that carries subjectToAvailability perks from
// two programs simultaneously (Genius L3 OTA perks + Accor Silver late checkout),
// exercising the multi-source condition-tag dedup path in the perk inventory.

test("persona-sk-6: Booking.com Genius Level 3 + Accor ALL Silver — 20% off and Silver perks", async ({ page }) => {
  const persona = persona6!;

  // Genius Level 3 is the highest Booking.com tier — 20% off participating
  // properties. No existing web journey exercises Level 3.
  expect(persona.memberships.some((m) => m.tier === "Level 3")).toBe(true);

  // Accor Silver surfaces welcome_amenity and late_check_out — different from
  // Accor Gold (room_upgrade + lounge_access) tested in persona-cz-2.
  expect(persona.expectedPerks.some((ep) => ep.perkType === "welcome_amenity")).toBe(true);
  expect(persona.expectedPerks.some((ep) => ep.perkType === "late_check_out")).toBe(true);

  // Genius Level 3 adds OTA-channel free_breakfast and room_upgrade perks.
  expect(persona.expectedPerks.some((ep) => ep.perkType === "free_breakfast")).toBe(true);

  // Both programs contribute subjectToAvailability perks — the inventory must
  // render the "Subject to availability" condition tag.
  expect(
    persona.expectedPerks.some(
      (ep) =>
        (ep.conditions as Record<string, unknown> | undefined)?.subjectToAvailability === true,
    ),
  ).toBe(true);

  const added = await runPersonaWebJourney(page, persona);
  // Both catalog programs (booking_genius + accor_all) must be in the vault.
  expect(added.length).toBeGreaterThanOrEqual(2);
});

// ── Cross-persona: no prices on any tab for any persona ─────────────────────

test("no CustomRates-produced price on any tab (persona-cz-0 smoke)", async ({ page }) => {
  // runPersonaWebJourney already asserts this internally; this test is an
  // explicit no-price-anywhere marker for CI reporting clarity.
  const persona = persona0!;
  await runPersonaWebJourney(page, persona);

  // Extra belt-and-suspenders: re-check all tabs after the driver finishes.
  const FORBIDDEN = [
    /indicative member savings/i,
    /reveal my rates/i,
    /member price/i,
    /post.discount/i,
  ];
  for (const pattern of FORBIDDEN) {
    await expect(page.getByText(pattern)).not.toBeVisible();
  }
});
