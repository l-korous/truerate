import { test } from "node:test";
import assert from "node:assert/strict";
import { detectHotelsComPageType, extractHotelsComHotelName, buildHotelsComPageContext, detectOneKeyActive } from "../utils/hotelscom-context.js";
import type { DocLike } from "../utils/hotelscom-context.js";

// --- detectHotelsComPageType -------------------------------------------------

test("detectHotelsComPageType: hotel detail page", () => {
  assert.equal(detectHotelsComPageType("https://www.hotels.com/ho254085/marriott-marquis-new-york.html"), "detail");
});

test("detectHotelsComPageType: detail page with path segments after id", () => {
  assert.equal(detectHotelsComPageType("https://www.hotels.com/ho127666/"), "detail");
});

test("detectHotelsComPageType: search results with .do suffix", () => {
  assert.equal(detectHotelsComPageType("https://www.hotels.com/search.do?q-destination=Prague"), "search");
});

test("detectHotelsComPageType: search results modern URL", () => {
  assert.equal(detectHotelsComPageType("https://www.hotels.com/search?destination=Prague"), "search");
});

test("detectHotelsComPageType: Hotel-Search URL", () => {
  assert.equal(detectHotelsComPageType("https://www.hotels.com/Hotel-Search?destination=Vienna"), "search");
});

test("detectHotelsComPageType: home page is unknown", () => {
  assert.equal(detectHotelsComPageType("https://www.hotels.com/"), "unknown");
});

test("detectHotelsComPageType: non-hotels URL is unknown", () => {
  assert.equal(detectHotelsComPageType("https://www.booking.com/search"), "unknown");
});

test("detectHotelsComPageType: malformed URL is unknown", () => {
  assert.equal(detectHotelsComPageType("not-a-url"), "unknown");
});

test("detectHotelsComPageType: hotels.com without subdomain detail page", () => {
  assert.equal(detectHotelsComPageType("https://hotels.com/ho254085/some-hotel.html"), "detail");
});

test("detectHotelsComPageType: other hotels.com path is unknown", () => {
  assert.equal(detectHotelsComPageType("https://www.hotels.com/about/"), "unknown");
});

// --- extractHotelsComHotelName -----------------------------------------------

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

test("extractHotelsComHotelName: prefers data-stid=content-hotel-title", () => {
  const doc = mockDoc({
    '[data-stid="content-hotel-title"]': "Marriott Marquis New York",
    ".uitk-heading-3": "Old Name",
  });
  assert.equal(extractHotelsComHotelName(doc), "Marriott Marquis New York");
});

test("extractHotelsComHotelName: falls back to hotel-name-text stid", () => {
  const doc = mockDoc({ '[data-stid="hotel-name-text"]': "Hilton Prague" });
  assert.equal(extractHotelsComHotelName(doc), "Hilton Prague");
});

test("extractHotelsComHotelName: falls back to property-header-title testid", () => {
  const doc = mockDoc({ '[data-testid="property-header-title"]': "Conrad Vienna" });
  assert.equal(extractHotelsComHotelName(doc), "Conrad Vienna");
});

test("extractHotelsComHotelName: falls back to hotel-headline testid", () => {
  const doc = mockDoc({ '[data-testid="hotel-headline"]': "W Budapest" });
  assert.equal(extractHotelsComHotelName(doc), "W Budapest");
});

test("extractHotelsComHotelName: falls back to og:title splitting on comma", () => {
  const doc = mockDocWithAttr(
    { 'meta[property="og:title"]': { attr: "Marriott Vienna, Vienna, Austria" } },
    "Marriott Vienna | Hotels.com",
  );
  assert.equal(extractHotelsComHotelName(doc), "Marriott Vienna");
});

test("extractHotelsComHotelName: falls back to page title splitting on pipe", () => {
  const doc = mockDoc({}, "Park Hyatt Vienna | Hotels.com");
  assert.equal(extractHotelsComHotelName(doc), "Park Hyatt Vienna");
});

test("extractHotelsComHotelName: returns undefined when nothing found", () => {
  const doc = mockDoc({}, "");
  assert.equal(extractHotelsComHotelName(doc), undefined);
});

test("extractHotelsComHotelName: trims whitespace from selector result", () => {
  const doc = mockDoc({ '[data-stid="content-hotel-title"]': "  Hilton Vienna  " });
  assert.equal(extractHotelsComHotelName(doc), "Hilton Vienna");
});

// --- buildHotelsComPageContext ------------------------------------------------

test("buildHotelsComPageContext: search page returns only domain", () => {
  const doc = mockDoc({ '[data-stid="content-hotel-title"]': "Some Hotel" });
  const ctx = buildHotelsComPageContext("https://www.hotels.com/search.do?q-destination=Prague", doc);
  assert.deepEqual(ctx, { domain: "hotels.com" });
});

test("buildHotelsComPageContext: unknown page returns only domain", () => {
  const doc = mockDoc({ '[data-stid="content-hotel-title"]': "Some Hotel" });
  const ctx = buildHotelsComPageContext("https://www.hotels.com/about/", doc);
  assert.deepEqual(ctx, { domain: "hotels.com" });
});

test("buildHotelsComPageContext: detail page with hotel name includes property", () => {
  const doc = mockDoc({ '[data-stid="content-hotel-title"]': "Marriott Marquis New York" });
  const ctx = buildHotelsComPageContext("https://www.hotels.com/ho254085/marriott-marquis-new-york.html", doc);
  assert.deepEqual(ctx, { domain: "hotels.com", property: { name: "Marriott Marquis New York" } });
});

test("buildHotelsComPageContext: detail page without hotel name omits property", () => {
  const doc = mockDoc({}, "");
  const ctx = buildHotelsComPageContext("https://www.hotels.com/ho254085/unknown.html", doc);
  assert.deepEqual(ctx, { domain: "hotels.com" });
});

// --- detectOneKeyActive -------------------------------------------------------

function mockDocWithSelectors(present: string[]): DocLike {
  return {
    querySelector(selector: string) {
      if (present.includes(selector)) {
        return { textContent: "One Key", getAttribute: () => null };
      }
      return null;
    },
    title: "",
  };
}

test("detectOneKeyActive: returns false when no One Key signals present", () => {
  const doc = mockDocWithSelectors([]);
  assert.equal(detectOneKeyActive(doc), false);
});

test("detectOneKeyActive: detects one-key-cashback-summary stid", () => {
  const doc = mockDocWithSelectors(['[data-stid="one-key-cashback-summary"]']);
  assert.equal(detectOneKeyActive(doc), true);
});

test("detectOneKeyActive: detects loyalty-cashback stid", () => {
  const doc = mockDocWithSelectors(['[data-stid="loyalty-cashback"]']);
  assert.equal(detectOneKeyActive(doc), true);
});

test("detectOneKeyActive: detects loyalty-member-badge stid", () => {
  const doc = mockDocWithSelectors(['[data-stid="loyalty-member-badge"]']);
  assert.equal(detectOneKeyActive(doc), true);
});

test("detectOneKeyActive: detects one-key-badge stid", () => {
  const doc = mockDocWithSelectors(['[data-stid="one-key-badge"]']);
  assert.equal(detectOneKeyActive(doc), true);
});

test("detectOneKeyActive: detects one-key-member-badge testid", () => {
  const doc = mockDocWithSelectors(['[data-testid="one-key-member-badge"]']);
  assert.equal(detectOneKeyActive(doc), true);
});

test("detectOneKeyActive: detects one-key-cashback testid", () => {
  const doc = mockDocWithSelectors(['[data-testid="one-key-cashback"]']);
  assert.equal(detectOneKeyActive(doc), true);
});

test("detectOneKeyActive: detects onekey-badge CSS class", () => {
  const doc = mockDocWithSelectors(['[class*="onekey-badge"]']);
  assert.equal(detectOneKeyActive(doc), true);
});

test("detectOneKeyActive: detects one-key-badge CSS class", () => {
  const doc = mockDocWithSelectors(['[class*="one-key-badge"]']);
  assert.equal(detectOneKeyActive(doc), true);
});

test("detectOneKeyActive: returns false for unrelated DOM signals", () => {
  const doc = mockDocWithSelectors(['[data-stid="content-hotel-title"]', '[data-testid="search-results"]']);
  assert.equal(detectOneKeyActive(doc), false);
});

test("detectOneKeyActive: returns true when multiple signals present", () => {
  const doc = mockDocWithSelectors([
    '[data-stid="one-key-cashback-summary"]',
    '[data-stid="loyalty-member-badge"]',
  ]);
  assert.equal(detectOneKeyActive(doc), true);
});
