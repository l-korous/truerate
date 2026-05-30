import type { HotelSearchQuery } from "@truerate/core";

// Pure parser for the search parameters Booking.com encodes in its URL query
// string. Kept free of browser globals so it can be unit-tested directly.
// Booking sometimes uses `checkin`/`checkout` ISO params and sometimes splits
// them into `checkin_year` / `checkin_month` / `checkin_monthday`.

export function parseBookingQuery(search: string): HotelSearchQuery | null {
  const p = new URLSearchParams(search);
  const location = p.get("ss") || p.get("dest") || p.get("city");
  const checkIn = p.get("checkin") || isoFromParts(p, "checkin");
  const checkOut = p.get("checkout") || isoFromParts(p, "checkout");
  if (!location || !checkIn || !checkOut) return null;
  return {
    location,
    checkIn,
    checkOut,
    adults: Number(p.get("group_adults") ?? 2),
    rooms: Number(p.get("no_rooms") ?? 1),
    limit: 6,
  };
}

function isoFromParts(p: URLSearchParams, base: string): string | null {
  const y = p.get(`${base}_year`);
  const m = p.get(`${base}_month`);
  const d = p.get(`${base}_monthday`);
  if (y && m && d) return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  return null;
}
