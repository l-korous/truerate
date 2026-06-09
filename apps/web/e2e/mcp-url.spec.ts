import { test, expect } from "@playwright/test";

// MCP URL management journey — McpUrlManager.tsx (apps/web/components/McpUrlManager.tsx).
//
// The MCP tab is the core product surface letting users connect their CustomRates
// vault to Claude Desktop or another AI assistant via a personal MCP URL.
//
// Gap closed: McpUrlManager.tsx had 16.43% line coverage (lines 36-213 entirely
// uncovered). Unit tests only exercise the two pure-function exports
// (buildClaudeDesktopSnippet, formatDate). This file adds e2e coverage for the
// full UI journey: issue → display → one-time notice → reload → rotate → revoke.
//
// Relation to issue #159 / #41:
//   The web driver requirement (synthetic-user harness) includes the MCP tab as
//   part of the complete web channel journey. These tests validate that the
//   integration between the web UI, the API (/me/mcp-url), and the vault
//   state machine works end-to-end.
//
// Product rule #1 (issue #1): the MCP URL and snippet must contain no price
// fields, and the component must never compute or display prices.

const uniqueEmail = () =>
  `e2e-mcp+${Date.now()}+${Math.floor(Math.random() * 1000)}@example.com`;

async function register(page: any) {
  await page.goto("/");
  // Wait for the auth form explicitly so cold-start compilation lag doesn't
  // cause the first fill() to race against a not-yet-hydrated DOM.
  await page.getByPlaceholder("you@example.com").waitFor({ state: "visible" });
  await page.getByPlaceholder("you@example.com").fill(uniqueEmail());
  await page.getByPlaceholder("••••••••").fill("pw123456");
  await page.getByTestId("auth-submit").click();
  await expect(page.getByRole("heading", { name: "Your memberships" })).toBeVisible();
}

async function navigateToMcpTab(page: any) {
  await page.getByTestId("tab-mcp").click();
  await expect(page.getByTestId("mcp-url-manager")).toBeVisible();
}

// ── Initial state ─────────────────────────────────────────────────────────────

test("MCP tab: new user sees Inactive badge and issue button, no URL shown", async ({ page }) => {
  await register(page);
  await navigateToMcpTab(page);

  // Badge says Inactive, issue button present.
  await expect(page.getByTestId("mcp-status-badge")).toContainText("Inactive");
  await expect(page.getByTestId("issue-btn")).toBeVisible();
  await expect(page.getByTestId("issue-btn")).toContainText("Get my MCP URL");

  // No URL, no snippet, no revoke button before anything is issued.
  await expect(page.getByTestId("mcp-url-display")).not.toBeVisible();
  await expect(page.getByTestId("claude-desktop-section")).not.toBeVisible();
  await expect(page.getByTestId("revoke-btn")).not.toBeVisible();
});

// ── Issue flow ────────────────────────────────────────────────────────────────

test("MCP tab: issuing a URL shows Active badge, URL, one-time notice, and Claude Desktop snippet", async ({ page }) => {
  await register(page);
  await navigateToMcpTab(page);

  await page.getByTestId("issue-btn").click();

  // Badge flips to Active.
  await expect(page.getByTestId("mcp-status-badge")).toContainText("Active");

  // URL display appears with a path-form MCP URL.
  await expect(page.getByTestId("mcp-url-display")).toBeVisible();
  const urlText = await page.locator("[data-testid='mcp-url-display'] code").textContent();
  expect(urlText).toMatch(/\/u\/[A-Za-z0-9_-]+\/mcp/);

  // Copy URL button present.
  await expect(page.getByTestId("copy-url-btn")).toBeVisible();

  // One-time notice tells the user to save the URL.
  await expect(page.getByTestId("mcp-one-time-notice")).toBeVisible();
  await expect(page.getByTestId("mcp-one-time-notice")).toContainText(/save this url now/i);

  // Claude Desktop snippet section appears.
  await expect(page.getByTestId("claude-desktop-section")).toBeVisible();
  await expect(page.getByTestId("claude-desktop-snippet")).toBeVisible();
  await expect(page.getByTestId("copy-snippet-btn")).toBeVisible();

  // Snippet is valid JSON with mcpServers.truerate.
  const snippetRaw = await page.getByTestId("claude-desktop-snippet").textContent();
  const parsed = JSON.parse(snippetRaw ?? "{}");
  expect(parsed.mcpServers?.truerate?.command).toBe("npx");
  expect(Array.isArray(parsed.mcpServers?.truerate?.args)).toBe(true);
  expect(parsed.mcpServers?.truerate?.args).toContain("mcp-remote");
  // Snippet args must embed the issued URL.
  expect(parsed.mcpServers?.truerate?.args?.join(" ")).toMatch(/\/u\/[A-Za-z0-9_-]+\/mcp/);

  // Rotate and revoke buttons now appear; issue button becomes rotate.
  await expect(page.getByTestId("rotate-btn")).toBeVisible();
  await expect(page.getByTestId("revoke-btn")).toBeVisible();
});

// ── Product rule #1: no prices in MCP URL surface ────────────────────────────

test("MCP tab: Claude Desktop snippet and URL contain no price-related fields (product rule #1)", async ({ page }) => {
  await register(page);
  await navigateToMcpTab(page);
  await page.getByTestId("issue-btn").click();
  await expect(page.getByTestId("claude-desktop-snippet")).toBeVisible();

  const snippetText = (await page.getByTestId("claude-desktop-snippet").textContent()) ?? "";
  const lower = snippetText.toLowerCase();
  expect(lower).not.toContain("price");
  expect(lower).not.toContain("cost");
  expect(lower).not.toContain("discount");
  expect(lower).not.toContain("member price");
  expect(lower).not.toContain("final price");
  expect(lower).not.toContain("nightly");

  // URL itself must not embed any price segment.
  const urlText = (await page.locator("[data-testid='mcp-url-display'] code").textContent()) ?? "";
  expect(urlText.toLowerCase()).not.toContain("price");
});

// ── Reload: URL hidden, status preserved ─────────────────────────────────────

test("MCP tab: after page reload, status stays Active but raw URL is not re-shown", async ({ page }) => {
  await register(page);
  await navigateToMcpTab(page);
  await page.getByTestId("issue-btn").click();
  await expect(page.getByTestId("mcp-url-display")).toBeVisible();

  // Reload simulates the user returning to the app later.
  await page.reload();
  await expect(page.getByRole("heading", { name: "Your memberships" })).toBeVisible();
  await navigateToMcpTab(page);

  // Status persists as Active via GET /me/mcp-url.
  await expect(page.getByTestId("mcp-status-badge")).toContainText("Active");

  // Raw URL is NOT re-shown (one-time exposure).
  await expect(page.getByTestId("mcp-url-display")).not.toBeVisible();
  await expect(page.getByTestId("mcp-url-hidden")).toBeVisible();
  await expect(page.getByTestId("mcp-url-hidden")).toContainText(/rotate/i);

  // Claude Desktop snippet is also absent (URL unknown after reload).
  await expect(page.getByTestId("claude-desktop-section")).not.toBeVisible();

  // Rotate button available so the user can get a new URL.
  await expect(page.getByTestId("rotate-btn")).toBeVisible();
});

// ── Rotate flow ───────────────────────────────────────────────────────────────

test("MCP tab: rotating the URL issues a fresh URL different from the original", async ({ page }) => {
  await register(page);
  await navigateToMcpTab(page);
  await page.getByTestId("issue-btn").click();
  // Wait for the issue action to fully settle before capturing the URL.
  await expect(page.getByTestId("rotate-btn")).toContainText("Rotate URL");
  await expect(page.getByTestId("mcp-url-display")).toBeVisible();

  const firstUrl = await page.locator("[data-testid='mcp-url-display'] code").textContent();

  await page.getByTestId("rotate-btn").click();

  // Wait for the URL code element to reflect the NEW (different) URL.
  // "Rotate URL" settling again signals the async action has completed.
  await expect(page.getByTestId("rotate-btn")).toContainText("Rotate URL");
  const secondUrl = await page.locator("[data-testid='mcp-url-display'] code").textContent();

  expect(secondUrl).toMatch(/\/u\/[A-Za-z0-9_-]+\/mcp/);
  // Rotation must produce a different token.
  expect(secondUrl).not.toBe(firstUrl);

  // Status still Active; snippet refreshes with the new URL.
  await expect(page.getByTestId("mcp-status-badge")).toContainText("Active");
  await expect(page.getByTestId("claude-desktop-section")).toBeVisible();

  // Snippet embeds the NEW URL, not the old one.
  const snippetRaw = (await page.getByTestId("claude-desktop-snippet").textContent()) ?? "";
  expect(snippetRaw).toContain(secondUrl?.split("/u/")[1]?.split("/mcp")[0] ?? "");
});

// ── Revoke flow ───────────────────────────────────────────────────────────────

test("MCP tab: revoking the URL returns to Inactive state and clears URL and snippet", async ({ page }) => {
  await register(page);
  await navigateToMcpTab(page);
  await page.getByTestId("issue-btn").click();
  // Wait for the issue action to complete before clicking revoke —
  // both buttons are disabled while actionLoading is true.
  await expect(page.getByTestId("rotate-btn")).toContainText("Rotate URL");
  await expect(page.getByTestId("mcp-status-badge")).toContainText("Active");

  await page.getByTestId("revoke-btn").click();

  // Returns to Inactive.
  await expect(page.getByTestId("mcp-status-badge")).toContainText("Inactive");

  // URL and snippet are gone.
  await expect(page.getByTestId("mcp-url-display")).not.toBeVisible();
  await expect(page.getByTestId("claude-desktop-section")).not.toBeVisible();

  // Issue button reappears; revoke and rotate buttons are gone.
  await expect(page.getByTestId("issue-btn")).toBeVisible();
  await expect(page.getByTestId("issue-btn")).toContainText("Get my MCP URL");
  await expect(page.getByTestId("revoke-btn")).not.toBeVisible();
  await expect(page.getByTestId("rotate-btn")).not.toBeVisible();
});
