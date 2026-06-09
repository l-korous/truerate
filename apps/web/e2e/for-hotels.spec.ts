import { test, expect } from "@playwright/test";

// Public "TrueRate for your hotel" demo page (#wow). No auth.

test("for-hotels demo shows platform scale and what an end-user sees for a hotel", async ({ page }) => {
  await page.goto("/for-hotels");

  // Platform-scale strip renders with real numbers.
  await expect(page.getByTestId("platform-stats")).toBeVisible();
  await expect(page.getByTestId("platform-stats")).toContainText("hotels covered");

  // Search a chain → member perks surface.
  await page.getByTestId("hotel-demo-input").fill("Marriott");
  await page.getByTestId("hotel-demo-go").click();
  await expect(page.getByTestId("hotel-demo-result")).toBeVisible();
  await expect(page.getByTestId("demo-perks")).toContainText("Marriott Bonvoy");

  // No hotel price/rate leaks on the page (perk value estimates like "$25" are allowed).
  const body = (await page.locator("body").textContent()) ?? "";
  expect(body).not.toMatch(/nightly|room rate|member price|per room/i);
});
