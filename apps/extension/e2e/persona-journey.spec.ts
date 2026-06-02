/**
 * Persona-driven Playwright journeys for the extension channel (issue #44).
 *
 * Uses synthetic personas from @truerate/harness to run real browser journeys
 * with the built MV3 extension loaded. Each persona carries an expectedPerks
 * contract that the extension channel driver asserts against: perk labels,
 * condition tags, and estimated-value tiers must match — and no TrueRate-
 * produced price may ever appear (product rule #1, issue #1).
 *
 * Persona selection rationale (same coverage as persona-journey.spec.ts in web):
 *   - persona-cz-0 (Booking.com Genius L2 + Your Prague Hotels): OTA discount
 *     + structured perks with subjectToAvailability conditions.
 *   - persona-de-1 (Booking.com Genius L1 + Marriott Bonvoy Gold): mixed OTA +
 *     hotel-chain; Genius L1 gives 10% off; Marriott Gold adds room upgrade etc.
 *   - persona-sk-6 (Booking.com Genius L3 + Accor All Silver): high Genius
 *     tier (20% off) + Accor Silver perks.
 *
 * The extension context uses Playwright persistent-context with --load-extension
 * pointing at the pre-built .output/chrome-mv3 directory. Booking.com requests
 * are intercepted and fulfilled with minimal mock HTML — no real network calls.
 */

import { test, expect, chromium } from "@playwright/test";
import type { BrowserContext } from "@playwright/test";
import path from "path";
import { fileURLToPath } from "url";
import { createPersonaFactory } from "@truerate/harness";
import { runPersonaExtensionJourney } from "./extension-driver.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION_PATH = path.resolve(__dirname, "../.output/chrome-mv3");

// Minimal hotel detail page that matches the selectors the content script uses.
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

const SEARCH_HTML = `<!DOCTYPE html><html lang="en">
<head><title>Hotels in Prague | Booking.com</title></head>
<body><h1>Prague — hotels</h1><p>Search results placeholder.</p></body>
</html>`;

async function makeExtensionContext(): Promise<BrowserContext> {
  const ctx = await chromium.launchPersistentContext("", {
    headless: false,
    args: [
      "--headless=new",
      "--no-sandbox",
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
    ],
  });

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

// Build representative personas once (factory is deterministic).
// 7 personas → indices 0-6; we use 0 (CZ/OTA), 1 (DE/mixed), 6 (SK/high-Genius).
const factory = createPersonaFactory();
const personas = factory.build(7, 0);
const [persona0, persona1, , , , , persona6] = personas;

// ── persona-cz-0: Booking Genius L2 + Your Prague Hotels ─────────────────────

test("persona-cz-0: Genius L2 + Prague Hotels — extension surfaces perks, no price", async () => {
  const persona = persona0!;

  // Sanity: persona has OTA perks.
  expect(persona.expectedPerks.length).toBeGreaterThan(0);

  const ctx = await makeExtensionContext();
  try {
    const result = await runPersonaExtensionJourney(ctx, persona);

    // At least one membership was registered via API.
    expect(result.addedMembershipCount).toBeGreaterThanOrEqual(1);

    // Panel is present and does not produce a price.
    expect(result.panelHtml).toContain("TrueRate");
    expect(result.panelHtml).not.toMatch(/final\s+price/i);
    expect(result.panelHtml).not.toMatch(/member\s+price/i);
  } finally {
    await ctx.close();
  }
});

// ── persona-de-1: Booking Genius L1 + Marriott Bonvoy Gold ───────────────────

test("persona-de-1: Genius L1 + Marriott Gold — extension shows discount %, no computed price", async () => {
  const persona = persona1!;

  // Sanity: Marriott Gold has structured perks.
  const marriottPerks = persona.expectedPerks.filter((ep) =>
    ep.membershipLabel.toLowerCase().includes("marriott"),
  );
  expect(marriottPerks.length).toBeGreaterThan(0);

  const ctx = await makeExtensionContext();
  try {
    const result = await runPersonaExtensionJourney(ctx, persona);

    expect(result.addedMembershipCount).toBeGreaterThanOrEqual(1);
    expect(result.panelHtml).toContain("TrueRate");
    // Genius L1 → 10% off shown as a percent, never as a computed price.
    expect(result.panelHtml).not.toMatch(/post.discount/i);
    expect(result.panelHtml).not.toMatch(/member\s+price/i);
  } finally {
    await ctx.close();
  }
});

// ── persona-sk-6: Booking Genius L3 + Accor All Silver ───────────────────────

test("persona-sk-6: Genius L3 + Accor Silver — extension shows 20% off, no final price", async () => {
  const persona = persona6!;

  // Genius L3 gives 20% off — highest Booking tier.
  expect(persona.memberships.some((m) => m.tier === "Level 3")).toBe(true);

  const ctx = await makeExtensionContext();
  try {
    const result = await runPersonaExtensionJourney(ctx, persona);

    expect(result.addedMembershipCount).toBeGreaterThanOrEqual(1);
    expect(result.panelHtml).toContain("TrueRate");
    // 20% off must appear as a percent string, never a dollar amount.
    expect(result.panelHtml).toMatch(/20%|Level 3/i);
    expect(result.panelHtml).not.toMatch(/final\s+price/i);
    expect(result.panelHtml).not.toMatch(/nightly\s+rate\s+\$\d+/i);
  } finally {
    await ctx.close();
  }
});

// ── Cross-persona: Genius-framing invariant ───────────────────────────────────

test("Genius framing: panel shows discount % not applied-price for any persona (cz-0 smoke)", async () => {
  const persona = persona0!;

  const ctx = await makeExtensionContext();
  try {
    const result = await runPersonaExtensionJourney(ctx, persona);

    // Must NOT imply a discount has already been applied in a booking price.
    expect(result.panelHtml).not.toMatch(/already\s+applied/i);
    expect(result.panelHtml).not.toMatch(/genius\s+price/i);
    expect(result.panelHtml).not.toMatch(/genius\s+rate/i);
    expect(result.panelHtml).not.toMatch(/post.discount/i);
  } finally {
    await ctx.close();
  }
});

// ── Product rule #1 exhaustive check across all three representative personas ──

test("product rule #1: no TrueRate-produced price in any panel state (all three personas)", async () => {
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

  for (const persona of [persona0!, persona1!, persona6!]) {
    const ctx = await makeExtensionContext();
    try {
      const result = await runPersonaExtensionJourney(ctx, persona);
      for (const [pattern, label] of FORBIDDEN) {
        expect(result.panelHtml, `${persona.handle} — panel must not contain: ${label}`).not.toMatch(pattern);
      }
    } finally {
      await ctx.close();
    }
  }
});
