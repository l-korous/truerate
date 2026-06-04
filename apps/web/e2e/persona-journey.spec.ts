/**
 * Persona-driven Playwright journeys for the web channel (issue #41).
 *
 * Uses synthetic personas from @truerate/harness to run real browser journeys
 * against apps/web. Each persona carries an expectedPerks contract that the
 * web channel driver asserts against: perk labels, condition tags, and
 * estimated-value tiers must match — and no TrueRate-produced price may appear
 * (product rule #1, issue #1).
 *
 * Persona selection rationale:
 *   - persona-cz-0 (Booking.com Genius L2 + Your Prague Hotels): OTA discount
 *     + structured perks with bookingChannel/subjectToAvailability conditions.
 *   - persona-de-1 (Booking.com Genius L1 + Marriott Bonvoy Gold): mixed OTA +
 *     hotel-chain; Marriott Gold perks include room upgrade and late check-out.
 *   - persona-at-4 (Marriott Bonvoy Platinum + IHG One Rewards Gold Elite): rich
 *     hotel perk set — free breakfast, lounge access, suite upgrade.
 *
 * All three personas are built from real programs.ts data via the factory; the
 * driver re-derives the same expectedPerks from the same source and verifies
 * the UI surfaces them correctly.
 */

import { test, expect } from "@playwright/test";
import { createPersonaFactory } from "@truerate/harness";
import { runPersonaWebJourney } from "./web-driver.js";

// Build the four representative personas once (factory is deterministic).
const factory = createPersonaFactory();
// 6 personas → indices 0-5; we use 0 (CZ/OTA), 1 (DE/mixed), 4 (AT/hotel chain),
// 5 (GB/financial-card mix: Hilton + Amex + Revolut).
const personas = factory.build(6, 0);
const [persona0, persona1, , , persona4, persona5] = personas;

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

// ── Cross-persona: no prices on any tab for any persona ─────────────────────

test("no TrueRate-produced price on any tab (persona-cz-0 smoke)", async ({ page }) => {
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
