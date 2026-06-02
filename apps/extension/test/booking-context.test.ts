import { test } from "node:test";
import assert from "node:assert/strict";
import { detectPageType, extractHotelName, buildPageContext, detectGeniusActive } from "../utils/booking-context.js";
import type { DocLike } from "../utils/booking-context.js";

// --- detectPageType ----------------------------------------------------------

test("detectPageType: search results page", () => {
  assert.equal(detectPageType("https://www.booking.com/searchresults.html?ss=Prague"), "search");
});

test("detectPageType: searchresults path without extension", () => {
  assert.equal(detectPageType("https://www.booking.com/searchresults?ss=Vienna"), "search");
});

test("detectPageType: hotel detail page", () => {
  assert.equal(detectPageType("https://www.booking.com/hotel/cz/hilton-prague.html"), "detail");
});

test("detectPageType: hotel detail deep path", () => {
  assert.equal(detectPageType("https://www.booking.com/hotel/at/hotel-sacher-wien.en-gb.html"), "detail");
});

test("detectPageType: home page is unknown", () => {
  assert.equal(detectPageType("https://www.booking.com/"), "unknown");
});

test("detectPageType: other booking page is unknown", () => {
  assert.equal(detectPageType("https://www.booking.com/flights"), "unknown");
});

test("detectPageType: non-booking URL is unknown", () => {
  assert.equal(detectPageType("https://www.hotels.com/searchresults"), "unknown");
});

test("detectPageType: malformed URL is unknown", () => {
  assert.equal(detectPageType("not-a-url"), "unknown");
});

// --- extractHotelName --------------------------------------------------------

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

test("extractHotelName: prefers data-testid=title", () => {
  const doc = mockDoc({
    '[data-testid="title"]': "Grand Hotel Prague",
    "h2.pp-header__title": "Old Hotel Name",
  });
  assert.equal(extractHotelName(doc), "Grand Hotel Prague");
});

test("extractHotelName: falls back to pp-header__title when testid absent", () => {
  const doc = mockDoc({ "h2.pp-header__title": "Hotel Sacher" });
  assert.equal(extractHotelName(doc), "Hotel Sacher");
});

test("extractHotelName: falls back to .pp-header__title class", () => {
  const doc = mockDoc({ ".pp-header__title": "Hotel Vienna" });
  assert.equal(extractHotelName(doc), "Hotel Vienna");
});

test("extractHotelName: falls back to og:title meta when no DOM selectors match", () => {
  const doc = mockDocWithAttr(
    { 'meta[property="og:title"]': { attr: "Hilton Vienna, Austria, Europe" } },
    "Hilton Vienna – Book Now | Booking.com",
  );
  assert.equal(extractHotelName(doc), "Hilton Vienna");
});

test("extractHotelName: falls back to document title split on en-dash", () => {
  const doc = mockDoc({}, "Marriott Budapest – Lowest Rates | Booking.com");
  assert.equal(extractHotelName(doc), "Marriott Budapest");
});

test("extractHotelName: splits title on em-dash but not plain hyphen", () => {
  // Plain hyphen is NOT used as a separator (appears in hotel names like "Four-Seasons")
  const docPlain = mockDoc({}, "Four Seasons Vienna - Book Now | Booking.com");
  assert.equal(extractHotelName(docPlain), "Four Seasons Vienna - Book Now | Booking.com");
  // Em-dash IS a separator in Booking.com's title format
  const docEm = mockDoc({}, "Four Seasons Vienna — Book Now | Booking.com");
  assert.equal(extractHotelName(docEm), "Four Seasons Vienna");
});

test("extractHotelName: returns undefined when nothing found", () => {
  const doc = mockDoc({}, "");
  assert.equal(extractHotelName(doc), undefined);
});

test("extractHotelName: trims whitespace from selector result", () => {
  const doc = mockDoc({ '[data-testid="title"]': "  Hotel Prague  " });
  assert.equal(extractHotelName(doc), "Hotel Prague");
});

// --- buildPageContext ---------------------------------------------------------

test("buildPageContext: search page returns only domain", () => {
  const doc = mockDoc({ '[data-testid="title"]': "Grand Hotel" });
  const ctx = buildPageContext("https://www.booking.com/searchresults.html", doc);
  assert.deepEqual(ctx, { domain: "booking.com" });
});

test("buildPageContext: unknown page returns only domain", () => {
  const doc = mockDoc({ '[data-testid="title"]': "Grand Hotel" });
  const ctx = buildPageContext("https://www.booking.com/", doc);
  assert.deepEqual(ctx, { domain: "booking.com" });
});

test("buildPageContext: detail page with hotel name includes property", () => {
  const doc = mockDoc({ '[data-testid="title"]': "Hilton Prague" });
  const ctx = buildPageContext("https://www.booking.com/hotel/cz/hilton-prague.html", doc);
  assert.deepEqual(ctx, { domain: "booking.com", property: { name: "Hilton Prague" } });
});

test("buildPageContext: detail page without hotel name omits property", () => {
  const doc = mockDoc({}, "");
  const ctx = buildPageContext("https://www.booking.com/hotel/cz/unknown.html", doc);
  assert.deepEqual(ctx, { domain: "booking.com" });
});

// --- detectGeniusActive ------------------------------------------------------

function mockDocWithSelectors(present: string[]): DocLike {
  return {
    querySelector(selector: string) {
      if (present.includes(selector)) {
        return { textContent: "Genius", getAttribute: () => null };
      }
      return null;
    },
    title: "",
  };
}

test("detectGeniusActive: returns false when no Genius signals present", () => {
  const doc = mockDocWithSelectors([]);
  assert.equal(detectGeniusActive(doc), false);
});

test("detectGeniusActive: detects genius-logo data-testid", () => {
  const doc = mockDocWithSelectors(['[data-testid="genius-logo"]']);
  assert.equal(detectGeniusActive(doc), true);
});

test("detectGeniusActive: detects header-genius-logo data-testid", () => {
  const doc = mockDocWithSelectors(['[data-testid="header-genius-logo"]']);
  assert.equal(detectGeniusActive(doc), true);
});

test("detectGeniusActive: detects genius-banner data-testid", () => {
  const doc = mockDocWithSelectors(['[data-testid="genius-banner"]']);
  assert.equal(detectGeniusActive(doc), true);
});

test("detectGeniusActive: detects web-genius-banner data-testid", () => {
  const doc = mockDocWithSelectors(['[data-testid="web-genius-banner"]']);
  assert.equal(detectGeniusActive(doc), true);
});

test("detectGeniusActive: detects genius-badge data-component", () => {
  const doc = mockDocWithSelectors(['[data-component="genius-badge"]']);
  assert.equal(detectGeniusActive(doc), true);
});

test("detectGeniusActive: detects BUI Genius CSS class", () => {
  const doc = mockDocWithSelectors([".bui-header__action-link--genius"]);
  assert.equal(detectGeniusActive(doc), true);
});

test("detectGeniusActive: returns false for unrelated DOM signals", () => {
  const doc = mockDocWithSelectors(['[data-testid="title"]', '[data-testid="property-header"]']);
  assert.equal(detectGeniusActive(doc), false);
});

test("detectGeniusActive: returns true when multiple signals present", () => {
  const doc = mockDocWithSelectors([
    '[data-testid="genius-logo"]',
    '[data-testid="genius-banner"]',
  ]);
  assert.equal(detectGeniusActive(doc), true);
});
