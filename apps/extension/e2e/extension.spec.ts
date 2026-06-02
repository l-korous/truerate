import { test, expect, chromium } from "@playwright/test";
import type { BrowserContext } from "@playwright/test";
import path from "path";
import { fileURLToPath } from "url";

// Extension must be built before these tests run:
//   pnpm --filter @truerate/extension build
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION_PATH = path.resolve(__dirname, "../.output/chrome-mv3");
const API_BASE = "http://localhost:8787";

// --- Mock HTML pages ---------------------------------------------------------
// Minimal HTML that mimics the Booking.com page structures the content script
// expects. The content script fires based on URL match, not actual page content.

const SEARCH_HTML = `<!DOCTYPE html><html lang="en">
<head><title>Hotels in Prague | Booking.com</title></head>
<body><h1>Prague — hotels</h1><p>Search results placeholder.</p></body>
</html>`;

// Hotel detail page uses [data-testid="title"] — the first selector that
// extractHotelName() tries. Adding og:title as a fallback too.
const HOTEL_HTML = `<!DOCTYPE html><html lang="en">
<head>
  <title>Hotel Metropol – Prague | Booking.com</title>
  <meta property="og:title" content="Hotel Metropol, Prague, Czech Republic">
</head>
<body>
  <div data-testid="title">Hotel Metropol</div>
  <p>Central Prague · 4-star hotel</p>
</body>
</html>`;

// --- Context helpers ---------------------------------------------------------

async function makeContext(): Promise<BrowserContext> {
  const ctx = await chromium.launchPersistentContext("", {
    // Setting headless: false makes Playwright select the full Chromium binary
    // instead of Chrome Headless Shell. Chrome Headless Shell does not support
    // extensions. We then pass --headless=new so the full Chromium runs without
    // a display server, while keeping extension support (requires Chromium 112+).
    headless: false,
    args: [
      "--headless=new",
      "--no-sandbox", // required when running as root in CI containers
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
    ],
  });

  // Intercept all booking.com requests and return our mock HTML.
  await ctx.route(/booking\.com/, (route) => {
    const url = route.request().url();
    if (url.includes("/hotel/")) {
      route.fulfill({ status: 200, contentType: "text/html", body: HOTEL_HTML });
    } else if (url.includes("/searchresults")) {
      route.fulfill({ status: 200, contentType: "text/html", body: SEARCH_HTML });
    } else {
      route.abort();
    }
  });

  return ctx;
}

/** Wait for the extension's background service worker and return it. */
async function getServiceWorker(ctx: BrowserContext) {
  const [sw] = ctx.serviceWorkers();
  return sw ?? ctx.waitForEvent("serviceworker");
}

/** Inject a JWT into the extension's storage so the content script sees a signed-in state. */
async function injectToken(ctx: BrowserContext, token: string): Promise<void> {
  const sw = await getServiceWorker(ctx);
  // globalThis cast: chrome is available in the extension service worker execution context
  // but is not typed in the Node.js test module scope.
  await sw.evaluate(async (t: string) => {
    await (globalThis as unknown as { chrome: { storage: { local: { set(d: Record<string, unknown>): Promise<void> } } } }).chrome.storage.local.set({ truerate_token: t });
  }, token);
}

/** Register a new in-memory user and return the JWT. */
async function registerUser(): Promise<string> {
  const email = `ext-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const res = await fetch(`${API_BASE}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "testpass123" }),
  });
  if (!res.ok) throw new Error(`Registration failed: ${res.status} — ${await res.text()}`);
  const { token } = (await res.json()) as { token: string };
  return token;
}

/** Add a catalog membership to the user's vault via the API. */
async function addMembership(token: string, programId: string, tier: string): Promise<void> {
  const res = await fetch(`${API_BASE}/memberships`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ programId, tier }),
  });
  if (!res.ok) throw new Error(`Add membership failed: ${res.status} — ${await res.text()}`);
}

/** Read the TrueRate panel's shadow-root HTML from the page. */
async function panelHtml(page: Awaited<ReturnType<BrowserContext["newPage"]>>): Promise<string> {
  return page.evaluate(() => {
    const host = document.getElementById("truerate-root");
    return host?.shadowRoot?.innerHTML ?? "";
  });
}

/**
 * Wait for the panel to finish loading into its resolved state.
 * #truerate-root is the shadow host — it has zero layout size because the panel
 * inside is position:fixed, so we wait for "attached" not "visible".
 * Loading state shows "Checking your benefits…" with no close button or sign-in link.
 * Resolved states always have either:
 *   - .tr-btn  (signed-out prompt)
 *   - .tr-close (any result: match, no-match, or error with result)
 */
async function waitForPanelReady(page: Awaited<ReturnType<BrowserContext["newPage"]>>): Promise<void> {
  // state "attached" because the host div has zero layout size (fixed-position shadow content).
  await page.waitForSelector("#truerate-root", { state: "attached", timeout: 10_000 });
  await page.waitForFunction(
    () => {
      const host = document.getElementById("truerate-root");
      const shadow = host?.shadowRoot;
      if (!shadow) return false;
      return (
        shadow.querySelector(".tr-btn") !== null ||   // signed-out
        shadow.querySelector(".tr-close") !== null    // any loaded result
      );
    },
    { timeout: 15_000 },
  );
}

// =============================================================================
// Tests
// =============================================================================

test.describe("Panel — search results page", () => {
  let ctx: BrowserContext;

  test.beforeEach(async () => {
    ctx = await makeContext();
  });

  test.afterEach(async () => {
    await ctx.close();
  });

  test("panel attaches on Booking.com search page when signed out", async () => {
    const page = await ctx.newPage();
    await page.goto("https://www.booking.com/searchresults.html?ss=Prague");
    await waitForPanelReady(page);

    const html = await panelHtml(page);
    expect(html).toContain("TrueRate");
    // Signed out → sign-in prompt, never a price
    expect(html).not.toMatch(/final\s+price/i);
    expect(html).not.toMatch(/post.discount/i);
    expect(html).not.toMatch(/member\s+price/i);
  });

  test("panel attaches on Booking.com search page when signed in with Genius L3", async () => {
    const token = await registerUser();
    await addMembership(token, "booking_genius", "Level 3");
    await injectToken(ctx, token);

    const page = await ctx.newPage();
    await page.goto("https://www.booking.com/searchresults.html?ss=Prague");
    await waitForPanelReady(page);

    const html = await panelHtml(page);
    expect(html).toContain("TrueRate");
    expect(html).not.toMatch(/final\s+price/i);
    expect(html).not.toMatch(/post.discount/i);
    expect(html).not.toMatch(/member\s+price/i);
    // NOTE: the panel may legitimately contain "(indicative, not a price)" — the
    // perk-estimates disclaimer. That phrase is correct product behavior. Do NOT
    // assert /indicative.*price/i here; use the specific forbidden-phrase list instead.
  });
});

test.describe("Panel — hotel detail page", () => {
  let ctx: BrowserContext;

  test.beforeEach(async () => {
    ctx = await makeContext();
  });

  test.afterEach(async () => {
    await ctx.close();
  });

  test("panel attaches on Booking.com hotel detail page when signed out", async () => {
    const page = await ctx.newPage();
    await page.goto("https://www.booking.com/hotel/cz/metropol.html");
    await waitForPanelReady(page);

    const html = await panelHtml(page);
    expect(html).toContain("TrueRate");
    // Shows sign-in prompt — no prices
    expect(html).toContain("Sign in");
    expect(html).not.toMatch(/final\s+price/i);
    expect(html).not.toMatch(/post.discount/i);
    expect(html).not.toMatch(/member\s+price/i);
  });

  test("panel shows Genius discount % — no final price (product rule #1)", async () => {
    const token = await registerUser();
    await addMembership(token, "booking_genius", "Level 3");
    await injectToken(ctx, token);

    const page = await ctx.newPage();
    await page.goto("https://www.booking.com/hotel/cz/metropol.html");
    await waitForPanelReady(page);

    const html = await panelHtml(page);
    expect(html).toContain("TrueRate");

    // Genius L3 gives 20% off — shown as a percent, never as a computed price
    expect(html).toMatch(/\d+%\s*off/i);

    // Hard product-rule #1 guardrails.
    // Note: "(indicative, not a price)" is the correct perk-estimate disclaimer and
    // is NOT a violation — do not assert /indicative.*price/ here.
    expect(html).not.toMatch(/final\s+price/i);
    expect(html).not.toMatch(/post.discount/i);
    expect(html).not.toMatch(/member\s+price/i);
    expect(html).not.toMatch(/indicative\s+member\s+(price|savings)/i);
    expect(html).not.toMatch(/total.*\$\d{3,}/i);
    expect(html).not.toMatch(/you\s+save\s+\$\d+/i);
    expect(html).not.toMatch(/nightly\s+rate/i);
    expect(html).not.toMatch(/discounted\s+rate/i);
  });

  test("perk estimates are labeled as estimates — never a computed price", async () => {
    // Genius Level 3 has known perk estimates (e.g. free breakfast) for Booking.com.
    // Marriott perks are intentionally NOT used here — they only match Marriott-branded
    // properties which our generic mock hotel is not.
    const token = await registerUser();
    await addMembership(token, "booking_genius", "Level 3");
    await injectToken(ctx, token);

    const page = await ctx.newPage();
    await page.goto("https://www.booking.com/hotel/cz/metropol.html");
    await waitForPanelReady(page);

    const html = await panelHtml(page);
    expect(html).toContain("TrueRate");

    // When perk estimate values are rendered they use "~$N" (tilde-prefixed) format.
    // "~$" appears ONLY in rendered estimate content, not in the CSS style block.
    if (html.includes("~$")) {
      // Estimated values are tilde-prefixed to signal they are not precise prices.
      expect(html).toMatch(/~\$\d+/);
      // The panel section header explicitly labels these as "(indicative, not a price)".
      // This disclaimer IS correct product behavior — it is not a price violation.
      expect(html).toContain("indicative, not a price");
    }

    // No price strings regardless of whether estimates are shown
    expect(html).not.toMatch(/final\s+price/i);
    expect(html).not.toMatch(/post.discount/i);
    expect(html).not.toMatch(/member\s+price/i);
    expect(html).not.toMatch(/indicative\s+member\s+(price|savings)/i);
  });

  test("no post-discount or final price in any panel state (product rule #1 guardrail)", async () => {
    const token = await registerUser();
    await addMembership(token, "booking_genius", "Level 3");
    await addMembership(token, "marriott_bonvoy", "Platinum");
    await injectToken(ctx, token);

    const page = await ctx.newPage();
    await page.goto("https://www.booking.com/hotel/cz/metropol.html");
    await waitForPanelReady(page);

    const html = await panelHtml(page);

    // Exhaustive list of patterns TrueRate must never produce (per #1)
    const forbidden: Array<[RegExp, string]> = [
      [/final\s+price/i, "final price"],
      [/post.discount/i, "post-discount"],
      [/member\s+price/i, "member price"],
      [/indicative\s+member\s+savings/i, "indicative member savings"],
      [/reveal\s+my\s+rates/i, "reveal my rates"],
      [/save\s+\$\d+/i, "save $N (computed savings)"],
      [/you\s+save\s+\$\d+/i, "you save $N"],
      [/nightly\s+rate\s+\$\d+/i, "nightly rate $N"],
      [/per\s+night.*\$\d+/i, "per night $N"],
    ];
    for (const [pattern, label] of forbidden) {
      expect(html, `Panel must not contain: ${label}`).not.toMatch(pattern);
    }
  });

  test("Genius-framing: panel shows discount % not Genius-applied price", async () => {
    const token = await registerUser();
    await addMembership(token, "booking_genius", "Level 1");
    await injectToken(ctx, token);

    const page = await ctx.newPage();
    await page.goto("https://www.booking.com/hotel/cz/metropol.html");
    await waitForPanelReady(page);

    const html = await panelHtml(page);
    expect(html).toContain("TrueRate");

    // Panel must never imply a discount has already been applied in a booking price.
    // It shows the % discount the user is entitled to, nothing more.
    expect(html).not.toMatch(/already\s+applied/i);
    expect(html).not.toMatch(/genius\s+price/i);
    expect(html).not.toMatch(/genius\s+rate/i);
    expect(html).not.toMatch(/post.discount/i);
    expect(html).not.toMatch(/final\s+price/i);
  });
});
