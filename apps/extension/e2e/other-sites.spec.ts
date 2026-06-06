import { test, expect, chromium } from "@playwright/test";
import type { BrowserContext } from "@playwright/test";
import path from "path";
import { fileURLToPath } from "url";

// Extension e2e tests for Hotels.com, Hilton.com, Marriott.com, and Expedia.com
// content scripts.
//
// Gap closed: apps/extension/e2e/ only covers Booking.com. Four other content
// scripts (hilton.content.ts, hotelscom.content.ts, marriott.content.ts,
// expedia.content.ts) are exercised exclusively at the unit level
// (context-extraction helpers). This file verifies the full browser-side journey
// on each site:
//   1. URL pattern matching fires the right content script.
//   2. The shadow-DOM panel injects and resolves without crashing.
//   3. Signed-out state shows the sign-in prompt, never a price.
//   4. Signed-in state with a relevant membership shows perks — not prices.
//   5. Site-specific "already active" loyalty notes render correctly and
//      never imply a discount has been applied to a booking price (product rule #1 / issue #1).
//
// Sites covered:
//   Hilton.com   — hilton.content.ts   — Hilton Honors membership
//   Hotels.com   — hotelscom.content.ts — (generic; no Hotels.com-specific catalog program)
//   Marriott.com — marriott.content.ts  — Marriott Bonvoy membership
//   Expedia.com  — expedia.content.ts   — Hotels.com One Key loyalty; One Key active detection

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION_PATH = path.resolve(__dirname, "../.output/chrome-mv3");
const API_BASE = "http://localhost:8787";

// ── Mock HTML ──────────────────────────────────────────────────────────────────

// Hilton.com — search results page (pathname /en/hotels/)
const HILTON_SEARCH_HTML = `<!DOCTYPE html><html lang="en">
<head><title>Hotels in Prague | Hilton</title></head>
<body><h1>Search results</h1><p>Showing hotels in Prague.</p></body>
</html>`;

// Hilton.com — property detail page (pathname /en/hotels/<slug>/)
// [data-testid="hotel-name"] is the primary selector for extractHiltonHotelName().
const HILTON_HOTEL_HTML = `<!DOCTYPE html><html lang="en">
<head>
  <title>Hilton Prague | Official Site | Hilton</title>
  <meta property="og:title" content="Hilton Prague, Prague, Czech Republic">
</head>
<body>
  <h1 data-testid="hotel-name">Hilton Prague</h1>
  <p>4-star hotel · Old Town</p>
</body>
</html>`;

// Hilton.com — property detail page with a Hilton Honors DOM signal.
// [data-testid="header-honors-badge"] triggers detectHonorsActive().
const HILTON_HONORS_HOTEL_HTML = `<!DOCTYPE html><html lang="en">
<head>
  <title>Hilton Prague | Official Site | Hilton</title>
  <meta property="og:title" content="Hilton Prague, Prague, Czech Republic">
</head>
<body>
  <h1 data-testid="hotel-name">Hilton Prague</h1>
  <div data-testid="header-honors-badge" aria-label="Hilton Honors">Gold member</div>
  <p>4-star hotel · Old Town</p>
</body>
</html>`;

// Hotels.com — search results page (pathname /search.do)
const HOTELS_SEARCH_HTML = `<!DOCTYPE html><html lang="en">
<head><title>Hotels in Prague | Hotels.com</title></head>
<body><h1>Search results</h1><p>Showing hotels in Prague.</p></body>
</html>`;

// Hotels.com — property detail page (pathname /ho<digits>/)
// [data-stid="content-hotel-title"] is the primary selector for extractHotelsComHotelName().
const HOTELS_HOTEL_HTML = `<!DOCTYPE html><html lang="en">
<head>
  <title>Marriott Prague | Hotels.com</title>
  <meta property="og:title" content="Marriott Prague, Prague, Czech Republic">
</head>
<body>
  <h1 data-stid="content-hotel-title">Marriott Prague</h1>
  <p>4-star hotel · Wenceslas Square</p>
</body>
</html>`;

// Marriott.com — search results page (pathname /search/default.mi)
const MARRIOTT_SEARCH_HTML = `<!DOCTYPE html><html lang="en">
<head><title>Find Hotels | Marriott</title></head>
<body><h1>Search results</h1><p>Showing Marriott properties.</p></body>
</html>`;

// Marriott.com — property detail page (pathname /hotels/travel/<code>-<slug>/)
// [data-testid="hotel-name"] is the primary selector for extractMarriottHotelName().
const MARRIOTT_HOTEL_HTML = `<!DOCTYPE html><html lang="en">
<head>
  <title>Prague Marriott Hotel | Prague | Marriott</title>
  <meta property="og:title" content="Prague Marriott Hotel, Prague, Czech Republic">
</head>
<body>
  <h1 data-testid="hotel-name">Prague Marriott Hotel</h1>
  <p>5-star hotel · City Centre</p>
</body>
</html>`;

// Marriott.com — property detail page with a Bonvoy member DOM signal.
// [data-testid="bonvoy-member-badge"] triggers detectBonvoyActive().
const MARRIOTT_BONVOY_HOTEL_HTML = `<!DOCTYPE html><html lang="en">
<head>
  <title>Prague Marriott Hotel | Prague | Marriott</title>
  <meta property="og:title" content="Prague Marriott Hotel, Prague, Czech Republic">
</head>
<body>
  <h1 data-testid="hotel-name">Prague Marriott Hotel</h1>
  <div data-testid="bonvoy-member-badge" aria-label="Bonvoy Gold Elite">Bonvoy Gold</div>
  <p>5-star hotel · City Centre</p>
</body>
</html>`;

// ── Context factories ──────────────────────────────────────────────────────────

type MockHiltonPage = "search" | "hotel" | "honors-hotel";
type MockHotelsPage = "search" | "hotel";
type MockMarriottPage = "search" | "hotel" | "bonvoy-hotel";

function htmlForHilton(page: MockHiltonPage): string {
  if (page === "honors-hotel") return HILTON_HONORS_HOTEL_HTML;
  if (page === "hotel") return HILTON_HOTEL_HTML;
  return HILTON_SEARCH_HTML;
}
function urlForHilton(page: MockHiltonPage): string {
  if (page === "search") return "https://www.hilton.com/en/hotels/";
  return "https://www.hilton.com/en/hotels/praguhi-hilton-prague/";
}

function htmlForHotels(page: MockHotelsPage): string {
  return page === "hotel" ? HOTELS_HOTEL_HTML : HOTELS_SEARCH_HTML;
}
function urlForHotels(page: MockHotelsPage): string {
  if (page === "hotel") return "https://www.hotels.com/ho123456/marriott-prague.html";
  return "https://www.hotels.com/search.do?q=Prague";
}

function htmlForMarriott(page: MockMarriottPage): string {
  if (page === "bonvoy-hotel") return MARRIOTT_BONVOY_HOTEL_HTML;
  if (page === "hotel") return MARRIOTT_HOTEL_HTML;
  return MARRIOTT_SEARCH_HTML;
}
function urlForMarriott(page: MockMarriottPage): string {
  if (page === "search") return "https://www.marriott.com/search/default.mi";
  return "https://www.marriott.com/hotels/travel/PRAGI-prague-marriott-hotel/";
}

async function makeHiltonContext(page: MockHiltonPage): Promise<BrowserContext> {
  const ctx = await chromium.launchPersistentContext("", {
    headless: false,
    args: [
      "--headless=new",
      "--no-sandbox",
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
    ],
  });
  await ctx.route(/hilton\.com/, (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: htmlForHilton(page) }),
  );
  return ctx;
}

async function makeHotelsContext(page: MockHotelsPage): Promise<BrowserContext> {
  const ctx = await chromium.launchPersistentContext("", {
    headless: false,
    args: [
      "--headless=new",
      "--no-sandbox",
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
    ],
  });
  await ctx.route(/hotels\.com/, (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: htmlForHotels(page) }),
  );
  return ctx;
}

async function makeMarriottContext(page: MockMarriottPage): Promise<BrowserContext> {
  const ctx = await chromium.launchPersistentContext("", {
    headless: false,
    args: [
      "--headless=new",
      "--no-sandbox",
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
    ],
  });
  await ctx.route(/marriott\.com/, (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: htmlForMarriott(page) }),
  );
  return ctx;
}

// ── Shared helpers (mirror extension.spec.ts) ──────────────────────────────────

async function getServiceWorker(ctx: BrowserContext) {
  const [sw] = ctx.serviceWorkers();
  return sw ?? ctx.waitForEvent("serviceworker");
}

async function injectToken(ctx: BrowserContext, token: string): Promise<void> {
  const sw = await getServiceWorker(ctx);
  await sw.evaluate(async (t: string) => {
    await (globalThis as unknown as { chrome: { storage: { local: { set(d: Record<string, unknown>): Promise<void> } } } }).chrome.storage.local.set({ truerate_token: t });
  }, token);
}

async function registerUser(): Promise<string> {
  const email = `other-sites-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const res = await fetch(`${API_BASE}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "testpass123" }),
  });
  if (!res.ok) throw new Error(`Registration failed: ${res.status} — ${await res.text()}`);
  const { token } = (await res.json()) as { token: string };
  return token;
}

async function addMembership(token: string, programId: string, tier: string): Promise<void> {
  const res = await fetch(`${API_BASE}/memberships`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ programId, tier }),
  });
  if (!res.ok) throw new Error(`Add membership failed: ${res.status} — ${await res.text()}`);
}

async function panelHtml(page: Awaited<ReturnType<BrowserContext["newPage"]>>): Promise<string> {
  return page.evaluate(() => {
    const host = document.getElementById("truerate-root");
    return host?.shadowRoot?.innerHTML ?? "";
  });
}

async function waitForPanelReady(page: Awaited<ReturnType<BrowserContext["newPage"]>>): Promise<void> {
  await page.waitForSelector("#truerate-root", { state: "attached", timeout: 10_000 });
  await page.waitForFunction(
    () => {
      const host = document.getElementById("truerate-root");
      const shadow = host?.shadowRoot;
      if (!shadow) return false;
      return (
        shadow.querySelector(".tr-btn") !== null ||
        shadow.querySelector(".tr-close") !== null
      );
    },
    { timeout: 15_000 },
  );
}

// Product rule #1 (issue #1): patterns that must never appear in any panel output.
const FORBIDDEN: Array<[RegExp, string]> = [
  [/final\s+price/i, "final price"],
  [/post.discount/i, "post-discount"],
  [/member\s+price/i, "member price"],
  [/indicative\s+member\s+savings/i, "indicative member savings"],
  [/reveal\s+my\s+rates/i, "reveal my rates"],
  [/save\s+\$\d+/i, "save $N"],
  [/you\s+save\s+\$\d+/i, "you save $N"],
  [/nightly\s+rate\s+\$\d+/i, "nightly rate $N"],
  [/per\s+night.*\$\d+/i, "per night $N"],
];

function assertNoPriceViolations(html: string, site: string): void {
  for (const [pattern, label] of FORBIDDEN) {
    expect(html, `${site} panel must not contain: ${label}`).not.toMatch(pattern);
  }
}

// =============================================================================
// Hilton.com tests
// =============================================================================

test.describe("Hilton.com — hilton.content.ts", () => {
  test("panel attaches on Hilton.com search page when signed out", async () => {
    const ctx = await makeHiltonContext("search");
    try {
      const page = await ctx.newPage();
      await page.goto(urlForHilton("search"));
      await waitForPanelReady(page);

      const html = await panelHtml(page);
      expect(html).toContain("TrueRate");
      // Signed out → sign-in prompt
      expect(html).toContain("Sign in");
      assertNoPriceViolations(html, "Hilton search (signed out)");
    } finally {
      await ctx.close();
    }
  });

  test("Hilton Honors Gold member on property detail page sees benefits — no price (product rule #1)", async () => {
    const ctx = await makeHiltonContext("hotel");
    try {
      const token = await registerUser();
      await addMembership(token, "hilton_honors", "Gold");
      await injectToken(ctx, token);

      const page = await ctx.newPage();
      await page.goto(urlForHilton("hotel"));
      await waitForPanelReady(page);

      const html = await panelHtml(page);
      expect(html).toContain("TrueRate");

      // Panel must be in a resolved result state (close button present).
      expect(html).toContain("tr-close");

      // Hilton Honors Gold gives perks on hilton.com — at least one should surface.
      // Either a % discount, perk label, or the active-membership footer.
      const hasContent =
        /\d+%\s*off/i.test(html) ||
        /hilton\s*honors/i.test(html) ||
        html.includes("tr-discounts") ||
        html.includes("tr-perks") ||
        html.includes("tr-estimates");
      expect(hasContent).toBe(true);

      // Estimated values use "~$N" format; the disclaimer must accompany them.
      if (html.includes("~$")) {
        expect(html).toMatch(/~\$\d+/);
        expect(html).toContain("indicative, not a price");
      }

      assertNoPriceViolations(html, "Hilton detail (Honors Gold)");
    } finally {
      await ctx.close();
    }
  });

  test("Honors-active DOM signal: panel shows .tr-honors-note, never implies discount already applied", async () => {
    const ctx = await makeHiltonContext("honors-hotel");
    try {
      const token = await registerUser();
      await addMembership(token, "hilton_honors", "Gold");
      await injectToken(ctx, token);

      const page = await ctx.newPage();
      await page.goto(urlForHilton("hotel"));
      await waitForPanelReady(page);

      const html = await panelHtml(page);
      expect(html).toContain("TrueRate");

      // detectHonorsActive() found the badge → panel must show the Honors note.
      expect(html).toContain("tr-honors-note");

      // The note must never imply a price was already applied (product rule #1 / Genius-framing parity).
      expect(html).not.toMatch(/already\s+applied/i);
      expect(html).not.toMatch(/honors\s+price/i);
      expect(html).not.toMatch(/honors\s+rate/i);
      assertNoPriceViolations(html, "Hilton detail (Honors active)");
    } finally {
      await ctx.close();
    }
  });
});

// =============================================================================
// Hotels.com tests
// =============================================================================

test.describe("Hotels.com — hotelscom.content.ts", () => {
  test("panel attaches on Hotels.com search page when signed out", async () => {
    const ctx = await makeHotelsContext("search");
    try {
      const page = await ctx.newPage();
      await page.goto(urlForHotels("search"));
      await waitForPanelReady(page);

      const html = await panelHtml(page);
      expect(html).toContain("TrueRate");
      expect(html).toContain("Sign in");
      assertNoPriceViolations(html, "Hotels.com search (signed out)");
    } finally {
      await ctx.close();
    }
  });

  test("panel resolves on Hotels.com property detail page when signed in — no price regardless of match", async () => {
    // Hotels.com has no dedicated catalog program; a Booking Genius user will
    // see a no-benefits result on hotels.com. The test verifies the content
    // script does not crash and never shows a price in either state.
    const ctx = await makeHotelsContext("hotel");
    try {
      const token = await registerUser();
      await addMembership(token, "booking_genius", "Level 3");
      await injectToken(ctx, token);

      const page = await ctx.newPage();
      await page.goto(urlForHotels("hotel"));
      await waitForPanelReady(page);

      const html = await panelHtml(page);
      expect(html).toContain("TrueRate");

      // Panel must reach a resolved state (close button present, not stuck loading).
      expect(html).toContain("tr-close");

      assertNoPriceViolations(html, "Hotels.com detail (signed in)");
    } finally {
      await ctx.close();
    }
  });
});

// =============================================================================
// Marriott.com tests
// =============================================================================

test.describe("Marriott.com — marriott.content.ts", () => {
  test("panel attaches on Marriott.com search page when signed out", async () => {
    const ctx = await makeMarriottContext("search");
    try {
      const page = await ctx.newPage();
      await page.goto(urlForMarriott("search"));
      await waitForPanelReady(page);

      const html = await panelHtml(page);
      expect(html).toContain("TrueRate");
      expect(html).toContain("Sign in");
      assertNoPriceViolations(html, "Marriott search (signed out)");
    } finally {
      await ctx.close();
    }
  });

  test("Marriott Bonvoy Gold member on property detail page sees benefits — perk estimates are never prices", async () => {
    const ctx = await makeMarriottContext("hotel");
    try {
      const token = await registerUser();
      await addMembership(token, "marriott_bonvoy", "Gold");
      await injectToken(ctx, token);

      const page = await ctx.newPage();
      await page.goto(urlForMarriott("hotel"));
      await waitForPanelReady(page);

      const html = await panelHtml(page);
      expect(html).toContain("TrueRate");

      // Panel must be in a resolved result state.
      expect(html).toContain("tr-close");

      // Marriott Bonvoy Gold gives perks on marriott.com (room upgrade, late check-out, etc.)
      const hasContent =
        /\d+%\s*off/i.test(html) ||
        /marriott\s*bonvoy/i.test(html) ||
        html.includes("tr-discounts") ||
        html.includes("tr-perks") ||
        html.includes("tr-estimates");
      expect(hasContent).toBe(true);

      // Perk estimate values use tilde format and must never be presented as prices.
      if (html.includes("~$")) {
        expect(html).toMatch(/~\$\d+/);
        expect(html).toContain("indicative, not a price");
      }

      assertNoPriceViolations(html, "Marriott detail (Bonvoy Gold)");
    } finally {
      await ctx.close();
    }
  });

  test("Bonvoy-active DOM signal: panel shows .tr-bonvoy-note, never implies discount already applied", async () => {
    const ctx = await makeMarriottContext("bonvoy-hotel");
    try {
      const token = await registerUser();
      await addMembership(token, "marriott_bonvoy", "Gold");
      await injectToken(ctx, token);

      const page = await ctx.newPage();
      await page.goto(urlForMarriott("hotel"));
      await waitForPanelReady(page);

      const html = await panelHtml(page);
      expect(html).toContain("TrueRate");

      // detectBonvoyActive() found the badge → panel must show the Bonvoy note.
      expect(html).toContain("tr-bonvoy-note");

      // The note must never imply a price was already applied.
      expect(html).not.toMatch(/already\s+applied/i);
      expect(html).not.toMatch(/bonvoy\s+price/i);
      expect(html).not.toMatch(/bonvoy\s+rate/i);
      assertNoPriceViolations(html, "Marriott detail (Bonvoy active)");
    } finally {
      await ctx.close();
    }
  });
});

// ── Expedia.com HTML pages ─────────────────────────────────────────────────────

// Expedia.com — hotel search results page (pathname /Hotel-Search)
const EXPEDIA_SEARCH_HTML = `<!DOCTYPE html><html lang="en">
<head><title>Hotels in Prague | Expedia</title></head>
<body><h1>Search results</h1><p>Showing hotels in Prague.</p></body>
</html>`;

// Expedia.com — property detail page (pathname /<slug>.h<digits>.Hotel-Information)
// [data-stid="content-hotel-title"] is the primary selector for extractExpediaHotelName().
const EXPEDIA_HOTEL_HTML = `<!DOCTYPE html><html lang="en">
<head>
  <title>Hilton Prague | Expedia</title>
  <meta property="og:title" content="Hilton Prague, Prague, Czech Republic">
</head>
<body>
  <h1 data-stid="content-hotel-title">Hilton Prague</h1>
  <p>5-star hotel · Old Town</p>
</body>
</html>`;

// Expedia.com — property detail page with an active One Key loyalty session.
// [data-stid="loyalty-member-badge"] triggers detectOneKeyExpediaActive().
const EXPEDIA_ONEKEY_HOTEL_HTML = `<!DOCTYPE html><html lang="en">
<head>
  <title>Hilton Prague | Expedia</title>
  <meta property="og:title" content="Hilton Prague, Prague, Czech Republic">
</head>
<body>
  <h1 data-stid="content-hotel-title">Hilton Prague</h1>
  <div data-stid="loyalty-member-badge" aria-label="One Key Gold">One Key Gold member</div>
  <p>5-star hotel · Old Town</p>
</body>
</html>`;

type MockExpediaPage = "search" | "hotel" | "onekey-hotel";

function htmlForExpedia(page: MockExpediaPage): string {
  if (page === "onekey-hotel") return EXPEDIA_ONEKEY_HOTEL_HTML;
  if (page === "hotel") return EXPEDIA_HOTEL_HTML;
  return EXPEDIA_SEARCH_HTML;
}

function urlForExpedia(page: MockExpediaPage): string {
  if (page === "search") return "https://www.expedia.com/Hotel-Search?destination=Prague";
  return "https://www.expedia.com/Prague-Hotels-Hilton.h12345.Hotel-Information";
}

async function makeExpediaContext(page: MockExpediaPage): Promise<BrowserContext> {
  const ctx = await chromium.launchPersistentContext("", {
    headless: false,
    args: [
      "--headless=new",
      "--no-sandbox",
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
    ],
  });
  await ctx.route(/expedia\.com/, (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: htmlForExpedia(page) }),
  );
  return ctx;
}

// =============================================================================
// Expedia.com tests
// =============================================================================

test.describe("Expedia.com — expedia.content.ts", () => {
  test("panel attaches on Expedia.com Hotel-Search page when signed out", async () => {
    const ctx = await makeExpediaContext("search");
    try {
      const page = await ctx.newPage();
      await page.goto(urlForExpedia("search"));
      await waitForPanelReady(page);

      const html = await panelHtml(page);
      expect(html).toContain("TrueRate");
      // Signed out → sign-in prompt, never a price.
      expect(html).toContain("Sign in");
      assertNoPriceViolations(html, "Expedia search (signed out)");
    } finally {
      await ctx.close();
    }
  });

  test("panel resolves on Expedia.com property detail page when signed in — no price regardless of match", async () => {
    // Expedia is part of Expedia Group (One Key programme). The catalog program
    // hotels_com_one_key currently matches hotels.com domain, not expedia.com.
    // This test verifies the content script resolves gracefully (no crash, no
    // stuck-loading state) and never outputs a price — the same contract as the
    // Hotels.com test with Booking Genius.
    const ctx = await makeExpediaContext("hotel");
    try {
      const token = await registerUser();
      await addMembership(token, "hotels_com_one_key", "Gold");
      await injectToken(ctx, token);

      const page = await ctx.newPage();
      await page.goto(urlForExpedia("hotel"));
      await waitForPanelReady(page);

      const html = await panelHtml(page);
      expect(html).toContain("TrueRate");

      // Panel must reach a resolved state (close button present, not stuck loading).
      expect(html).toContain("tr-close");

      assertNoPriceViolations(html, "Expedia detail (signed in)");
    } finally {
      await ctx.close();
    }
  });

  test("One Key active DOM signal: panel shows .tr-onekey-expedia-note, never implies discount already applied", async () => {
    // detectOneKeyExpediaActive() looks for loyalty-member-badge / one-key-badge
    // DOM signals. When found, expedia.content.ts injects a .tr-onekey-expedia-note
    // — the same Genius-framing pattern used on Booking.com and Hilton.com.
    // The note must never imply a member price has already been applied (product rule #1 / issue #1).
    const ctx = await makeExpediaContext("onekey-hotel");
    try {
      const token = await registerUser();
      await addMembership(token, "hotels_com_one_key", "Gold");
      await injectToken(ctx, token);

      const page = await ctx.newPage();
      await page.goto(urlForExpedia("onekey-hotel"));
      await waitForPanelReady(page);

      const html = await panelHtml(page);
      expect(html).toContain("TrueRate");

      // detectOneKeyExpediaActive() found the badge → panel must show the One Key note.
      expect(html).toContain("tr-onekey-expedia-note");

      // The note must never imply a member price was already applied to the listing.
      expect(html).not.toMatch(/already\s+applied/i);
      expect(html).not.toMatch(/one\s*key\s+price/i);
      expect(html).not.toMatch(/one\s*key\s+rate/i);
      assertNoPriceViolations(html, "Expedia detail (One Key active)");
    } finally {
      await ctx.close();
    }
  });
});

// ── Trivago HTML pages ─────────────────────────────────────────────────────────

// Trivago — search results page (pathname /en-US/srl/...)
const TRIVAGO_SEARCH_HTML = `<!DOCTYPE html><html lang="en">
<head><title>Hotels in Prague | trivago</title></head>
<body><h1>Search results</h1><p>Showing hotels in Prague.</p></body>
</html>`;

// Trivago — hotel detail page (pathname /en-US/odr/...)
// [data-testid="item-name"] is the primary selector for extractTrivagoHotelName().
const TRIVAGO_HOTEL_HTML = `<!DOCTYPE html><html lang="en">
<head>
  <title>Marriott Prague | trivago</title>
  <meta property="og:title" content="Marriott Prague, Prague | trivago">
</head>
<body>
  <h1 data-testid="item-name">Marriott Prague</h1>
  <p>5-star hotel · City Centre</p>
</body>
</html>`;

// Trivago — hotel detail page as a metasearch: partner booking links are present.
// The metasearch note must always render because Trivago is inherently a
// price aggregator (detectTrivagoMetasearchActive always returns true).
const TRIVAGO_METASEARCH_HOTEL_HTML = `<!DOCTYPE html><html lang="en">
<head>
  <title>Marriott Prague | trivago</title>
  <meta property="og:title" content="Marriott Prague, Prague | trivago">
</head>
<body>
  <h1 data-testid="item-name">Marriott Prague</h1>
  <a href="https://www.booking.com/hotel/cz/marriott-prague.html" class="deal-link">Book on Booking.com</a>
  <p>5-star hotel · City Centre</p>
</body>
</html>`;

type MockTrivagoPage = "search" | "hotel" | "metasearch-hotel";

function htmlForTrivago(page: MockTrivagoPage): string {
  if (page === "metasearch-hotel") return TRIVAGO_METASEARCH_HOTEL_HTML;
  if (page === "hotel") return TRIVAGO_HOTEL_HTML;
  return TRIVAGO_SEARCH_HTML;
}

function urlForTrivago(page: MockTrivagoPage): string {
  if (page === "search") return "https://www.trivago.com/en-US/srl/hotel?search%5Bdestination_name%5D=Prague";
  return "https://www.trivago.com/en-US/odr/hotel/marriott-prague";
}

async function makeTrivagoContext(page: MockTrivagoPage): Promise<BrowserContext> {
  const ctx = await chromium.launchPersistentContext("", {
    headless: false,
    args: [
      "--headless=new",
      "--no-sandbox",
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
    ],
  });
  await ctx.route(/trivago\.com/, (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: htmlForTrivago(page) }),
  );
  return ctx;
}

// =============================================================================
// Trivago.com tests
// =============================================================================

test.describe("Trivago.com — trivago.content.ts", () => {
  test("panel attaches on Trivago search results page when signed out", async () => {
    const ctx = await makeTrivagoContext("search");
    try {
      const page = await ctx.newPage();
      await page.goto(urlForTrivago("search"));
      await waitForPanelReady(page);

      const html = await panelHtml(page);
      expect(html).toContain("TrueRate");
      // Signed out → sign-in prompt, never a price.
      expect(html).toContain("Sign in");
      assertNoPriceViolations(html, "Trivago search (signed out)");
    } finally {
      await ctx.close();
    }
  });

  test("panel resolves on Trivago hotel detail page when signed in — no price (product rule #1)", async () => {
    const ctx = await makeTrivagoContext("hotel");
    try {
      const token = await registerUser();
      await addMembership(token, "booking_genius", "Level 3");
      await injectToken(ctx, token);

      const page = await ctx.newPage();
      await page.goto(urlForTrivago("hotel"));
      await waitForPanelReady(page);

      const html = await panelHtml(page);
      expect(html).toContain("TrueRate");

      // Panel must reach a resolved state (close button present, not stuck loading).
      expect(html).toContain("tr-close");

      assertNoPriceViolations(html, "Trivago detail (signed in)");
    } finally {
      await ctx.close();
    }
  });

  test("metasearch note always renders on Trivago and never implies a discount is already applied", async () => {
    // detectTrivagoMetasearchActive() always returns true because Trivago is
    // always a metasearch aggregator. The panel must always show the metasearch
    // note so users are not misled about whether OTA loyalty discounts are baked
    // into listed prices (product rule #1 / issue #1).
    const ctx = await makeTrivagoContext("metasearch-hotel");
    try {
      const token = await registerUser();
      await addMembership(token, "booking_genius", "Level 3");
      await injectToken(ctx, token);

      const page = await ctx.newPage();
      await page.goto(urlForTrivago("metasearch-hotel"));
      await waitForPanelReady(page);

      const html = await panelHtml(page);
      expect(html).toContain("TrueRate");

      // Metasearch-awareness note must be present.
      expect(html).toContain("tr-trivago-metasearch-note");

      // The note must never imply TrueRate applied or computed a final price.
      expect(html).not.toMatch(/already\s+applied/i);
      expect(html).not.toMatch(/trivago\s+price/i);
      expect(html).not.toMatch(/trivago\s+rate/i);
      assertNoPriceViolations(html, "Trivago detail (metasearch note)");
    } finally {
      await ctx.close();
    }
  });
});
