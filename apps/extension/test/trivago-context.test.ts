import { test } from "node:test";
import assert from "node:assert/strict";
import {
  detectTrivagoPageType,
  extractTrivagoHotelName,
  buildTrivagoPageContext,
  detectMetasearchMemberRateActive,
} from "../utils/trivago-context.js";
import type { DocLike } from "../utils/trivago-context.js";

// --- detectTrivagoPageType ---------------------------------------------------

test("detectTrivagoPageType: modern detail page (lm path)", () => {
  assert.equal(
    detectTrivagoPageType("https://www.trivago.com/en-US/lm/hotel/12345/hilton-prague"),
    "detail",
  );
});

test("detectTrivagoPageType: modern detail page without slug", () => {
  assert.equal(
    detectTrivagoPageType("https://www.trivago.com/en-GB/lm/hotel/98765/"),
    "detail",
  );
});

test("detectTrivagoPageType: legacy detail page path", () => {
  assert.equal(
    detectTrivagoPageType("https://www.trivago.com/prague--1763/hotel/12345-hilton"),
    "detail",
  );
});

test("detectTrivagoPageType: modern search results (lm path)", () => {
  assert.equal(
    detectTrivagoPageType("https://www.trivago.com/en-US/lm/hotel-search?search[...]=&isr=true"),
    "search",
  );
});

test("detectTrivagoPageType: root hotel-search path", () => {
  assert.equal(
    detectTrivagoPageType("https://www.trivago.com/hotel-search?query=Prague"),
    "search",
  );
});

test("detectTrivagoPageType: legacy city results page", () => {
  assert.equal(
    detectTrivagoPageType("https://www.trivago.com/prague--1763/hotel"),
    "search",
  );
});

test("detectTrivagoPageType: homepage is search", () => {
  assert.equal(detectTrivagoPageType("https://www.trivago.com/"), "search");
});

test("detectTrivagoPageType: subdomain (e.g. de.trivago.com) detail page", () => {
  assert.equal(
    detectTrivagoPageType("https://de.trivago.com/de-DE/lm/hotel/55555/meininger-hotel"),
    "detail",
  );
});

test("detectTrivagoPageType: non-trivago URL is unknown", () => {
  assert.equal(detectTrivagoPageType("https://www.booking.com/hotel/cz/hilton.html"), "unknown");
});

test("detectTrivagoPageType: malformed URL is unknown", () => {
  assert.equal(detectTrivagoPageType("not-a-url"), "unknown");
});

test("detectTrivagoPageType: unrecognised path is unknown", () => {
  assert.equal(detectTrivagoPageType("https://www.trivago.com/about/"), "unknown");
});

test("detectTrivagoPageType: trivago.com with no path is search", () => {
  assert.equal(detectTrivagoPageType("https://trivago.com/"), "search");
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

test("extractTrivagoHotelName: prefers hotel-name-headline testid", () => {
  const doc = mockDoc({
    '[data-testid="hotel-name-headline"]': "Hilton Prague Old Town",
    "h1": "Something Else",
  });
  assert.equal(extractTrivagoHotelName(doc), "Hilton Prague Old Town");
});

test("extractTrivagoHotelName: falls back to hotel-name testid", () => {
  const doc = mockDoc({ '[data-testid="hotel-name"]': "Marriott Vienna" });
  assert.equal(extractTrivagoHotelName(doc), "Marriott Vienna");
});

test("extractTrivagoHotelName: falls back to property-name testid", () => {
  const doc = mockDoc({ '[data-testid="property-name"]': "Conrad Budapest" });
  assert.equal(extractTrivagoHotelName(doc), "Conrad Budapest");
});

test("extractTrivagoHotelName: falls back to og:title splitting on comma", () => {
  const doc = mockDocWithAttr(
    { 'meta[property="og:title"]': { attr: "W Prague, Prague, Czech Republic | trivago" } },
    "W Prague - trivago",
  );
  assert.equal(extractTrivagoHotelName(doc), "W Prague");
});

test("extractTrivagoHotelName: og:title starting with trivago is ignored", () => {
  const doc = mockDocWithAttr(
    { 'meta[property="og:title"]': { attr: "trivago: Best Price Guaranteed" } },
    "Hotel Berlin | trivago",
  );
  assert.equal(extractTrivagoHotelName(doc), "Hotel Berlin");
});

test("extractTrivagoHotelName: falls back to page title pipe separator", () => {
  const doc = mockDoc({}, "Park Hyatt Vienna | trivago");
  assert.equal(extractTrivagoHotelName(doc), "Park Hyatt Vienna");
});

test("extractTrivagoHotelName: falls back to page title dash separator", () => {
  const doc = mockDoc({}, "Hilton Munich - trivago");
  assert.equal(extractTrivagoHotelName(doc), "Hilton Munich");
});

test("extractTrivagoHotelName: returns undefined when nothing found", () => {
  const doc = mockDoc({}, "");
  assert.equal(extractTrivagoHotelName(doc), undefined);
});

test("extractTrivagoHotelName: trims whitespace from selector result", () => {
  const doc = mockDoc({ '[data-testid="hotel-name-headline"]': "  Marriott Warsaw  " });
  assert.equal(extractTrivagoHotelName(doc), "Marriott Warsaw");
});

// --- buildTrivagoPageContext --------------------------------------------------

test("buildTrivagoPageContext: search page returns only domain", () => {
  const doc = mockDoc({ '[data-testid="hotel-name-headline"]': "Some Hotel" });
  const ctx = buildTrivagoPageContext("https://www.trivago.com/en-US/lm/hotel-search?q=Prague", doc);
  assert.deepEqual(ctx, { domain: "trivago.com" });
});

test("buildTrivagoPageContext: unknown page returns only domain", () => {
  const doc = mockDoc({ '[data-testid="hotel-name-headline"]': "Some Hotel" });
  const ctx = buildTrivagoPageContext("https://www.trivago.com/about/", doc);
  assert.deepEqual(ctx, { domain: "trivago.com" });
});

test("buildTrivagoPageContext: detail page with name includes property", () => {
  const doc = mockDoc({ '[data-testid="hotel-name-headline"]': "Hilton Prague Old Town" });
  const ctx = buildTrivagoPageContext("https://www.trivago.com/en-US/lm/hotel/12345/hilton-prague", doc);
  assert.deepEqual(ctx, { domain: "trivago.com", property: { name: "Hilton Prague Old Town" } });
});

test("buildTrivagoPageContext: detail page without name omits property", () => {
  const doc = mockDoc({}, "");
  const ctx = buildTrivagoPageContext("https://www.trivago.com/en-US/lm/hotel/12345/hilton-prague", doc);
  assert.deepEqual(ctx, { domain: "trivago.com" });
});

// --- detectMetasearchMemberRateActive ----------------------------------------

function mockDocWithSelectors(present: string[]): DocLike {
  return {
    querySelector(selector: string) {
      if (present.includes(selector)) {
        return { textContent: "deal", getAttribute: () => null };
      }
      return null;
    },
    title: "",
  };
}

test("detectMetasearchMemberRateActive: returns false when no signals present", () => {
  const doc = mockDocWithSelectors([]);
  assert.equal(detectMetasearchMemberRateActive(doc), false);
});

test("detectMetasearchMemberRateActive: detects member-deal testid", () => {
  const doc = mockDocWithSelectors(['[data-testid="member-deal"]']);
  assert.equal(detectMetasearchMemberRateActive(doc), true);
});

test("detectMetasearchMemberRateActive: detects member-rate testid", () => {
  const doc = mockDocWithSelectors(['[data-testid="member-rate"]']);
  assert.equal(detectMetasearchMemberRateActive(doc), true);
});

test("detectMetasearchMemberRateActive: detects exclusive-deal testid", () => {
  const doc = mockDocWithSelectors(['[data-testid="exclusive-deal"]']);
  assert.equal(detectMetasearchMemberRateActive(doc), true);
});

test("detectMetasearchMemberRateActive: detects member-deal CSS class", () => {
  const doc = mockDocWithSelectors(['[class*="member-deal"]']);
  assert.equal(detectMetasearchMemberRateActive(doc), true);
});

test("detectMetasearchMemberRateActive: detects memberDeal CSS class variant", () => {
  const doc = mockDocWithSelectors(['[class*="memberDeal"]']);
  assert.equal(detectMetasearchMemberRateActive(doc), true);
});

test("detectMetasearchMemberRateActive: detects genius-badge testid (OTA pass-through)", () => {
  const doc = mockDocWithSelectors(['[data-testid="genius-badge"]']);
  assert.equal(detectMetasearchMemberRateActive(doc), true);
});

test("detectMetasearchMemberRateActive: detects genius-badge CSS class", () => {
  const doc = mockDocWithSelectors(['[class*="genius-badge"]']);
  assert.equal(detectMetasearchMemberRateActive(doc), true);
});

test("detectMetasearchMemberRateActive: detects qa member-badge", () => {
  const doc = mockDocWithSelectors(['[data-qa="member-badge"]']);
  assert.equal(detectMetasearchMemberRateActive(doc), true);
});

test("detectMetasearchMemberRateActive: returns false for unrelated DOM signals", () => {
  const doc = mockDocWithSelectors(['[data-testid="hotel-name-headline"]', '[data-testid="search-results"]']);
  assert.equal(detectMetasearchMemberRateActive(doc), false);
});

test("detectMetasearchMemberRateActive: returns true when multiple signals present", () => {
  const doc = mockDocWithSelectors([
    '[data-testid="member-deal"]',
    '[class*="member-rate"]',
  ]);
  assert.equal(detectMetasearchMemberRateActive(doc), true);
});
