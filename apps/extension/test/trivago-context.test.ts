import { test } from "node:test";
import assert from "node:assert/strict";
import {
  detectTrivagoPageType,
  extractTrivagoHotelName,
  buildTrivagoPageContext,
  detectTrivagoMetasearchActive,
} from "../utils/trivago-context.js";
import type { DocLike } from "../utils/trivago-context.js";

// --- detectTrivagoPageType ---------------------------------------------------

test("detectTrivagoPageType: search results page (srl with locale)", () => {
  assert.equal(
    detectTrivagoPageType("https://www.trivago.com/en-US/srl/hotel?search%5Bdestination_name%5D=Prague"),
    "search",
  );
});

test("detectTrivagoPageType: search results page (srl trailing slash)", () => {
  assert.equal(detectTrivagoPageType("https://www.trivago.com/de-DE/srl/"), "search");
});

test("detectTrivagoPageType: search results page (srl bare)", () => {
  assert.equal(detectTrivagoPageType("https://www.trivago.com/cs-CZ/srl"), "search");
});

test("detectTrivagoPageType: hotel detail page (odr)", () => {
  assert.equal(
    detectTrivagoPageType("https://www.trivago.com/en-US/odr/hotel/marriott-prague"),
    "detail",
  );
});

test("detectTrivagoPageType: hotel detail page (odr with query string)", () => {
  assert.equal(
    detectTrivagoPageType("https://www.trivago.com/de-DE/odr/hotel/hilton-prague?checkin=2026-07-01"),
    "detail",
  );
});

test("detectTrivagoPageType: homepage is unknown", () => {
  assert.equal(detectTrivagoPageType("https://www.trivago.com/"), "unknown");
});

test("detectTrivagoPageType: non-trivago URL is unknown", () => {
  assert.equal(detectTrivagoPageType("https://www.booking.com/hotel/cz/hilton-prague.html"), "unknown");
});

test("detectTrivagoPageType: malformed URL is unknown", () => {
  assert.equal(detectTrivagoPageType("not-a-url"), "unknown");
});

test("detectTrivagoPageType: subdomain (de.trivago.com) srl is search", () => {
  assert.equal(detectTrivagoPageType("https://de.trivago.com/de-DE/srl/hotel?..."), "search");
});

test("detectTrivagoPageType: subdomain (de.trivago.com) odr is detail", () => {
  assert.equal(detectTrivagoPageType("https://de.trivago.com/de-DE/odr/hotel/hilton-berlin"), "detail");
});

test("detectTrivagoPageType: flights or car page is unknown", () => {
  assert.equal(detectTrivagoPageType("https://www.trivago.com/en-US/flights"), "unknown");
});

test("detectTrivagoPageType: lp landing page is unknown", () => {
  assert.equal(detectTrivagoPageType("https://www.trivago.com/en-US/lp/hotels-in-prague"), "unknown");
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

test("extractTrivagoHotelName: prefers data-testid=item-name", () => {
  const doc = mockDoc({
    '[data-testid="item-name"]': "Marriott Prague",
    "h1": "Some other h1",
  });
  assert.equal(extractTrivagoHotelName(doc), "Marriott Prague");
});

test("extractTrivagoHotelName: falls back to data-testid=property-name", () => {
  const doc = mockDoc({ '[data-testid="property-name"]': "Hilton Prague Old Town" });
  assert.equal(extractTrivagoHotelName(doc), "Hilton Prague Old Town");
});

test("extractTrivagoHotelName: falls back to data-testid=hotel-name", () => {
  const doc = mockDoc({ '[data-testid="hotel-name"]': "W Prague" });
  assert.equal(extractTrivagoHotelName(doc), "W Prague");
});

test("extractTrivagoHotelName: falls back to h1", () => {
  const doc = mockDoc({ "h1": "NH Collection Prague Carlo IV" });
  assert.equal(extractTrivagoHotelName(doc), "NH Collection Prague Carlo IV");
});

test("extractTrivagoHotelName: falls back to og:title splitting on pipe then comma", () => {
  const doc = mockDocWithAttr(
    { 'meta[property="og:title"]': { attr: "Marriott Prague, Prague | trivago" } },
    "Marriott Prague | trivago",
  );
  assert.equal(extractTrivagoHotelName(doc), "Marriott Prague");
});

test("extractTrivagoHotelName: skips og:title containing trivago", () => {
  const doc = mockDocWithAttr(
    { 'meta[property="og:title"]': { attr: "trivago | Hotel Search" } },
    "InterContinental Prague | trivago",
  );
  assert.equal(extractTrivagoHotelName(doc), "InterContinental Prague");
});

test("extractTrivagoHotelName: falls back to page title splitting on pipe", () => {
  const doc = mockDoc({}, "Park Hyatt Prague | trivago");
  assert.equal(extractTrivagoHotelName(doc), "Park Hyatt Prague");
});

test("extractTrivagoHotelName: returns undefined when nothing found", () => {
  const doc = mockDoc({}, "");
  assert.equal(extractTrivagoHotelName(doc), undefined);
});

test("extractTrivagoHotelName: trims whitespace from selector result", () => {
  const doc = mockDoc({ '[data-testid="item-name"]': "  Four Seasons Prague  " });
  assert.equal(extractTrivagoHotelName(doc), "Four Seasons Prague");
});

// --- buildTrivagoPageContext --------------------------------------------------

test("buildTrivagoPageContext: search page returns only domain", () => {
  const doc = mockDoc({ '[data-testid="item-name"]': "Some Hotel" });
  const ctx = buildTrivagoPageContext("https://www.trivago.com/en-US/srl/hotel?q=Prague", doc);
  assert.deepEqual(ctx, { domain: "trivago.com" });
});

test("buildTrivagoPageContext: unknown page returns only domain", () => {
  const doc = mockDoc({ '[data-testid="item-name"]': "Some Hotel" });
  const ctx = buildTrivagoPageContext("https://www.trivago.com/en-US/lp/hotels", doc);
  assert.deepEqual(ctx, { domain: "trivago.com" });
});

test("buildTrivagoPageContext: detail page with hotel name includes property", () => {
  const doc = mockDoc({ '[data-testid="item-name"]': "Marriott Prague" });
  const ctx = buildTrivagoPageContext(
    "https://www.trivago.com/en-US/odr/hotel/marriott-prague",
    doc,
  );
  assert.deepEqual(ctx, { domain: "trivago.com", property: { name: "Marriott Prague" } });
});

test("buildTrivagoPageContext: detail page without hotel name omits property", () => {
  const doc = mockDoc({}, "");
  const ctx = buildTrivagoPageContext(
    "https://www.trivago.com/en-US/odr/hotel/unknown-hotel",
    doc,
  );
  assert.deepEqual(ctx, { domain: "trivago.com" });
});

// --- detectTrivagoMetasearchActive -------------------------------------------

function mockDocEmpty(): DocLike {
  return {
    querySelector() { return null; },
    title: "",
  };
}

test("detectTrivagoMetasearchActive: always returns true (Trivago is always metasearch)", () => {
  assert.equal(detectTrivagoMetasearchActive(mockDocEmpty()), true);
});

test("detectTrivagoMetasearchActive: returns true even with empty document", () => {
  const doc = mockDoc({}, "");
  assert.equal(detectTrivagoMetasearchActive(doc), true);
});
