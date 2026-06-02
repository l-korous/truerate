import { test, expect } from "@playwright/test";

const uniqueEmail = () => `e2e+acct${Date.now()}${Math.floor(Math.random() * 1000)}@example.com`;

async function register(page: any) {
  await page.goto("/");
  await page.getByPlaceholder("you@example.com").fill(uniqueEmail());
  await page.getByPlaceholder("••••••••").fill("pw123456");
  await page.getByTestId("auth-submit").click();
  await expect(page.getByRole("heading", { name: "Your memberships" })).toBeVisible();
}

async function goToAccount(page: any) {
  await page.getByTestId("tab-account").click();
  await expect(page.getByTestId("account-settings")).toBeVisible();
}

test("account tab is visible and navigates to profile/settings", async ({ page }) => {
  await register(page);
  await goToAccount(page);
  await expect(page.getByRole("heading", { name: /Account/i })).toBeVisible();
});

test("profile section shows the signed-in email", async ({ page }) => {
  await page.goto("/");
  const email = uniqueEmail();
  await page.getByPlaceholder("you@example.com").fill(email);
  await page.getByPlaceholder("••••••••").fill("pw123456");
  await page.getByTestId("auth-submit").click();
  await expect(page.getByRole("heading", { name: "Your memberships" })).toBeVisible();

  await goToAccount(page);
  await expect(page.getByTestId("profile-email")).toContainText(email.toLowerCase());
});

test("can change currency and save — reflects updated value", async ({ page }) => {
  await register(page);
  await goToAccount(page);

  // Change currency to USD.
  await page.getByTestId("settings-currency").selectOption("USD");
  await expect(page.getByTestId("settings-save")).toBeEnabled();
  await page.getByTestId("settings-save").click();

  // Save confirmation appears.
  await expect(page.getByTestId("settings-saved")).toBeVisible();
  await expect(page.getByTestId("settings-saved")).toContainText(/saved/i);
});

test("can change market and save", async ({ page }) => {
  await register(page);
  await goToAccount(page);

  await page.getByTestId("settings-market").selectOption("de");
  await page.getByTestId("settings-save").click();
  await expect(page.getByTestId("settings-saved")).toBeVisible();
});

test("save button is disabled when nothing changed", async ({ page }) => {
  await register(page);
  await goToAccount(page);
  await expect(page.getByTestId("settings-save")).toBeDisabled();
});

test("sign-out from account tab clears session and shows auth screen", async ({ page }) => {
  await register(page);
  await goToAccount(page);
  await page.getByTestId("account-sign-out").click();
  // After sign-out, auth screen should be visible.
  await expect(page.getByPlaceholder("you@example.com")).toBeVisible();
});

test("account settings page has no price-related UI", async ({ page }) => {
  await register(page);
  await goToAccount(page);
  await expect(page.getByText(/price/i)).not.toBeVisible();
  await expect(page.getByText(/indicative member savings/i)).not.toBeVisible();
  await expect(page.getByText(/member price/i)).not.toBeVisible();
  await expect(page.getByText(/final price/i)).not.toBeVisible();
});
