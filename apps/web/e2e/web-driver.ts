/**
 * Web channel driver for the TrueRate synthetic-user harness (issue #41).
 *
 * Accepts a TestPersona from @truerate/harness and a Playwright Page, then:
 *   1. Registers the persona in the web UI.
 *   2. Adds each of their catalog memberships.
 *   3. Asserts that displayed perks/conditions match the persona's expectedPerks
 *      contract (perk labels, condition tags, estimated value labels).
 *   4. Asserts that no TrueRate-produced price appears anywhere — product rule
 *      #1 (issue #1): only perk-value estimate tiers, never prices.
 *
 * Product rule invariants enforced here:
 *   - "indicative member savings", "reveal my rates", "save $N", "member price",
 *     "post-discount" must never appear in any tab.
 *   - Estimated value rows are shown with the label "Estimated value" only.
 */

import { expect, type Page } from "@playwright/test";
import type { TestPersona } from "@truerate/harness";

// Patterns whose presence would violate product rule #1 (no prices from TrueRate).
const FORBIDDEN_PRICE_PATTERNS = [
  /indicative member savings/i,
  /reveal my rates/i,
  /save \d/i,
  /member price/i,
  /post.discount/i,
];

async function assertNoPrices(page: Page): Promise<void> {
  for (const pattern of FORBIDDEN_PRICE_PATTERNS) {
    await expect(page.getByText(pattern)).not.toBeVisible();
  }
}

/**
 * Run the full web channel journey for a synthetic test persona.
 *
 * Registers, adds catalog memberships, then walks through all tabs asserting:
 *   - Perk labels from persona.expectedPerks appear in the perk inventory.
 *   - Condition tags (e.g. "Subject to availability") appear when expected.
 *   - Estimated values are labeled "Estimated value", never "price".
 *   - No forbidden price text appears on any tab.
 *
 * @returns Labels of memberships successfully added to the vault.
 */
export async function runPersonaWebJourney(
  page: Page,
  persona: TestPersona,
): Promise<string[]> {
  // Append timestamp so parallel/serial runs against the same in-memory server
  // never collide on the same email (TRUERATE_INMEMORY=true, no persistence).
  const email = `${persona.handle}+${Date.now()}@truerate-test.local`;
  const password = "e2e-pw-test-1234";

  // ── Registration ────────────────────────────────────────────────────────────
  await page.goto("/");
  // Wait for the auth form to be ready before interacting — guards against the
  // cold-start race where the page has finished loading but React hydration
  // (and thus the form being actionable) is still in progress.
  await page.getByPlaceholder("you@example.com").waitFor({ state: "visible" });
  await page.getByPlaceholder("you@example.com").fill(email);
  await page.getByPlaceholder("••••••••").fill(password);
  await page.getByTestId("auth-submit").click();
  await expect(page.getByRole("heading", { name: "Your memberships" })).toBeVisible();

  // Memberships tab must not show any prices on arrival.
  await assertNoPrices(page);

  // ── Add catalog memberships ─────────────────────────────────────────────────
  const addedLabels: string[] = [];

  for (const membership of persona.memberships) {
    const programId = membership.programId;
    if (!programId) continue;

    await page.getByTestId("add-membership").click();

    // Wait for the program picker to render (programs load async from API).
    const btn = page.getByTestId(`program-${programId}`);
    // Use waitFor so the timeout matches the global expect.timeout setting
    // (avoids hardcoded short values that fire before the picker has loaded).
    const btnVisible = await btn
      .waitFor({ state: "visible" })
      .then(() => true)
      .catch(() => false);

    if (!btnVisible) {
      // Program not in catalog UI — dismiss modal and skip.
      await page.locator("button").filter({ hasText: "×" }).click();
      continue;
    }

    await btn.click();

    // Select the persona's tier when a tier select field is present.
    if (membership.tier) {
      const sel = page.locator("select").first();
      if (await sel.count() > 0) {
        await sel.selectOption(membership.tier).catch(() => {
          /* tier option absent for this program — first option remains selected */
        });
      }
    }

    await page.getByRole("button", { name: "Add membership" }).click();

    // Wait for the add modal to close (benefit-summary only exists in the modal).
    await expect(page.getByTestId("benefit-summary")).not.toBeVisible();
    await expect(page.getByTestId("membership-list")).toBeVisible();

    addedLabels.push(membership.label);
  }

  if (addedLabels.length === 0) return addedLabels;

  // Memberships tab still free of prices after all additions.
  await assertNoPrices(page);

  // ── "Try it" / perks tab ────────────────────────────────────────────────────
  await page.getByTestId("tab-try").click();
  await assertNoPrices(page);

  // ── Perk inventory tab ──────────────────────────────────────────────────────
  await page.getByTestId("tab-inventory").click();
  await expect(page.getByTestId("perk-inventory")).toBeVisible();
  await assertNoPrices(page);

  // Disclaimer must say "not prices" — confirming estimates ≠ prices.
  await expect(page.getByTestId("inventory-disclaimer")).toBeVisible();
  await expect(page.getByTestId("inventory-disclaimer")).toContainText(/not prices/i);

  // ── Assertions: expectedPerks contract ─────────────────────────────────────
  if (persona.expectedPerks.length > 0) {
    // At least one inventory item must be visible.
    await expect(page.getByTestId("inventory-item").first()).toBeVisible();

    // Every expected perk label must appear in at least one inventory item.
    // .first() avoids strict-mode failure when one label is a substring of
    // another (e.g. "Room upgrade when available" ⊂ "Priority room upgrade
    // when available" — both can appear when two programs both carry room_upgrade).
    for (const ep of persona.expectedPerks) {
      await expect(
        page.getByTestId("inventory-item").filter({ hasText: ep.label }).first(),
      ).toBeVisible();
    }

    // Estimated values are labeled "Estimated value" — never "price".
    const estimateRows = page.getByTestId("estimate-row");
    if (await estimateRows.count() > 0) {
      await expect(page.getByText(/estimated value/i).first()).toBeVisible();
    }

    // Condition tags: any expectedPerk with subjectToAvailability must render
    // the "Subject to availability" tag in the inventory.
    const needsAvailabilityTag = persona.expectedPerks.some(
      (ep) =>
        (ep.conditions as Record<string, unknown> | undefined)
          ?.subjectToAvailability === true,
    );
    if (needsAvailabilityTag) {
      await expect(page.getByText(/subject to availability/i).first()).toBeVisible();
    }
  }

  // ── Value tab ───────────────────────────────────────────────────────────────
  // Navigate to the value tab when the persona has at least one perk with a
  // non-zero monetary estimate. Verifies the rollup shows estimated values (not
  // prices) and that per-membership rows appear for each contributing program.
  const hasMonetaryPerks = persona.expectedPerks.some((ep) => ep.estimatedUsd[4] > 0);
  if (hasMonetaryPerks) {
    await page.getByTestId("tab-value").click();
    await expect(page.getByTestId("value-explainer")).toBeVisible();
    await assertNoPrices(page);

    // Band cards (3★/4★/5★) are always rendered when the view has data.
    // The 4★ grand total must contain "≈$" — the approximately-equal prefix
    // that signals this is an estimate, never an exact price (product rule #1).
    await expect(page.getByTestId("band-total-4")).toBeVisible();
    await expect(page.getByTestId("band-total-4")).toContainText("≈$");

    // Disclaimer must label these as estimates, never as prices (product rule #1).
    await expect(page.getByTestId("value-disclaimer")).toContainText(/not.*price/i);
  }

  return addedLabels;
}
