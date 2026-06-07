import { test, expect } from "@playwright/test";

// Admin provider leaderboard (#334) over the usage analytics (#333).
// Seeds usage by driving the API directly (register → add Genius → benefits/match,
// which emits usage events), then asserts the leaderboard renders, filters by
// country, and never shows prices.

const API = "http://localhost:8787";

test("leaderboard ranks most-used providers and filters by country (no prices)", async ({ page, request }) => {
  // --- Seed: a CZ user surfaces Booking Genius benefits via the extension path.
  const email = `lb-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`;
  const reg = await request.post(`${API}/auth/register`, {
    data: { email, password: "pw123456", market: "cz" },
  });
  expect(reg.ok()).toBeTruthy();
  const { token } = (await reg.json()) as { token: string };
  await request.post(`${API}/memberships`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { programId: "booking_genius", tier: "Level 3", attributes: {} },
  });
  await request.post(`${API}/benefits/match`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { domain: "booking.com" },
  });

  // --- Global leaderboard renders and lists Booking Genius.
  await page.goto("/admin/leaderboard");
  await expect(page.getByTestId("leaderboard")).toBeVisible();
  // Usage recording is fire-and-forget; retry a reload until it lands.
  await expect(async () => {
    await page.reload();
    await expect(page.getByTestId("leaderboard-list")).toContainText("Booking Genius");
  }).toPass({ timeout: 15_000 });

  // --- No price leak in the ranked rows (counts only). Allow the "no prices"
  // explanatory copy, but assert no currency-with-amount appears in the list.
  const listText = (await page.getByTestId("leaderboard-list").textContent()) ?? "";
  expect(listText).not.toMatch(/[$€]\s?\d/);
  expect(listText).not.toMatch(/member price|save \$?\d/i);

  // --- Country switch: CZ keeps Booking Genius (the user's market).
  await page.getByTestId("leaderboard-country").selectOption("CZ");
  await expect(page.getByTestId("leaderboard-list")).toContainText("Booking Genius");

  // --- Country switch: DE has no usage → empty state.
  await page.getByTestId("leaderboard-country").selectOption("DE");
  await expect(page.getByTestId("leaderboard-empty")).toBeVisible();
});
