import { test } from "node:test";
import assert from "node:assert/strict";
import { detectPageType, extractHotelName, buildPageContext, detectOneKeyActive } from "../utils/expedia-context.js";
import type { DocLike } from "../utils/expedia-context.js";

// --- detectPageType ----------------------------------------------------------

test("detectPageType: Hotel-Search page", () => {
  assert.equal(detectPageType("https://www.expedia.com/Hotel-Search?destination=Prague"), "search");
});

test("detectPageType: Hotels path", () => {
  assert.equal(detectPageType("https://www.expedia.com/Hotels?destination=Vienna"), "search");
});

test("detectPageType: hotel detail page (.h<id>.Hotel-Information)", () => {
  assert.equal(detectPageType("https://www.expedia.com/Prague-Hotels-Hilton-Prague.h52145.Hotel-Information"), "detail");
});

test("detectPageType: hotel detail with query string", () => {
  assert.equal(detectPageType("https://www.expedia.com/Vienna-Hotels-Sacher.h9876.Hotel-Information?chkin=2026-08-01"), "detail");
});

test("detectPageType: home page is unknown", () => {
  assert.equal(detectPageType("https://www.expedia.com/"), "unknown");
});

test("detectPageType: flights page is unknown", () => {
  assert.equal(detectPageType("https://www.expedia.com/Flights"), "unknown");
});

test("detectPageType: non-expedia URL is unknown", () => {
  assert.equal(detectPageType("https://www.booking.com/Hotel-Search"), "unknown");
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

test("extractHotelName: prefers data-stid=content-hotel-title", () => {
  const doc = mockDoc({
    "[data-stid=\"content-hotel-title\"]": "Hilton Prague",
    ".uitk-heading-3": "Old Name",
  });
  assert.equal(extractHotelName(doc), "Hilton Prague");
});

test("extractHotelName: falls back to data-testid=property-name", () => {
  const doc = mockDoc({ "[data-testid=\"property-name\"]": "Marriott Vienna" });
  assert.equal(extractHotelName(doc), "Marriott Vienna");
});

test("extractHotelName: falls back to data-testid=hotel-name", () => {
  const doc = mockDoc({ "[data-testid=\"hotel-name\"]": "Grand Hotel Budapest" });
  assert.equal(extractHotelName(doc), "Grand Hotel Budapest");
});

test("extractHotelName: falls back to .uitk-heading-3", () => {
  const doc = mockDoc({ ".uitk-heading-3": "Hotel Sacher Vienna" });
  assert.equal(extractHotelName(doc), "Hotel Sacher Vienna");
});

test("extractHotelName: falls back to og:title without Expedia suffix", () => {
  const doc = mockDocWithAttr(
    { 'meta[property="og:title"]': { attr: "Hilton Vienna, Austria | Expedia" } },
    "Hilton Vienna - Hotels - Expedia",
  );
  assert.equal(extractHotelName(doc), "Hilton Vienna");
});

test("extractHotelName: og:title with only one segment and no Expedia is accepted", () => {
  const doc = mockDocWithAttr(
    { 'meta[property="og:title"]': { attr: "Hotel Roma" } },
    "",
  );
  assert.equal(extractHotelName(doc), "Hotel Roma");
});

test("extractHotelName: falls back to document title split on hyphen", () => {
  const doc = mockDoc({}, "Marriott Budapest - Hotels - Expedia");
  assert.equal(extractHotelName(doc), "Marriott Budapest");
});

test("extractHotelName: returns undefined when nothing found", () => {
  const doc = mockDoc({}, "");
  assert.equal(extractHotelName(doc), undefined);
});

test("extractHotelName: trims whitespace from selector result", () => {
  const doc = mockDoc({ "[data-stid=\"content-hotel-title\"]": "  Hotel Prague  " });
  assert.equal(extractHotelName(doc), "Hotel Prague");
});

// --- buildPageContext ---------------------------------------------------------

test("buildPageContext: search page returns only domain", () => {
  const doc = mockDoc({ "[data-stid=\"content-hotel-title\"]": "Grand Hotel" });
  const ctx = buildPageContext("https://www.expedia.com/Hotel-Search?destination=Prague", doc);
  assert.deepEqual(ctx, { domain: "expedia.com" });
});

test("buildPageContext: unknown page returns only domain", () => {
  const doc = mockDoc({ "[data-stid=\"content-hotel-title\"]": "Grand Hotel" });
  const ctx = buildPageContext("https://www.expedia.com/", doc);
  assert.deepEqual(ctx, { domain: "expedia.com" });
});

test("buildPageContext: detail page with hotel name includes property", () => {
  const doc = mockDoc({ "[data-stid=\"content-hotel-title\"]": "Hilton Prague" });
  const ctx = buildPageContext("https://www.expedia.com/Prague-Hotels-Hilton.h52145.Hotel-Information", doc);
  assert.deepEqual(ctx, { domain: "expedia.com", property: { name: "Hilton Prague" } });
});

test("buildPageContext: detail page without hotel name omits property", () => {
  const doc = mockDoc({}, "");
  const ctx = buildPageContext("https://www.expedia.com/Prague-Hotels-Hilton.h52145.Hotel-Information", doc);
  assert.deepEqual(ctx, { domain: "expedia.com" });
});

// --- detectOneKeyActive ------------------------------------------------------

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

test("detectOneKeyActive: detects one-key-banner data-stid", () => {
  const doc = mockDocWithSelectors(["[data-stid=\"one-key-banner\"]"]);
  assert.equal(detectOneKeyActive(doc), true);
});

test("detectOneKeyActive: detects one-key-banner data-testid", () => {
  const doc = mockDocWithSelectors(["[data-testid=\"one-key-banner\"]"]);
  assert.equal(detectOneKeyActive(doc), true);
});

test("detectOneKeyActive: detects member-price-badge data-testid", () => {
  const doc = mockDocWithSelectors(["[data-testid=\"member-price-badge\"]"]);
  assert.equal(detectOneKeyActive(doc), true);
});

test("detectOneKeyActive: detects member-price-badge data-stid", () => {
  const doc = mockDocWithSelectors(["[data-stid=\"member-price-badge\"]"]);
  assert.equal(detectOneKeyActive(doc), true);
});

test("detectOneKeyActive: detects one-key-logo data-testid", () => {
  const doc = mockDocWithSelectors(["[data-testid=\"one-key-logo\"]"]);
  assert.equal(detectOneKeyActive(doc), true);
});

test("detectOneKeyActive: detects loyalty-bar data-stid", () => {
  const doc = mockDocWithSelectors(["[data-stid=\"loyalty-bar\"]"]);
  assert.equal(detectOneKeyActive(doc), true);
});

test("detectOneKeyActive: detects uitk-loyalty-bar class", () => {
  const doc = mockDocWithSelectors([".uitk-loyalty-bar"]);
  assert.equal(detectOneKeyActive(doc), true);
});

test("detectOneKeyActive: returns false for unrelated DOM signals", () => {
  const doc = mockDocWithSelectors(["[data-stid=\"content-hotel-title\"]", "[data-testid=\"property-name\"]"]);
  assert.equal(detectOneKeyActive(doc), false);
});

test("detectOneKeyActive: returns true when multiple signals present", () => {
  const doc = mockDocWithSelectors([
    "[data-testid=\"one-key-banner\"]",
    "[data-testid=\"member-price-badge\"]",
  ]);
  assert.equal(detectOneKeyActive(doc), true);
});
