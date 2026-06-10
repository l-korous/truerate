import { test, expect } from "@playwright/test";

// Admin provider leaderboard (#334) over the usage analytics (#333), behind the
// admin login gate. Seeds usage by driving the API directly, verifies the gate
// blocks unauthenticated access, signs in, then asserts the leaderboard renders,
// filters by country, and never shows prices.

const API = "http://localhost:8787";
const ADMIN_SECRET = "e2e-admin-secret"; // matches playwright.config web/api env

test("admin gate blocks unauthenticated access; leaderboard ranks providers after sign-in (no prices)", async ({ page, request }) => {
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

  // --- Gate: unauthenticated admin API is 401, and the page redirects to login.
  const unauth = await page.request.get("/api/admin/analytics/usage");
  expect(unauth.status()).toBe(401);
  await page.goto("/admin/leaderboard");
  await expect(page).toHaveURL(/\/admin\/login/);

  // --- Sign in (sets the httpOnly cookie in the browser context).
  const login = await page.request.post("/api/admin/login", { data: { secret: ADMIN_SECRET } });
  expect(login.ok()).toBeTruthy();
  // Wrong secret is rejected.
  const bad = await page.request.post("/api/admin/login", { data: { secret: "nope" } });
  expect(bad.status()).toBe(401);

  // --- Authenticated: the leaderboard renders and ranks Booking Genius.
  await page.goto("/admin/leaderboard");
  await expect(page.getByTestId("leaderboard")).toBeVisible();
  await expect(async () => {
    await page.reload();
    await expect(page.getByTestId("leaderboard-list")).toContainText("Booking Genius");
  }).toPass({ timeout: 15_000 });

  // --- No price leak in the ranked rows (counts only).
  const listText = (await page.getByTestId("leaderboard-list").textContent()) ?? "";
  expect(listText).not.toMatch(/[$€]\s?\d/);
  expect(listText).not.toMatch(/member price|save \$?\d/i);

  // --- Country switch: CZ keeps Booking Genius; DE is empty.
  await page.getByTestId("leaderboard-country").selectOption("CZ");
  await expect(page.getByTestId("leaderboard-list")).toContainText("Booking Genius");
  await page.getByTestId("leaderboard-country").selectOption("DE");
  await expect(page.getByTestId("leaderboard-empty")).toBeVisible();
});
