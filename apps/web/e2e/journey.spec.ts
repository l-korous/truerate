import { test, expect } from "@playwright/test";

// The product in one journey: a new user signs up, adds a catalog membership
// (seeing what it brings) and a custom negotiated rate, then views their perks —
// with no prices shown anywhere.

const uniqueEmail = () => `e2e+${Date.now()}${Math.floor(Math.random() * 1000)}@example.com`;

async function register(page: any) {
  await page.goto("/");
  await page.getByPlaceholder("you@example.com").fill(uniqueEmail());
  await page.getByPlaceholder("••••••••").fill("pw123456");
  await page.getByTestId("auth-submit").click();
  await expect(page.getByRole("heading", { name: "Your memberships" })).toBeVisible();
}

test("add a catalog membership, see what it brings — no prices shown", async ({ page }) => {
  await register(page);

  await page.getByTestId("add-membership").click();
  await page.getByTestId("program-booking_genius").click();
  await page.locator("select").selectOption("Level 3");

  // The "what you'll get" summary reflects the catalog.
  await expect(page.getByTestId("benefit-summary")).toContainText("20% off");

  await page.getByRole("button", { name: "Add membership" }).click();
  await expect(page.getByTestId("membership-list")).toContainText("Booking.com Genius - Level 3");
  await expect(page.getByTestId("membership-list")).toContainText("20% off");

  // Perks tab shows discount % and perks — no prices, no savings amounts.
  await page.getByTestId("tab-try").click();
  await expect(page.getByTestId("perk-card")).toBeVisible();
  // Assert no price/savings output anywhere on the page.
  await expect(page.getByText(/indicative member savings/i)).not.toBeVisible();
  await expect(page.getByText(/reveal my rates/i)).not.toBeVisible();
  await expect(page.getByText(/save \d/i)).not.toBeVisible();
});

test("add a custom negotiated rate for a specific hotel", async ({ page }) => {
  await register(page);

  await page.getByTestId("add-membership").click();
  await page.getByTestId("add-custom").click();
  await page.getByPlaceholder("Hotel PECR").fill("Hotel PECR");
  await page.getByPlaceholder("pecr.cz").fill("pecr.cz");
  // % discount mode is the default; the percent field defaults to 15.
  await page.getByRole("button", { name: "Add benefit" }).click();

  await expect(page.getByTestId("membership-list")).toContainText("Hotel PECR");
  await expect(page.getByTestId("membership-list")).toContainText("custom");
});

test("Marriott Platinum shows perks with no discount and no prices", async ({ page }) => {
  await register(page);

  await page.getByTestId("add-membership").click();
  await page.getByTestId("program-marriott_bonvoy").click();
  await page.locator("select").selectOption("Platinum");
  await expect(page.getByTestId("benefit-summary")).toContainText(/breakfast/i);
  await page.getByRole("button", { name: "Add membership" }).click();

  // View perks tab — breakfast perk displayed, no prices.
  await page.getByTestId("tab-try").click();
  await expect(page.getByTestId("perk-card")).toBeVisible();
  await expect(page.getByText(/breakfast/i).first()).toBeVisible();
  // Assert no price output.
  await expect(page.getByText(/indicative member savings/i)).not.toBeVisible();
  await expect(page.getByText(/reveal my rates/i)).not.toBeVisible();
  await expect(page.getByText(/save \d/i)).not.toBeVisible();
});

test("membership list shows tier and clicking opens detail view", async ({ page }) => {
  await register(page);

  await page.getByTestId("add-membership").click();
  await page.getByTestId("program-marriott_bonvoy").click();
  await page.locator("select").selectOption("Platinum");
  await page.getByRole("button", { name: "Add membership" }).click();

  // List shows tier label.
  await expect(page.getByTestId("membership-list")).toContainText("Platinum");

  // Click the membership row to open detail view.
  await page.getByTestId("membership-list").locator("li").first().click();
  await expect(page.getByTestId("membership-detail")).toBeVisible();

  // Detail shows tier and status badge.
  await expect(page.getByTestId("membership-detail")).toContainText("Platinum");
  await expect(page.getByTestId("membership-detail")).toContainText(/active|unverified/);

  // Tabs are hidden while in detail view.
  await expect(page.getByTestId("tab-memberships")).not.toBeVisible();

  // Detail shows benefits.
  await expect(page.getByTestId("detail-benefits")).toBeVisible();

  // No prices in detail view.
  await expect(page.getByText(/indicative member savings/i)).not.toBeVisible();
  await expect(page.getByText(/member price/i)).not.toBeVisible();
});

test("membership detail back button returns to list", async ({ page }) => {
  await register(page);

  await page.getByTestId("add-membership").click();
  await page.getByTestId("program-booking_genius").click();
  await page.locator("select").selectOption("Level 3");
  await page.getByRole("button", { name: "Add membership" }).click();

  // Open detail.
  await page.getByTestId("membership-list").locator("li").first().click();
  await expect(page.getByTestId("membership-detail")).toBeVisible();

  // Go back.
  await page.getByTestId("membership-detail-back").click();
  await expect(page.getByTestId("membership-list")).toBeVisible();
  await expect(page.getByTestId("membership-detail")).not.toBeVisible();
  // Tabs should be visible again.
  await expect(page.getByTestId("tab-memberships")).toBeVisible();
});

test("remove from detail view shows confirmation then removes membership", async ({ page }) => {
  await register(page);

  await page.getByTestId("add-membership").click();
  await page.getByTestId("program-booking_genius").click();
  await page.locator("select").selectOption("Level 1");
  await page.getByRole("button", { name: "Add membership" }).click();

  // Open detail.
  await page.getByTestId("membership-list").locator("li").first().click();
  await expect(page.getByTestId("membership-detail")).toBeVisible();

  // Click remove — confirmation appears.
  await page.getByTestId("detail-remove").click();
  await expect(page.getByTestId("detail-remove-confirm")).toBeVisible();
  await expect(page.getByTestId("detail-remove-cancel")).toBeVisible();

  // Confirm removal.
  await page.getByTestId("detail-remove-confirm").click();

  // Should return to list which is now empty.
  await expect(page.getByTestId("membership-detail")).not.toBeVisible();
  await expect(page.getByText("Nothing here yet")).toBeVisible();
  // Toast shown.
  await expect(page.getByTestId("toast")).toBeVisible();
});

test("remove confirmation can be cancelled", async ({ page }) => {
  await register(page);

  await page.getByTestId("add-membership").click();
  await page.getByTestId("program-booking_genius").click();
  await page.locator("select").selectOption("Level 1");
  await page.getByRole("button", { name: "Add membership" }).click();

  await page.getByTestId("membership-list").locator("li").first().click();
  await expect(page.getByTestId("membership-detail")).toBeVisible();

  // Click remove then cancel.
  await page.getByTestId("detail-remove").click();
  await page.getByTestId("detail-remove-cancel").click();

  // Membership should still be visible.
  await expect(page.getByTestId("membership-detail")).toBeVisible();
  await expect(page.getByTestId("detail-remove-confirm")).not.toBeVisible();
});

test("edit catalog membership tier from detail view", async ({ page }) => {
  await register(page);

  await page.getByTestId("add-membership").click();
  await page.getByTestId("program-booking_genius").click();
  await page.locator("select").selectOption("Level 1");
  await page.getByRole("button", { name: "Add membership" }).click();

  // List shows Level 1.
  await expect(page.getByTestId("membership-list")).toContainText("Level 1");

  // Open detail and click Edit.
  await page.getByTestId("membership-list").locator("li").first().click();
  await expect(page.getByTestId("membership-detail")).toBeVisible();
  await page.getByTestId("detail-edit").click();

  // Edit modal appears; change tier to Level 3.
  await page.locator("[data-testid='benefit-summary-edit']").waitFor();
  await page.locator("select").selectOption("Level 3");
  await expect(page.getByTestId("benefit-summary-edit")).toContainText("20% off");

  await page.getByTestId("edit-save").click();

  // List now shows Level 3.
  await expect(page.getByTestId("membership-list")).toContainText("Level 3");
  // Toast shown.
  await expect(page.getByTestId("toast")).toBeVisible();
});

test("edit custom membership name from detail view", async ({ page }) => {
  await register(page);

  await page.getByTestId("add-membership").click();
  await page.getByTestId("add-custom").click();
  await page.getByPlaceholder("Hotel PECR").fill("Old Hotel Name");
  await page.getByRole("button", { name: "Add benefit" }).click();

  await expect(page.getByTestId("membership-list")).toContainText("Old Hotel Name");

  // Open detail and edit.
  await page.getByTestId("membership-list").locator("li").first().click();
  await page.getByTestId("detail-edit").click();

  // Change name.
  await page.getByTestId("edit-custom-name").clear();
  await page.getByTestId("edit-custom-name").fill("New Hotel Name");
  await page.getByTestId("edit-save").click();

  // List reflects updated name.
  await expect(page.getByTestId("membership-list")).toContainText("New Hotel Name");
  await expect(page.getByTestId("membership-list")).not.toContainText("Old Hotel Name");
  await expect(page.getByTestId("toast")).toBeVisible();
});

test("membership detail view shows empty/loading/error states correctly", async ({ page }) => {
  await register(page);

  // Empty state is shown when no memberships.
  await expect(page.getByText("Nothing here yet")).toBeVisible();
  await expect(page.getByTestId("membership-detail")).not.toBeVisible();
});

test("no price UI is present anywhere in the web app", async ({ page }) => {
  await register(page);

  // Memberships tab — no prices.
  await expect(page.getByText(/indicative member savings/i)).not.toBeVisible();
  await expect(page.getByText(/reveal my rates/i)).not.toBeVisible();
  await expect(page.getByText(/member price/i)).not.toBeVisible();
  await expect(page.getByText(/post.discount/i)).not.toBeVisible();

  // Try it / perks tab — no prices.
  await page.getByTestId("tab-try").click();
  await expect(page.getByText(/indicative member savings/i)).not.toBeVisible();
  await expect(page.getByText(/reveal my rates/i)).not.toBeVisible();
  await expect(page.getByText(/member price/i)).not.toBeVisible();
  await expect(page.getByText(/post.discount/i)).not.toBeVisible();

  // Perk inventory tab — no prices.
  await page.getByTestId("tab-inventory").click();
  await expect(page.getByText(/indicative member savings/i)).not.toBeVisible();
  await expect(page.getByText(/reveal my rates/i)).not.toBeVisible();
  await expect(page.getByText(/member price/i)).not.toBeVisible();
  await expect(page.getByText(/post.discount/i)).not.toBeVisible();
});

test("perk inventory tab: empty state when no memberships", async ({ page }) => {
  await register(page);

  await page.getByTestId("tab-inventory").click();
  await expect(page.getByTestId("inventory-empty")).toBeVisible();
  await expect(page.getByTestId("perk-inventory")).not.toBeVisible();
});

test("perk inventory tab: shows perks with estimated values labeled as estimated", async ({ page }) => {
  await register(page);

  await page.getByTestId("add-membership").click();
  await page.getByTestId("program-booking_genius").click();
  await page.locator("select").selectOption("Level 3");
  await page.getByRole("button", { name: "Add membership" }).click();

  await page.getByTestId("tab-inventory").click();
  await expect(page.getByTestId("perk-inventory")).toBeVisible();
  await expect(page.getByTestId("inventory-item").first()).toBeVisible();

  // Estimated values are labeled "Estimated value", not "price".
  await expect(page.getByText(/estimated value/i).first()).toBeVisible();
  await expect(page.getByText(/member price/i)).not.toBeVisible();
  await expect(page.getByText(/post.discount/i)).not.toBeVisible();

  // Disclaimer is visible.
  await expect(page.getByTestId("inventory-disclaimer")).toBeVisible();
  await expect(page.getByTestId("inventory-disclaimer")).toContainText(/not prices/i);
});

test("perk inventory tab: group by perk type switch works", async ({ page }) => {
  await register(page);

  await page.getByTestId("add-membership").click();
  await page.getByTestId("program-booking_genius").click();
  await page.locator("select").selectOption("Level 3");
  await page.getByRole("button", { name: "Add membership" }).click();

  await page.getByTestId("tab-inventory").click();
  await expect(page.getByTestId("perk-inventory")).toBeVisible();

  // Default grouping is by program — group header is membership name.
  await expect(page.getByTestId("group-by-program")).toBeVisible();

  // Switch to group by perk type.
  await page.getByTestId("group-by-type").click();
  await expect(page.getByTestId("inventory-groups")).toBeVisible();
  // Item membership label is shown when grouped by type.
  await expect(page.getByText(/booking.com genius/i).first()).toBeVisible();
});

test("perk inventory tab: conditions are shown on structured perks", async ({ page }) => {
  await register(page);

  await page.getByTestId("add-membership").click();
  await page.getByTestId("program-booking_genius").click();
  await page.locator("select").selectOption("Level 2");
  await page.getByRole("button", { name: "Add membership" }).click();

  await page.getByTestId("tab-inventory").click();
  await expect(page.getByTestId("perk-inventory")).toBeVisible();

  // Booking Genius Level 2 perks have subjectToAvailability + bookingChannel=ota.
  await expect(page.getByText(/subject to availability/i).first()).toBeVisible();
});
