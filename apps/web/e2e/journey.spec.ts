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
});
