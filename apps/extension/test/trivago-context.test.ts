import { test } from "node:test";
import assert from "node:assert/strict";
import { detectTrivagoPageType, extractTrivagoHotelName, buildTrivagoPageContext, detectTrivagoMemberActive } from "../utils/trivago-context.js";
import type { DocLike } from "../utils/trivago-context.js";

// --- detectTrivagoPageType ---------------------------------------------------

test("detectTrivagoPageType: hotel detail page", () => {
  assert.equal(detectTrivagoPageType("https://www.trivago.com/en-US/odr/30173/le-meridien-stuttgart"), "detail");
});

test("detectTrivagoPageType: detail page with trailing slash", () => {
  assert.equal(detectTrivagoPageType("https://www.trivago.com/en-US/odr/12345/some-hotel/"), "detail");
});

test("detectTrivagoPageType: search results page", () => {
  assert.equal(detectTrivagoPageType("https://www.trivago.com/en-US/lm/hotel-deals/prague"), "search");
});

test("detectTrivagoPageType: search page with query params", () => {
  assert.equal(detectTrivagoPageType("https://www.trivago.com/en-US/lm/hotel-deals/hotel/?search=200-12345"), "search");
});

test("detectTrivagoPageType: German locale detail page on trivago.com", () => {
  assert.equal(detectTrivagoPageType("https://www.trivago.com/de-DE/odr/30173/le-meridien"), "detail");
});

test("detectTrivagoPageType: Czech locale search page", () => {
  assert.equal(detectTrivagoPageType("https://www.trivago.com/cs-CZ/lm/hotel-deals/prague"), "search");
});

test("detectTrivagoPageType: homepage is unknown", () => {
  assert.equal(detectTrivagoPageType("https://www.trivago.com/"), "unknown");
});

test("detectTrivagoPageType: non-trivago URL is unknown", () => {
  assert.equal(detectTrivagoPageType("https://www.booking.com/hotel/cz/trivago.html"), "unknown");
});

test("detectTrivagoPageType: malformed URL is unknown", () => {
  assert.equal(detectTrivagoPageType("not-a-url"), "unknown");
});

test("detectTrivagoPageType: trivago.com (no subdomain) detail page", () => {
  assert.equal(detectTrivagoPageType("https://trivago.com/en-US/odr/30173/hotel-name"), "detail");
});

test("detectTrivagoPageType: other trivago path is unknown", () => {
  assert.equal(detectTrivagoPageType("https://www.trivago.com/en-US/about"), "unknown");
});

// --- extractTrivagoHotelName -------------------------------------------------

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

test("extractTrivagoHotelName: prefers data-testid=property-name", () => {
  const doc = mockDoc({
    '[data-testid="property-name"]': "Le Méridien Stuttgart",
    ".property-name": "Old Name",
  });
  assert.equal(extractTrivagoHotelName(doc), "Le Méridien Stuttgart");
});

test("extractTrivagoHotelName: falls back to data-testid=hotel-name", () => {
  const doc = mockDoc({ '[data-testid="hotel-name"]': "Hotel Praha" });
  assert.equal(extractTrivagoHotelName(doc), "Hotel Praha");
});

test("extractTrivagoHotelName: falls back to data-testid=accommodation-name", () => {
  const doc = mockDoc({ '[data-testid="accommodation-name"]': "Marriott Vienna" });
  assert.equal(extractTrivagoHotelName(doc), "Marriott Vienna");
});

test("extractTrivagoHotelName: falls back to property-name class", () => {
  const doc = mockDoc({ ".property-name": "Hilton Prague" });
  assert.equal(extractTrivagoHotelName(doc), "Hilton Prague");
});

test("extractTrivagoHotelName: falls back to og:title splitting on dash separator", () => {
  const doc = mockDocWithAttr(
    { 'meta[property="og:title"]': { attr: "Hotel Ambassador - trivago" } },
    "Hotel Ambassador | trivago",
  );
  assert.equal(extractTrivagoHotelName(doc), "Hotel Ambassador");
});

test("extractTrivagoHotelName: falls back to og:title splitting on pipe separator", () => {
  const doc = mockDocWithAttr(
    { 'meta[property="og:title"]': { attr: "Grand Hyatt Vienna | trivago" } },
    "",
  );
  assert.equal(extractTrivagoHotelName(doc), "Grand Hyatt Vienna");
});

test("extractTrivagoHotelName: falls back to page title splitting on dash", () => {
  const doc = mockDoc({}, "Sheraton Grand Prague - trivago.com");
  assert.equal(extractTrivagoHotelName(doc), "Sheraton Grand Prague");
});

test("extractTrivagoHotelName: falls back to page title splitting on pipe", () => {
  const doc = mockDoc({}, "InterContinental Budapest | trivago");
  assert.equal(extractTrivagoHotelName(doc), "InterContinental Budapest");
});

test("extractTrivagoHotelName: returns undefined when nothing found", () => {
  const doc = mockDoc({}, "");
  assert.equal(extractTrivagoHotelName(doc), undefined);
});

test("extractTrivagoHotelName: trims whitespace from selector result", () => {
  const doc = mockDoc({ '[data-testid="property-name"]': "  NH Hotel Prague  " });
  assert.equal(extractTrivagoHotelName(doc), "NH Hotel Prague");
});

// --- buildTrivagoPageContext --------------------------------------------------

test("buildTrivagoPageContext: search page returns only domain", () => {
  const doc = mockDoc({ '[data-testid="property-name"]': "Some Hotel" });
  const ctx = buildTrivagoPageContext("https://www.trivago.com/en-US/lm/hotel-deals/prague", doc);
  assert.deepEqual(ctx, { domain: "trivago.com" });
});

test("buildTrivagoPageContext: unknown page returns only domain", () => {
  const doc = mockDoc({ '[data-testid="property-name"]': "Some Hotel" });
  const ctx = buildTrivagoPageContext("https://www.trivago.com/", doc);
  assert.deepEqual(ctx, { domain: "trivago.com" });
});

test("buildTrivagoPageContext: detail page with hotel name includes property", () => {
  const doc = mockDoc({ '[data-testid="property-name"]': "Le Méridien Stuttgart" });
  const ctx = buildTrivagoPageContext("https://www.trivago.com/en-US/odr/30173/le-meridien-stuttgart", doc);
  assert.deepEqual(ctx, { domain: "trivago.com", property: { name: "Le Méridien Stuttgart" } });
});

test("buildTrivagoPageContext: detail page without hotel name omits property", () => {
  const doc = mockDoc({}, "");
  const ctx = buildTrivagoPageContext("https://www.trivago.com/en-US/odr/30173/le-meridien-stuttgart", doc);
  assert.deepEqual(ctx, { domain: "trivago.com" });
});

// --- detectTrivagoMemberActive -----------------------------------------------

function mockDocWithSelectors(present: string[]): DocLike {
  return {
    querySelector(selector: string) {
      if (present.includes(selector)) {
        return { textContent: "Member", getAttribute: () => null };
      }
      return null;
    },
    title: "",
  };
}

test("detectTrivagoMemberActive: returns false when no member signals present", () => {
  const doc = mockDocWithSelectors([]);
  assert.equal(detectTrivagoMemberActive(doc), false);
});

test("detectTrivagoMemberActive: detects user-avatar data-testid", () => {
  const doc = mockDocWithSelectors(['[data-testid="user-avatar"]']);
  assert.equal(detectTrivagoMemberActive(doc), true);
});

test("detectTrivagoMemberActive: detects user-profile data-testid", () => {
  const doc = mockDocWithSelectors(['[data-testid="user-profile"]']);
  assert.equal(detectTrivagoMemberActive(doc), true);
});

test("detectTrivagoMemberActive: detects trivago-score data-testid", () => {
  const doc = mockDocWithSelectors(['[data-testid="trivago-score"]']);
  assert.equal(detectTrivagoMemberActive(doc), true);
});

test("detectTrivagoMemberActive: detects ts-balance data-testid", () => {
  const doc = mockDocWithSelectors(['[data-testid="ts-balance"]']);
  assert.equal(detectTrivagoMemberActive(doc), true);
});

test("detectTrivagoMemberActive: detects member-badge data-testid", () => {
  const doc = mockDocWithSelectors(['[data-testid="member-badge"]']);
  assert.equal(detectTrivagoMemberActive(doc), true);
});

test("detectTrivagoMemberActive: detects rewards-points data-testid", () => {
  const doc = mockDocWithSelectors(['[data-testid="rewards-points"]']);
  assert.equal(detectTrivagoMemberActive(doc), true);
});

test("detectTrivagoMemberActive: detects member-icon CSS class", () => {
  const doc = mockDocWithSelectors([".member-icon"]);
  assert.equal(detectTrivagoMemberActive(doc), true);
});

test("detectTrivagoMemberActive: detects ts-balance CSS class", () => {
  const doc = mockDocWithSelectors([".ts-balance"]);
  assert.equal(detectTrivagoMemberActive(doc), true);
});

test("detectTrivagoMemberActive: returns false for unrelated DOM signals", () => {
  const doc = mockDocWithSelectors(['[data-testid="hotel-name"]', '[data-testid="search-results"]']);
  assert.equal(detectTrivagoMemberActive(doc), false);
});

test("detectTrivagoMemberActive: returns true when multiple signals present", () => {
  const doc = mockDocWithSelectors([
    '[data-testid="user-avatar"]',
    '[data-testid="trivago-score"]',
  ]);
  assert.equal(detectTrivagoMemberActive(doc), true);
});
