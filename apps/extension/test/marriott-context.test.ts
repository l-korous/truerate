import { test } from "node:test";
import assert from "node:assert/strict";
import { detectMarriottPageType, extractMarriottHotelName, buildMarriottPageContext, detectBonvoyActive } from "../utils/marriott-context.js";
import type { DocLike } from "../utils/marriott-context.js";

// --- detectMarriottPageType --------------------------------------------------

test("detectMarriottPageType: hotel travel page (detail)", () => {
  assert.equal(detectMarriottPageType("https://www.marriott.com/hotels/travel/lonmd-london-marriott-hotel-marble-arch/"), "detail");
});

test("detectMarriottPageType: hotel-information page (detail)", () => {
  assert.equal(detectMarriottPageType("https://www.marriott.com/hotels/hotel-information/prahh-prague-marriott-hotel/"), "detail");
});

test("detectMarriottPageType: hotel-overview page (detail)", () => {
  assert.equal(detectMarriottPageType("https://www.marriott.com/hotels/hotel-overview/vienw-the-ritz-carlton-vienna/"), "detail");
});

test("detectMarriottPageType: detail page without trailing slash", () => {
  assert.equal(detectMarriottPageType("https://www.marriott.com/hotels/travel/lonmd-london-marriott-hotel-marble-arch"), "detail");
});

test("detectMarriottPageType: search results page (search/)", () => {
  assert.equal(detectMarriottPageType("https://www.marriott.com/search/default.mi?city=London&countryCode=GB"), "search");
});

test("detectMarriottPageType: search results via /search/ path", () => {
  assert.equal(detectMarriottPageType("https://www.marriott.com/search/findHotels.mi?city=Vienna"), "search");
});

test("detectMarriottPageType: find-hotels search page", () => {
  assert.equal(detectMarriottPageType("https://www.marriott.com/hotels/find-hotels/default.mi?city=Prague"), "search");
});

test("detectMarriottPageType: homepage is unknown", () => {
  assert.equal(detectMarriottPageType("https://www.marriott.com/"), "unknown");
});

test("detectMarriottPageType: non-marriott URL is unknown", () => {
  assert.equal(detectMarriottPageType("https://www.hilton.com/en/hotels/"), "unknown");
});

test("detectMarriottPageType: malformed URL is unknown", () => {
  assert.equal(detectMarriottPageType("not-a-url"), "unknown");
});

test("detectMarriottPageType: marriott.com (no subdomain) detail page", () => {
  assert.equal(detectMarriottPageType("https://marriott.com/hotels/travel/lonmd-london-marriott-hotel-marble-arch/"), "detail");
});

test("detectMarriottPageType: loyalty program page is unknown", () => {
  assert.equal(detectMarriottPageType("https://www.marriott.com/loyalty.mi"), "unknown");
});

// --- extractMarriottHotelName ------------------------------------------------

function mockDoc(elements: Record<string, string | undefined>, title = ""): DocLike {
  return {
    querySelector(selector: string) {
      const text = elements[selector];
      if (text === undefined) return null;
      return { textContent: text, getAttribute: () => null };
    },
    title,
  };
}

function mockDocWithAttr(
  attrElements: Record<string, { attr?: string; text?: string }>,
  title = "",
): DocLike {
  return {
    querySelector(selector: string) {
      const entry = attrElements[selector];
      if (!entry) return null;
      return {
        textContent: entry.text ?? null,
        getAttribute: (name: string) => (name === "content" ? (entry.attr ?? null) : null),
      };
    },
    title,
  };
}

test("extractMarriottHotelName: prefers data-testid=hotel-name", () => {
  const doc = mockDoc({
    '[data-testid="hotel-name"]': "Prague Marriott Hotel",
    "h1.propertyName": "Old Name",
  });
  assert.equal(extractMarriottHotelName(doc), "Prague Marriott Hotel");
});

test("extractMarriottHotelName: falls back to property-name testid", () => {
  const doc = mockDoc({ '[data-testid="property-name"]': "The Ritz-Carlton Vienna" });
  assert.equal(extractMarriottHotelName(doc), "The Ritz-Carlton Vienna");
});

test("extractMarriottHotelName: falls back to hotel-details-name testid", () => {
  const doc = mockDoc({ '[data-testid="hotel-details-name"]': "Sheraton Grand London Park Lane" });
  assert.equal(extractMarriottHotelName(doc), "Sheraton Grand London Park Lane");
});

test("extractMarriottHotelName: falls back to propertyName h1 class", () => {
  const doc = mockDoc({ "h1.propertyName": "W Paris - Opéra" });
  assert.equal(extractMarriottHotelName(doc), "W Paris - Opéra");
});

test("extractMarriottHotelName: falls back to og:title splitting on comma", () => {
  const doc = mockDocWithAttr(
    { 'meta[property="og:title"]': { attr: "Prague Marriott Hotel, Prague, Czech Republic" } },
    "Prague Marriott Hotel | Marriott",
  );
  assert.equal(extractMarriottHotelName(doc), "Prague Marriott Hotel");
});

test("extractMarriottHotelName: og:title skips if starts with marriott", () => {
  const doc = mockDocWithAttr(
    { 'meta[property="og:title"]': { attr: "Marriott Hotels | Explore Our Brands" } },
    "Hotels | Marriott",
  );
  // og:title starts with "Marriott", so it falls through to page title
  assert.equal(extractMarriottHotelName(doc), "Hotels");
});

test("extractMarriottHotelName: falls back to page title splitting on pipe", () => {
  const doc = mockDoc({}, "Westin Palace Madrid | Marriott");
  assert.equal(extractMarriottHotelName(doc), "Westin Palace Madrid");
});

test("extractMarriottHotelName: returns undefined when nothing found", () => {
  const doc = mockDoc({}, "");
  assert.equal(extractMarriottHotelName(doc), undefined);
});

test("extractMarriottHotelName: trims whitespace from selector result", () => {
  const doc = mockDoc({ '[data-testid="hotel-name"]': "  Courtyard by Marriott Prague  " });
  assert.equal(extractMarriottHotelName(doc), "Courtyard by Marriott Prague");
});

// --- buildMarriottPageContext -------------------------------------------------

test("buildMarriottPageContext: search page returns only domain", () => {
  const doc = mockDoc({ '[data-testid="hotel-name"]': "Some Hotel" });
  const ctx = buildMarriottPageContext("https://www.marriott.com/search/default.mi?city=London", doc);
  assert.deepEqual(ctx, { domain: "marriott.com" });
});

test("buildMarriottPageContext: unknown page returns only domain", () => {
  const doc = mockDoc({ '[data-testid="hotel-name"]': "Some Hotel" });
  const ctx = buildMarriottPageContext("https://www.marriott.com/", doc);
  assert.deepEqual(ctx, { domain: "marriott.com" });
});

test("buildMarriottPageContext: detail page with hotel name includes property", () => {
  const doc = mockDoc({ '[data-testid="hotel-name"]': "Prague Marriott Hotel" });
  const ctx = buildMarriottPageContext("https://www.marriott.com/hotels/travel/prahh-prague-marriott-hotel/", doc);
  assert.deepEqual(ctx, { domain: "marriott.com", property: { name: "Prague Marriott Hotel" } });
});

test("buildMarriottPageContext: detail page without hotel name omits property", () => {
  const doc = mockDoc({}, "");
  const ctx = buildMarriottPageContext("https://www.marriott.com/hotels/travel/prahh-prague-marriott-hotel/", doc);
  assert.deepEqual(ctx, { domain: "marriott.com" });
});

// --- detectBonvoyActive ------------------------------------------------------

function mockDocWithSelectors(present: string[]): DocLike {
  return {
    querySelector(selector: string) {
      if (present.includes(selector)) {
        return { textContent: "Bonvoy", getAttribute: () => null };
      }
      return null;
    },
    title: "",
  };
}

test("detectBonvoyActive: returns false when no Bonvoy signals present", () => {
  const doc = mockDocWithSelectors([]);
  assert.equal(detectBonvoyActive(doc), false);
});

test("detectBonvoyActive: detects bonvoy-member-badge data-testid", () => {
  const doc = mockDocWithSelectors(['[data-testid="bonvoy-member-badge"]']);
  assert.equal(detectBonvoyActive(doc), true);
});

test("detectBonvoyActive: detects member-rate-badge data-testid", () => {
  const doc = mockDocWithSelectors(['[data-testid="member-rate-badge"]']);
  assert.equal(detectBonvoyActive(doc), true);
});

test("detectBonvoyActive: detects bonvoy-points-summary data-testid", () => {
  const doc = mockDocWithSelectors(['[data-testid="bonvoy-points-summary"]']);
  assert.equal(detectBonvoyActive(doc), true);
});

test("detectBonvoyActive: detects user-bonvoy-points data-testid", () => {
  const doc = mockDocWithSelectors(['[data-testid="user-bonvoy-points"]']);
  assert.equal(detectBonvoyActive(doc), true);
});

test("detectBonvoyActive: detects bonvoy-tier-badge data-testid", () => {
  const doc = mockDocWithSelectors(['[data-testid="bonvoy-tier-badge"]']);
  assert.equal(detectBonvoyActive(doc), true);
});

test("detectBonvoyActive: detects data-bonvoy-tier attribute", () => {
  const doc = mockDocWithSelectors(["[data-bonvoy-tier]"]);
  assert.equal(detectBonvoyActive(doc), true);
});

test("detectBonvoyActive: detects bonvoy-member-badge CSS class", () => {
  const doc = mockDocWithSelectors([".bonvoy-member-badge"]);
  assert.equal(detectBonvoyActive(doc), true);
});

test("detectBonvoyActive: detects member-rate-badge CSS class", () => {
  const doc = mockDocWithSelectors([".member-rate-badge"]);
  assert.equal(detectBonvoyActive(doc), true);
});

test("detectBonvoyActive: detects t-member-badge CSS class", () => {
  const doc = mockDocWithSelectors([".t-member-badge"]);
  assert.equal(detectBonvoyActive(doc), true);
});

test("detectBonvoyActive: returns false for unrelated DOM signals", () => {
  const doc = mockDocWithSelectors(['[data-testid="hotel-name"]', '[data-testid="search-results"]']);
  assert.equal(detectBonvoyActive(doc), false);
});

test("detectBonvoyActive: returns true when multiple signals present", () => {
  const doc = mockDocWithSelectors([
    '[data-testid="bonvoy-member-badge"]',
    '[data-testid="bonvoy-points-summary"]',
  ]);
  assert.equal(detectBonvoyActive(doc), true);
});
