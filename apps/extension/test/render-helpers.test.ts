import { test } from "node:test";
import assert from "node:assert/strict";
import { esc, perkEstimateRow } from "../utils/render-helpers.js";
import type { MatchedPerkEstimate } from "@truerate/core";

// --- esc ---

test("esc encodes HTML special characters", () => {
  assert.equal(esc('<script>alert("xss")</script>'), "&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;");
});

test("esc encodes ampersand and single quote", () => {
  assert.equal(esc("a & b 'c'"), "a &amp; b &#39;c&#39;");
});

test("esc leaves safe strings untouched", () => {
  assert.equal(esc("Free breakfast daily"), "Free breakfast daily");
});

// --- perkEstimateRow ---

const baseEstimate: MatchedPerkEstimate = {
  perkType: "free_breakfast",
  label: "Free breakfast at select properties",
  estimatedUsd: { 3: 15, 4: 25, 5: 50 },
  membershipLabel: "Booking.com Genius - Level 3",
  isEstimate: true,
};

test("perkEstimateRow renders perk label", () => {
  const html = perkEstimateRow(baseEstimate);
  assert.ok(html.includes("Free breakfast at select properties"), "label present");
});

test("perkEstimateRow renders all three star-band estimates", () => {
  const html = perkEstimateRow(baseEstimate);
  assert.ok(html.includes("~$15 (3★)"), "3★ estimate");
  assert.ok(html.includes("$25 (4★)"), "4★ estimate");
  assert.ok(html.includes("$50 (5★)"), "5★ estimate");
});

test("perkEstimateRow shows subjectToAvailability condition", () => {
  const e: MatchedPerkEstimate = {
    ...baseEstimate,
    conditions: { subjectToAvailability: true },
  };
  const html = perkEstimateRow(e);
  assert.ok(html.includes("subject to availability"), "availability caveat present");
});

test("perkEstimateRow shows booking channel condition", () => {
  const e: MatchedPerkEstimate = {
    ...baseEstimate,
    conditions: { bookingChannel: ["ota"] },
  };
  const html = perkEstimateRow(e);
  assert.ok(html.includes("ota booking"), "channel condition present");
});

test("perkEstimateRow renders no condition span when conditions absent", () => {
  const html = perkEstimateRow({ ...baseEstimate, conditions: undefined });
  assert.ok(!html.includes("tr-est-cond"), "no condition span when absent");
});

test("perkEstimateRow escapes HTML in perk label", () => {
  const e: MatchedPerkEstimate = { ...baseEstimate, label: '<b>XSS</b>' };
  const html = perkEstimateRow(e);
  assert.ok(!html.includes("<b>XSS</b>"), "raw HTML tags not present");
  assert.ok(html.includes("&lt;b&gt;XSS&lt;/b&gt;"), "tags are escaped");
});

test("perkEstimateRow never includes price-like keys", () => {
  const html = perkEstimateRow(baseEstimate);
  // These strings should not appear in any form that implies a computed price
  assert.ok(!html.includes("finalPrice"), "no finalPrice");
  assert.ok(!html.includes("totalSavings"), "no totalSavings");
  assert.ok(!html.includes("indicativeOffer"), "no indicativeOffer");
});
