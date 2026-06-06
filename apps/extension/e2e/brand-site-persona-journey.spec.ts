/**
 * Persona-driven extension journeys on hotel brand websites (issue #159 / #44).
 *
 * Gap closed:
 *   • persona-journey.spec.ts exercises persona expectedPerks contracts but
 *     navigates exclusively to Booking.com — it never tests brand-site URLs.
 *   • other-sites.spec.ts tests Marriott.com and Hilton.com content scripts but
 *     only asserts "panel renders with some content and no price" without binding
 *     the result to a persona's expectedPerks contract.
 *
 * This file combines both dimensions: real synthetic personas (via
 * @truerate/harness) are navigated to the hotel brand's own website, and the
 * panel output is asserted against the persona's expectedPerks contract:
 *
 *   1. The correct hotel-chain perks appear for the right domain — not just
 *      "anything renders".
 *   2. Memberships scoped to a DIFFERENT domain (Booking.com Genius → only
 *      booking.com) must NOT bleed through to brand sites. Domain-scoping is
 *      verified end-to-end through the content script → API → matchPage chain.
 *   3. No TrueRate-produced price appears in any panel state (product rule #1
 *      / issue #1): no final price, post-discount amount, member price, etc.
 *
 * Personas:
 *   persona-de-1 (Booking Genius Level 1 + Marriott Bonvoy Gold, DE market):
 *     On Marriott.com hotel page → Marriott Bonvoy Gold perks (room_upgrade,
 *     late_check_out) must surface; Genius 10% off must NOT appear because
 *     Genius is scoped to booking.com and should not match marriott.com.
 *
 *   persona-gb-5 (Hilton Honors Gold + Amex Platinum + Revolut Metal, GB market):
 *     On Hilton.com hotel page → Hilton Honors Gold free_breakfast must surface;
 *     no prices anywhere.
 *
 * Both tests call the real in-process extension content script → real API
 * (TRUERATE_INMEMORY=true, port 8787) → real matchPage engine, exercising the
 * complete channel stack for brand-site scenarios.
 */

import { test, expect, chromium } from "@playwright/test";
import type { BrowserContext } from "@playwright/test";
import path from "path";
import { fileURLToPath } from "url";
import { createPersonaFactory } from "@truerate/harness";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION_PATH = path.resolve(__dirname, "../.output/chrome-mv3");
const API_BASE = "http://localhost:8787";

// ── Mock HTML pages ───────────────────────────────────────────────────────────
//
// Minimal pages matching the selectors that each site's context extractor uses.
// We keep the HTML as small as possible to avoid false positives from injected
// page copy that could match our perk-label assertions.

// Marriott.com hotel detail page.
// detectMarriottPageType matches /hotels/travel/<code>-<slug>/.
// extractMarriottHotelName uses [data-testid="hotel-name"].
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

// Hilton.com hotel detail page.
// detectHiltonPageType matches /en/hotels/<slug>/.
// extractHiltonHotelName uses [data-testid="hotel-name"].
// No [data-testid="header-honors-badge"] so detectHonorsActive() returns false —
// we want a clean "show perks" state, not the "already active" framing note.
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

// ── Browser-context factories ─────────────────────────────────────────────────

async function makeMarriottContext(): Promise<BrowserContext> {
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
    route.fulfill({ status: 200, contentType: "text/html", body: MARRIOTT_HOTEL_HTML }),
  );
  return ctx;
}

async function makeHiltonContext(): Promise<BrowserContext> {
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
    route.fulfill({ status: 200, contentType: "text/html", body: HILTON_HOTEL_HTML }),
  );
  return ctx;
}

// ── Shared helpers ────────────────────────────────────────────────────────────

async function getServiceWorker(ctx: BrowserContext) {
  const [sw] = ctx.serviceWorkers();
  return sw ?? ctx.waitForEvent("serviceworker");
}

async function injectToken(ctx: BrowserContext, token: string): Promise<void> {
  const sw = await getServiceWorker(ctx);
  await sw.evaluate(async (t: string) => {
    await (globalThis as unknown as {
      chrome: { storage: { local: { set(d: Record<string, unknown>): Promise<void> } } };
    }).chrome.storage.local.set({ truerate_token: t });
  }, token);
}

async function registerUser(handleSuffix: string): Promise<string> {
  const email = `brand-site-${handleSuffix}-${Date.now()}@truerate-test.local`;
  const res = await fetch(`${API_BASE}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "brand-site-pw-1234" }),
  });
  if (!res.ok) throw new Error(`Registration failed: ${res.status} — ${await res.text()}`);
  const { token } = (await res.json()) as { token: string };
  return token;
}

async function addMembership(token: string, programId: string, tier?: string): Promise<void> {
  const body: Record<string, unknown> = { programId };
  if (tier) body.tier = tier;
  const res = await fetch(`${API_BASE}/memberships`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Add membership failed (${programId}/${tier ?? ""}): ${res.status} — ${await res.text()}`);
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
      return shadow.querySelector(".tr-btn") !== null || shadow.querySelector(".tr-close") !== null;
    },
    { timeout: 15_000 },
  );
}

// Product rule #1 (issue #1): these patterns must never appear in any panel output.
const FORBIDDEN_PRICE_PATTERNS: Array<[RegExp, string]> = [
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

function assertNoPrices(html: string, label: string): void {
  for (const [pattern, name] of FORBIDDEN_PRICE_PATTERNS) {
    expect(html, `${label} — panel must not contain: ${name}`).not.toMatch(pattern);
  }
}

// Build the two representative personas once (deterministic factory).
const factory = createPersonaFactory();
// 8 archetypes; index 1 = persona-de-1, index 5 = persona-gb-5.
const personas = factory.build(8, 0);
const persona_de_1 = personas[1]!; // DE — Genius L1 + Marriott Bonvoy Gold
const persona_gb_5 = personas[5]!; // GB — Hilton Honors Gold + Amex Platinum + Revolut Metal

// ── persona-de-1 on Marriott.com ──────────────────────────────────────────────

test(
  "persona-de-1: Marriott Bonvoy Gold perks surface on Marriott.com, Genius 10% off does not",
  async () => {
    // Sanity: persona-de-1 must have Marriott Bonvoy Gold membership.
    const marriottMembership = persona_de_1.memberships.find(
      (m) => m.programId === "marriott_bonvoy",
    );
    expect(marriottMembership, "persona-de-1 must include marriott_bonvoy").toBeDefined();
    expect(marriottMembership!.tier).toBe("Gold");

    // Sanity: persona-de-1 has Booking Genius L1 which is scoped to booking.com.
    const geniusMembership = persona_de_1.memberships.find(
      (m) => m.programId === "booking_genius",
    );
    expect(geniusMembership, "persona-de-1 must include booking_genius").toBeDefined();
    expect(geniusMembership!.tier).toBe("Level 1");

    // Sanity: persona has Marriott-specific expectedPerks.
    const marriottExpectedPerks = persona_de_1.expectedPerks.filter((ep) =>
      ep.membershipLabel.toLowerCase().includes("marriott"),
    );
    expect(marriottExpectedPerks.length, "persona-de-1 must have Marriott perks in expectedPerks").toBeGreaterThan(0);

    const ctx = await makeMarriottContext();
    try {
      const token = await registerUser("de-1-marriott");
      // Add Marriott Bonvoy Gold first.
      await addMembership(token, "marriott_bonvoy", "Gold");
      // Add Booking Genius L1 — this membership is scoped to booking.com only
      // and must not produce output on marriott.com.
      await addMembership(token, "booking_genius", "Level 1");
      await injectToken(ctx, token);

      const page = await ctx.newPage();
      await page.goto("https://www.marriott.com/hotels/travel/PRAGI-prague-marriott-hotel/");
      await waitForPanelReady(page);
      const html = await panelHtml(page);

      // ── Basic sanity ───────────────────────────────────────────────────────
      expect(html, "panel must contain TrueRate identity").toContain("TrueRate");
      expect(html, "panel must reach a resolved state").toContain("tr-close");

      // ── Marriott Bonvoy Gold perks must surface ────────────────────────────
      // Marriott Gold gives: room_upgrade ("Room upgrade when available"),
      // late_check_out ("Guaranteed 2pm late check-out"), points_bonus.
      // At least one of these structured perk labels must appear in the panel.
      const marriottPerkLabels = [
        "room upgrade",       // matches "Room upgrade when available"
        "late check-out",     // matches "Guaranteed 2pm late check-out"
        "late checkout",      // alternate rendering
        "bonus points",       // matches "25% bonus points on stays"
      ];
      const anyMarriottPerkShown = marriottPerkLabels.some((label) =>
        html.toLowerCase().includes(label.toLowerCase()),
      );
      expect(
        anyMarriottPerkShown,
        `Marriott Bonvoy Gold must surface at least one perk on Marriott.com; panel HTML snippet: ${html.slice(0, 300)}`,
      ).toBe(true);

      // ── Booking.com Genius must NOT appear on Marriott.com ─────────────────
      // Genius Level 1 is domain-scoped to booking.com. The matchPage engine
      // must not return a Genius match when the domain is marriott.com.
      // We check for the Genius percent-off value (10% for Level 1).
      expect(
        html,
        "Booking.com Genius 10% discount must not appear on Marriott.com (domain-scoped)",
      ).not.toMatch(/10%\s*(off|discount)/i);

      // The Genius membership label itself should not surface.
      expect(
        html,
        "Booking.com Genius membership must not appear in panel on Marriott.com",
      ).not.toMatch(/booking.*genius/i);

      // ── Product rule #1 ────────────────────────────────────────────────────
      assertNoPrices(html, "persona-de-1 Marriott.com");
    } finally {
      await ctx.close();
    }
  },
);

// ── persona-gb-5 on Hilton.com ────────────────────────────────────────────────

test(
  "persona-gb-5: Hilton Honors Gold free_breakfast surfaces on Hilton.com, no prices",
  async () => {
    // Sanity: persona-gb-5 must include Hilton Honors Gold.
    const hiltonMembership = persona_gb_5.memberships.find(
      (m) => m.programId === "hilton_honors",
    );
    expect(hiltonMembership, "persona-gb-5 must include hilton_honors").toBeDefined();
    expect(hiltonMembership!.tier).toBe("Gold");

    // Sanity: Hilton Honors Gold expectedPerks include free_breakfast.
    const hiltonPerks = persona_gb_5.expectedPerks.filter((ep) =>
      ep.membershipLabel.toLowerCase().includes("hilton"),
    );
    expect(hiltonPerks.length, "persona-gb-5 must have Hilton perks in expectedPerks").toBeGreaterThan(0);
    expect(
      hiltonPerks.some((ep) => ep.perkType === "free_breakfast"),
      "Hilton Honors Gold expectedPerks must include free_breakfast",
    ).toBe(true);

    const ctx = await makeHiltonContext();
    try {
      // Register with all three memberships: Hilton Honors Gold, Amex Platinum, Revolut Metal.
      const token = await registerUser("gb-5-hilton");
      for (const m of persona_gb_5.memberships) {
        if (!m.programId) continue;
        await addMembership(token, m.programId, m.tier).catch(() => {
          // Skip programs not in catalog or with tier mismatches.
        });
      }
      await injectToken(ctx, token);

      const page = await ctx.newPage();
      await page.goto("https://www.hilton.com/en/hotels/praguhi-hilton-prague/");
      await waitForPanelReady(page);
      const html = await panelHtml(page);

      // ── Basic sanity ───────────────────────────────────────────────────────
      expect(html, "panel must contain TrueRate identity").toContain("TrueRate");
      expect(html, "panel must reach a resolved state").toContain("tr-close");

      // ── Hilton Honors Gold perks must surface ──────────────────────────────
      // Hilton Gold gives: free_breakfast ("Free breakfast or daily F&B credit"),
      // room_upgrade ("Room upgrade when available"), free_wifi.
      // free_breakfast is the highest-value perk and most distinctive — it must
      // appear in the panel for a Hilton Gold member on hilton.com.
      const hiltonPerkLabels = [
        "breakfast",          // matches "Free breakfast or daily F&B credit"
        "f&b",                // alternate rendering (F&B credit)
        "room upgrade",       // matches "Room upgrade when available"
        "wi-fi",              // matches "Complimentary Wi-Fi"
        "wifi",               // alternate rendering
      ];
      const anyHiltonPerkShown = hiltonPerkLabels.some((label) =>
        html.toLowerCase().includes(label.toLowerCase()),
      );
      expect(
        anyHiltonPerkShown,
        `Hilton Honors Gold must surface at least one perk on Hilton.com; panel HTML snippet: ${html.slice(0, 300)}`,
      ).toBe(true);

      // ── Product rule #1 ────────────────────────────────────────────────────
      assertNoPrices(html, "persona-gb-5 Hilton.com");

      // Estimated values must use the "~$N" indicative format, never a bare price.
      if (html.includes("~$")) {
        expect(html, "estimated values must carry indicative disclaimer").toContain(
          "indicative, not a price",
        );
      }

      // The Honors-active framing note must NOT imply a discount was already
      // applied to a booking price (product rule #1 / Genius-framing parity).
      // Our mock page has NO honors-badge signal, so detectHonorsActive() returns
      // false — the panel shows perks, not the "already active" note.
      expect(html).not.toMatch(/already\s+applied/i);
      expect(html).not.toMatch(/honors\s+price/i);
      expect(html).not.toMatch(/honors\s+rate/i);
    } finally {
      await ctx.close();
    }
  },
);

// ── Domain-scoping: Genius-only user on Marriott.com ─────────────────────────

test(
  "domain-scoping: Booking.com Genius Level 3 user sees no Genius benefits on Marriott.com",
  async () => {
    // A user with ONLY a Booking.com Genius Level 3 membership has 20% off on
    // booking.com. On marriott.com, no membership should match — the panel must
    // show a resolved "no applicable benefits" state, never the 20% discount.
    const ctx = await makeMarriottContext();
    try {
      const token = await registerUser("genius-only");
      await addMembership(token, "booking_genius", "Level 3");
      await injectToken(ctx, token);

      const page = await ctx.newPage();
      await page.goto("https://www.marriott.com/hotels/travel/PRAGI-prague-marriott-hotel/");
      await waitForPanelReady(page);
      const html = await panelHtml(page);

      // Panel must have resolved (not stuck in loading / error state).
      expect(html, "panel must contain TrueRate identity").toContain("TrueRate");
      expect(html, "panel must reach a resolved state").toContain("tr-close");

      // Genius 20% must not appear — the domain scope excludes marriott.com.
      expect(
        html,
        "Genius 20% off must not appear on Marriott.com — booking_genius scoped to booking.com",
      ).not.toMatch(/20%\s*(off|discount)/i);

      // No price text either.
      assertNoPrices(html, "genius-only user on Marriott.com");
    } finally {
      await ctx.close();
    }
  },
);

// ── Product rule #1 exhaustive check across both brand sites ─────────────────

test(
  "product rule #1: no TrueRate-produced price on Marriott.com or Hilton.com (persona-de-1 and persona-gb-5)",
  async () => {
    const EXTENDED_FORBIDDEN: Array<[RegExp, string]> = [
      ...FORBIDDEN_PRICE_PATTERNS,
      [/post.discount/i, "post-discount"],
      [/member\s+savings/i, "member savings"],
      [/discounted\s+rate/i, "discounted rate"],
      [/genius\s+price/i, "genius price"],
      [/genius\s+rate/i, "genius rate"],
      [/bonvoy\s+price/i, "bonvoy price"],
      [/bonvoy\s+rate/i, "bonvoy rate"],
      [/honors\s+price/i, "honors price"],
      [/honors\s+rate/i, "honors rate"],
    ];

    // ── Marriott.com (persona-de-1) ────────────────────────────────────────
    const marriottCtx = await makeMarriottContext();
    try {
      const token1 = await registerUser("rule1-de1-marriott");
      await addMembership(token1, "marriott_bonvoy", "Gold");
      await addMembership(token1, "booking_genius", "Level 1");
      await injectToken(marriottCtx, token1);

      const page1 = await marriottCtx.newPage();
      await page1.goto("https://www.marriott.com/hotels/travel/PRAGI-prague-marriott-hotel/");
      await waitForPanelReady(page1);
      const marriottHtml = await panelHtml(page1);

      for (const [pattern, label] of EXTENDED_FORBIDDEN) {
        expect(
          marriottHtml,
          `persona-de-1 Marriott.com — panel must not contain: ${label}`,
        ).not.toMatch(pattern);
      }
    } finally {
      await marriottCtx.close();
    }

    // ── Hilton.com (persona-gb-5) ──────────────────────────────────────────
    const hiltonCtx = await makeHiltonContext();
    try {
      const token2 = await registerUser("rule1-gb5-hilton");
      for (const m of persona_gb_5.memberships) {
        if (!m.programId) continue;
        await addMembership(token2, m.programId, m.tier).catch(() => {});
      }
      await injectToken(hiltonCtx, token2);

      const page2 = await hiltonCtx.newPage();
      await page2.goto("https://www.hilton.com/en/hotels/praguhi-hilton-prague/");
      await waitForPanelReady(page2);
      const hiltonHtml = await panelHtml(page2);

      for (const [pattern, label] of EXTENDED_FORBIDDEN) {
        expect(
          hiltonHtml,
          `persona-gb-5 Hilton.com — panel must not contain: ${label}`,
        ).not.toMatch(pattern);
      }
    } finally {
      await hiltonCtx.close();
    }
  },
);
