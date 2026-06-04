import { test } from "node:test";
import assert from "node:assert/strict";
import { detectExpediaPageType, extractExpediaHotelName, buildExpediaPageContext, detectOneKeyExpediaActive } from "../utils/expedia-context.js";
import type { DocLike } from "../utils/expedia-context.js";

// --- detectExpediaPageType ---------------------------------------------------

test("detectExpediaPageType: classic Hotel-Information detail page", () => {
  assert.equal(
    detectExpediaPageType("https://www.expedia.com/Chicago-Hotels-Westin-Michigan-Avenue.h9186.Hotel-Information"),
    "detail",
  );
});

test("detectExpediaPageType: Hotel-Information with query string", () => {
  assert.equal(
    detectExpediaPageType("https://www.expedia.com/Prague-Hotels-Hilton.h12345.Hotel-Information?chkin=2026-07-01"),
    "detail",
  );
});

test("detectExpediaPageType: Hotel-Search search page", () => {
  assert.equal(detectExpediaPageType("https://www.expedia.com/Hotel-Search?destination=Prague"), "search");
});

test("detectExpediaPageType: Hotels landing search page", () => {
  assert.equal(detectExpediaPageType("https://www.expedia.com/Hotels?destination=Vienna"), "search");
});

test("detectExpediaPageType: Hotels with trailing slash", () => {
  assert.equal(detectExpediaPageType("https://www.expedia.com/Hotels/"), "search");
});

test("detectExpediaPageType: home page is unknown", () => {
  assert.equal(detectExpediaPageType("https://www.expedia.com/"), "unknown");
});

test("detectExpediaPageType: non-expedia URL is unknown", () => {
  assert.equal(detectExpediaPageType("https://www.booking.com/hotel/cz/hilton-prague.html"), "unknown");
});

test("detectExpediaPageType: malformed URL is unknown", () => {
  assert.equal(detectExpediaPageType("not-a-url"), "unknown");
});

test("detectExpediaPageType: expedia.com without www subdomain detail page", () => {
  assert.equal(
    detectExpediaPageType("https://expedia.com/Chicago-Hotels-Westin.h9186.Hotel-Information"),
    "detail",
  );
});

test("detectExpediaPageType: expedia.com without www subdomain search page", () => {
  assert.equal(detectExpediaPageType("https://expedia.com/Hotel-Search?destination=Berlin"), "search");
});

test("detectExpediaPageType: Flights page is unknown", () => {
  assert.equal(detectExpediaPageType("https://www.expedia.com/Flights-Search?leg1=from%3APRG"), "unknown");
});

test("detectExpediaPageType: other expedia path is unknown", () => {
  assert.equal(detectExpediaPageType("https://www.expedia.com/lp/b/hotels"), "unknown");
});

// --- extractExpediaHotelName -------------------------------------------------

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

test("extractExpediaHotelName: prefers data-stid=content-hotel-title", () => {
  const doc = mockDoc({
    '[data-stid="content-hotel-title"]': "The Westin Michigan Avenue Chicago",
    ".uitk-heading-3": "Old Name",
  });
  assert.equal(extractExpediaHotelName(doc), "The Westin Michigan Avenue Chicago");
});

test("extractExpediaHotelName: falls back to hotel-name-text stid", () => {
  const doc = mockDoc({ '[data-stid="hotel-name-text"]': "Hilton Prague" });
  assert.equal(extractExpediaHotelName(doc), "Hilton Prague");
});

test("extractExpediaHotelName: falls back to property-header-title testid", () => {
  const doc = mockDoc({ '[data-testid="property-header-title"]': "Conrad Vienna" });
  assert.equal(extractExpediaHotelName(doc), "Conrad Vienna");
});

test("extractExpediaHotelName: falls back to hotel-headline testid", () => {
  const doc = mockDoc({ '[data-testid="hotel-headline"]': "W Budapest" });
  assert.equal(extractExpediaHotelName(doc), "W Budapest");
});

test("extractExpediaHotelName: falls back to og:title splitting on comma", () => {
  const doc = mockDocWithAttr(
    { 'meta[property="og:title"]': { attr: "Marriott Prague, Prague, Czech Republic | Expedia" } },
    "Marriott Prague | Expedia",
  );
  assert.equal(extractExpediaHotelName(doc), "Marriott Prague");
});

test("extractExpediaHotelName: skips og:title starting with expedia", () => {
  const doc = mockDocWithAttr(
    { 'meta[property="og:title"]': { attr: "Expedia Hotels | Find Hotels" } },
    "Park Hyatt Vienna | Expedia",
  );
  assert.equal(extractExpediaHotelName(doc), "Park Hyatt Vienna");
});

test("extractExpediaHotelName: falls back to page title splitting on pipe", () => {
  const doc = mockDoc({}, "Park Hyatt Vienna | Expedia");
  assert.equal(extractExpediaHotelName(doc), "Park Hyatt Vienna");
});

test("extractExpediaHotelName: returns undefined when nothing found", () => {
  const doc = mockDoc({}, "");
  assert.equal(extractExpediaHotelName(doc), undefined);
});

test("extractExpediaHotelName: trims whitespace from selector result", () => {
  const doc = mockDoc({ '[data-stid="content-hotel-title"]': "  Hilton Vienna  " });
  assert.equal(extractExpediaHotelName(doc), "Hilton Vienna");
});

// --- buildExpediaPageContext --------------------------------------------------

test("buildExpediaPageContext: search page returns only domain", () => {
  const doc = mockDoc({ '[data-stid="content-hotel-title"]': "Some Hotel" });
  const ctx = buildExpediaPageContext("https://www.expedia.com/Hotel-Search?destination=Prague", doc);
  assert.deepEqual(ctx, { domain: "expedia.com" });
});

test("buildExpediaPageContext: unknown page returns only domain", () => {
  const doc = mockDoc({ '[data-stid="content-hotel-title"]': "Some Hotel" });
  const ctx = buildExpediaPageContext("https://www.expedia.com/lp/b/hotels", doc);
  assert.deepEqual(ctx, { domain: "expedia.com" });
});

test("buildExpediaPageContext: detail page with hotel name includes property", () => {
  const doc = mockDoc({ '[data-stid="content-hotel-title"]': "The Westin Michigan Avenue Chicago" });
  const ctx = buildExpediaPageContext(
    "https://www.expedia.com/Chicago-Hotels-Westin-Michigan-Avenue.h9186.Hotel-Information",
    doc,
  );
  assert.deepEqual(ctx, { domain: "expedia.com", property: { name: "The Westin Michigan Avenue Chicago" } });
});

test("buildExpediaPageContext: detail page without hotel name omits property", () => {
  const doc = mockDoc({}, "");
  const ctx = buildExpediaPageContext(
    "https://www.expedia.com/Prague-Hotels-Hilton.h12345.Hotel-Information",
    doc,
  );
  assert.deepEqual(ctx, { domain: "expedia.com" });
});

// --- detectOneKeyExpediaActive -----------------------------------------------

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

test("detectOneKeyExpediaActive: returns false when no One Key signals present", () => {
  const doc = mockDocWithSelectors([]);
  assert.equal(detectOneKeyExpediaActive(doc), false);
});

test("detectOneKeyExpediaActive: detects one-key-cashback-summary stid", () => {
  const doc = mockDocWithSelectors(['[data-stid="one-key-cashback-summary"]']);
  assert.equal(detectOneKeyExpediaActive(doc), true);
});

test("detectOneKeyExpediaActive: detects loyalty-cashback stid", () => {
  const doc = mockDocWithSelectors(['[data-stid="loyalty-cashback"]']);
  assert.equal(detectOneKeyExpediaActive(doc), true);
});

test("detectOneKeyExpediaActive: detects loyalty-member-badge stid", () => {
  const doc = mockDocWithSelectors(['[data-stid="loyalty-member-badge"]']);
  assert.equal(detectOneKeyExpediaActive(doc), true);
});

test("detectOneKeyExpediaActive: detects one-key-badge stid", () => {
  const doc = mockDocWithSelectors(['[data-stid="one-key-badge"]']);
  assert.equal(detectOneKeyExpediaActive(doc), true);
});

test("detectOneKeyExpediaActive: detects one-key-member-badge testid", () => {
  const doc = mockDocWithSelectors(['[data-testid="one-key-member-badge"]']);
  assert.equal(detectOneKeyExpediaActive(doc), true);
});

test("detectOneKeyExpediaActive: detects one-key-cashback testid", () => {
  const doc = mockDocWithSelectors(['[data-testid="one-key-cashback"]']);
  assert.equal(detectOneKeyExpediaActive(doc), true);
});

test("detectOneKeyExpediaActive: detects onekey-badge CSS class", () => {
  const doc = mockDocWithSelectors(['[class*="onekey-badge"]']);
  assert.equal(detectOneKeyExpediaActive(doc), true);
});

test("detectOneKeyExpediaActive: detects one-key-badge CSS class", () => {
  const doc = mockDocWithSelectors(['[class*="one-key-badge"]']);
  assert.equal(detectOneKeyExpediaActive(doc), true);
});

test("detectOneKeyExpediaActive: returns false for unrelated DOM signals", () => {
  const doc = mockDocWithSelectors(['[data-stid="content-hotel-title"]', '[data-testid="search-results"]']);
  assert.equal(detectOneKeyExpediaActive(doc), false);
});

test("detectOneKeyExpediaActive: returns true when multiple signals present", () => {
  const doc = mockDocWithSelectors([
    '[data-stid="one-key-cashback-summary"]',
    '[data-stid="loyalty-member-badge"]',
  ]);
  assert.equal(detectOneKeyExpediaActive(doc), true);
});
