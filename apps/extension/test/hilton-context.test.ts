import { test } from "node:test";
import assert from "node:assert/strict";
import { detectHiltonPageType, extractHiltonHotelName, buildHiltonPageContext, detectHonorsActive } from "../utils/hilton-context.js";
import type { DocLike } from "../utils/hilton-context.js";

// --- detectHiltonPageType ----------------------------------------------------

test("detectHiltonPageType: hotel detail page", () => {
  assert.equal(detectHiltonPageType("https://www.hilton.com/en/hotels/CTAHHHI-hilton-prague-old-town/"), "detail");
});

test("detectHiltonPageType: detail page without trailing slash", () => {
  assert.equal(detectHiltonPageType("https://www.hilton.com/en/hotels/NYCHHWA-waldorf-astoria-new-york"), "detail");
});

test("detectHiltonPageType: search results page", () => {
  assert.equal(detectHiltonPageType("https://www.hilton.com/en/hotels/?locationQuery=Prague&arrivalDate=2026-08-01"), "search");
});

test("detectHiltonPageType: search page without query params", () => {
  assert.equal(detectHiltonPageType("https://www.hilton.com/en/hotels/"), "search");
});

test("detectHiltonPageType: search page without trailing slash", () => {
  assert.equal(detectHiltonPageType("https://www.hilton.com/en/hotels"), "search");
});

test("detectHiltonPageType: homepage is unknown", () => {
  assert.equal(detectHiltonPageType("https://www.hilton.com/"), "unknown");
});

test("detectHiltonPageType: non-hilton URL is unknown", () => {
  assert.equal(detectHiltonPageType("https://www.booking.com/hotel/cz/hilton-prague.html"), "unknown");
});

test("detectHiltonPageType: malformed URL is unknown", () => {
  assert.equal(detectHiltonPageType("not-a-url"), "unknown");
});

test("detectHiltonPageType: hilton.com (no subdomain) detail page", () => {
  assert.equal(detectHiltonPageType("https://hilton.com/en/hotels/CTAHHHI-hilton-prague-old-town/"), "detail");
});

test("detectHiltonPageType: other hilton path is unknown", () => {
  assert.equal(detectHiltonPageType("https://www.hilton.com/en/hilton-honors/"), "unknown");
});

// --- extractHiltonHotelName --------------------------------------------------

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

test("extractHiltonHotelName: prefers data-testid=hotel-name", () => {
  const doc = mockDoc({
    '[data-testid="hotel-name"]': "Hilton Prague Old Town",
    ".hotel-headline": "Old Name",
  });
  assert.equal(extractHiltonHotelName(doc), "Hilton Prague Old Town");
});

test("extractHiltonHotelName: falls back to hotel-details-title testid", () => {
  const doc = mockDoc({ '[data-testid="hotel-details-title"]': "Conrad Vienna" });
  assert.equal(extractHiltonHotelName(doc), "Conrad Vienna");
});

test("extractHiltonHotelName: falls back to hotel-headline class", () => {
  const doc = mockDoc({ ".hotel-headline": "DoubleTree by Hilton Budapest" });
  assert.equal(extractHiltonHotelName(doc), "DoubleTree by Hilton Budapest");
});

test("extractHiltonHotelName: falls back to og:title splitting on comma", () => {
  const doc = mockDocWithAttr(
    { 'meta[property="og:title"]': { attr: "Hilton Vienna, Vienna, Austria" } },
    "Hilton Vienna | Official Site | Hilton",
  );
  assert.equal(extractHiltonHotelName(doc), "Hilton Vienna");
});

test("extractHiltonHotelName: falls back to page title splitting on pipe", () => {
  const doc = mockDoc({}, "Waldorf Astoria New York | Official Site | Hilton");
  assert.equal(extractHiltonHotelName(doc), "Waldorf Astoria New York");
});

test("extractHiltonHotelName: returns undefined when nothing found", () => {
  const doc = mockDoc({}, "");
  assert.equal(extractHiltonHotelName(doc), undefined);
});

test("extractHiltonHotelName: trims whitespace from selector result", () => {
  const doc = mockDoc({ '[data-testid="hotel-name"]': "  Hampton Inn Prague  " });
  assert.equal(extractHiltonHotelName(doc), "Hampton Inn Prague");
});

// --- buildHiltonPageContext ---------------------------------------------------

test("buildHiltonPageContext: search page returns only domain", () => {
  const doc = mockDoc({ '[data-testid="hotel-name"]': "Some Hotel" });
  const ctx = buildHiltonPageContext("https://www.hilton.com/en/hotels/?locationQuery=Vienna", doc);
  assert.deepEqual(ctx, { domain: "hilton.com" });
});

test("buildHiltonPageContext: unknown page returns only domain", () => {
  const doc = mockDoc({ '[data-testid="hotel-name"]': "Some Hotel" });
  const ctx = buildHiltonPageContext("https://www.hilton.com/", doc);
  assert.deepEqual(ctx, { domain: "hilton.com" });
});

test("buildHiltonPageContext: detail page with hotel name includes property", () => {
  const doc = mockDoc({ '[data-testid="hotel-name"]': "Hilton Prague Old Town" });
  const ctx = buildHiltonPageContext("https://www.hilton.com/en/hotels/CTAHHHI-hilton-prague-old-town/", doc);
  assert.deepEqual(ctx, { domain: "hilton.com", property: { name: "Hilton Prague Old Town" } });
});

test("buildHiltonPageContext: detail page without hotel name omits property", () => {
  const doc = mockDoc({}, "");
  const ctx = buildHiltonPageContext("https://www.hilton.com/en/hotels/CTAHHHI-hilton-prague-old-town/", doc);
  assert.deepEqual(ctx, { domain: "hilton.com" });
});

// --- detectHonorsActive ------------------------------------------------------

function mockDocWithSelectors(present: string[]): DocLike {
  return {
    querySelector(selector: string) {
      if (present.includes(selector)) {
        return { textContent: "Honors", getAttribute: () => null };
      }
      return null;
    },
    title: "",
  };
}

test("detectHonorsActive: returns false when no Honors signals present", () => {
  const doc = mockDocWithSelectors([]);
  assert.equal(detectHonorsActive(doc), false);
});

test("detectHonorsActive: detects honors-points data-testid", () => {
  const doc = mockDocWithSelectors(['[data-testid="honors-points"]']);
  assert.equal(detectHonorsActive(doc), true);
});

test("detectHonorsActive: detects user-honors-points data-testid", () => {
  const doc = mockDocWithSelectors(['[data-testid="user-honors-points"]']);
  assert.equal(detectHonorsActive(doc), true);
});

test("detectHonorsActive: detects header-honors-badge data-testid", () => {
  const doc = mockDocWithSelectors(['[data-testid="header-honors-badge"]']);
  assert.equal(detectHonorsActive(doc), true);
});

test("detectHonorsActive: detects honors-member-badge data-testid", () => {
  const doc = mockDocWithSelectors(['[data-testid="honors-member-badge"]']);
  assert.equal(detectHonorsActive(doc), true);
});

test("detectHonorsActive: detects data-honors-tier attribute", () => {
  const doc = mockDocWithSelectors(['[data-honors-tier]']);
  assert.equal(detectHonorsActive(doc), true);
});

test("detectHonorsActive: detects hhonors-member-badge CSS class", () => {
  const doc = mockDocWithSelectors([".hhonors-member-badge"]);
  assert.equal(detectHonorsActive(doc), true);
});

test("detectHonorsActive: detects honors-badge CSS class", () => {
  const doc = mockDocWithSelectors([".honors-badge"]);
  assert.equal(detectHonorsActive(doc), true);
});

test("detectHonorsActive: returns false for unrelated DOM signals", () => {
  const doc = mockDocWithSelectors(['[data-testid="hotel-name"]', '[data-testid="search-results"]']);
  assert.equal(detectHonorsActive(doc), false);
});

test("detectHonorsActive: returns true when multiple signals present", () => {
  const doc = mockDocWithSelectors([
    '[data-testid="honors-points"]',
    '[data-testid="header-honors-badge"]',
  ]);
  assert.equal(detectHonorsActive(doc), true);
});
