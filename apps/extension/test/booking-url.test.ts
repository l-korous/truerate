import { test } from "node:test";
import assert from "node:assert/strict";
import { parseBookingQuery } from "../utils/booking-url.js";

test("parses a standard Booking search query string", () => {
  const q = parseBookingQuery(
    "?ss=Prague&checkin=2026-07-10&checkout=2026-07-12&group_adults=3&no_rooms=2",
  );
  assert.deepEqual(q, {
    location: "Prague",
    checkIn: "2026-07-10",
    checkOut: "2026-07-12",
    adults: 3,
    rooms: 2,
    limit: 6,
  });
});

test("reconstructs split date params and pads month/day", () => {
  const q = parseBookingQuery(
    "?ss=Vienna&checkin_year=2026&checkin_month=8&checkin_monthday=3" +
      "&checkout_year=2026&checkout_month=8&checkout_monthday=10",
  );
  assert.equal(q?.checkIn, "2026-08-03");
  assert.equal(q?.checkOut, "2026-08-10");
});

test("defaults adults to 2 and rooms to 1 when absent", () => {
  const q = parseBookingQuery("?ss=Brno&checkin=2026-07-10&checkout=2026-07-12");
  assert.equal(q?.adults, 2);
  assert.equal(q?.rooms, 1);
});

test("returns null when required params are missing", () => {
  assert.equal(parseBookingQuery("?ss=Prague"), null);
  assert.equal(parseBookingQuery("?checkin=2026-07-10&checkout=2026-07-12"), null);
  assert.equal(parseBookingQuery(""), null);
});
