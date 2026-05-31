import { test, expect } from "@playwright/test";

// The product in one journey: a new user signs up, adds a catalog membership
// (seeing what it brings) and a custom negotiated rate, then reveals the gap
// between anonymous and member pricing — with perks where there's no discount.

const uniqueEmail = () => `e2e+${Date.now()}${Math.floor(Math.random() * 1000)}@example.com`;

async function register(page: any) {
  await page.goto("/");
  await page.getByPlaceholder("you@example.com").fill(uniqueEmail());
  await page.getByPlaceholder("••••••••").fill("pw123456");
  await page.getByTestId("auth-submit").click();
  await expect(page.getByRole("heading", { name: "Your memberships" })).toBeVisible();
}

test("add a catalog membership, see what it brings, then reveal savings", async ({ page }) => {
  await register(page);

  await page.getByTestId("add-membership").click();
  await page.getByTestId("program-booking_genius").click();
  await page.locator("select").selectOption("Level 3");

  // The "what you'll get" summary reflects the catalog.
  await expect(page.getByTestId("benefit-summary")).toContainText("20% off");

  await page.getByRole("button", { name: "Add membership" }).click();
  await expect(page.getByTestId("membership-list")).toContainText("Booking.com Genius - Level 3");
  await expect(page.getByTestId("membership-list")).toContainText("20% off");

  // Reveal rates.
  await page.getByTestId("tab-try").click();
  await page.getByRole("button", { name: "Reveal my rates" }).click();
  await expect(page.getByText("Indicative member savings on this search")).toBeVisible();
  await expect(page.getByText(/save/i).first()).toBeVisible();
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

test("Marriott Platinum shows perks with no discount", async ({ page }) => {
  await register(page);

  await page.getByTestId("add-membership").click();
  await page.getByTestId("program-marriott_bonvoy").click();
  await page.locator("select").selectOption("Platinum");
  await expect(page.getByTestId("benefit-summary")).toContainText(/breakfast/i);
  await page.getByRole("button", { name: "Add membership" }).click();

  await page.getByTestId("tab-try").click();
  await page.getByRole("button", { name: "Reveal my rates" }).click();
  // At least one property should display the breakfast perk.
  await expect(page.getByText(/breakfast/i).first()).toBeVisible();
});
