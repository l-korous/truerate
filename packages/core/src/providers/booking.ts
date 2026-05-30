import { createHash } from "node:crypto";
import type { HotelSearchQuery } from "../types.js";
import type { HotelProvider, ProviderProperty } from "./types.js";

// Booking.com adapter.
//
// MODE: LIVE if BOOKING_API_KEY + BOOKING_AFFILIATE_ID are set, else MOCK
// (deterministic, realistic public prices derived from the query hash so the
// product is demoable and tests are stable without partner access).
//
// The adapter returns only PUBLIC prices plus each property's brand. Member
// value is layered on by the enrichment engine from the user's benefits, so
// this adapter never needs the user's memberships and needs no authenticated
// access. Mock properties are tagged with brands (Marriott/Hilton/independent)
// so brand-scoped benefits (e.g. Marriott free breakfast) can be demonstrated
// alongside the OTA-wide Genius discount that matches the booking.com domain.

const MOCK: ReadonlyArray<readonly [string, string, string | undefined]> = [
  ["Sheraton Grand", "City Center", "Marriott"],
  ["DoubleTree Riverside", "Riverbank", "Hilton"],
  ["Hotel Josefov", "Old Town", undefined],
  ["Courtyard Park", "Green District", "Marriott"],
  ["Hampton Station", "Central Station", "Hilton"],
  ["Maison Vltava", "Riverbank", undefined],
  ["Westin Belvedere", "Hillside", "Marriott"],
  ["Northgate Inn", "Business Quarter", undefined],
];

export class BookingProvider implements HotelProvider {
  readonly id = "booking";
  readonly domain = "booking.com";
  readonly isMock: boolean;

  constructor() {
    this.isMock = !(process.env.BOOKING_API_KEY && process.env.BOOKING_AFFILIATE_ID);
  }

  async search(query: HotelSearchQuery): Promise<ProviderProperty[]> {
    return this.isMock ? this.mockProperties(query) : this.liveProperties(query);
  }

  // --- LIVE Demand API (scaffold; validate against real partner docs) -------

  private async liveProperties(query: HotelSearchQuery): Promise<ProviderProperty[]> {
    const base = process.env.BOOKING_API_BASE ?? "https://demandapi.booking.com/3.1";
    const res = await fetch(`${base}/accommodations/search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Affiliate-Id": process.env.BOOKING_AFFILIATE_ID!,
        Authorization: `Bearer ${process.env.BOOKING_API_KEY!}`,
      },
      body: JSON.stringify({
        checkin: query.checkIn,
        checkout: query.checkOut,
        city: query.location,
        guests: { number_of_adults: query.adults, number_of_rooms: query.rooms },
        currency: query.currency ?? "EUR",
        rows: query.limit ?? 10,
      }),
    });
    if (!res.ok) throw new Error(`Booking Demand API error ${res.status}: ${await res.text()}`);
    const data: any = await res.json();
    const currency = query.currency ?? "EUR";
    const nights = nightsBetween(query.checkIn, query.checkOut);
    return (data.result ?? []).map((r: any): ProviderProperty => {
      const nightly = Number(r.price?.per_night ?? r.min_total_price ?? 0);
      return {
        providerId: this.id,
        externalId: String(r.hotel_id ?? r.id),
        name: r.hotel_name ?? r.name,
        brand: r.brand,
        area: r.district ?? r.city,
        rating: r.review_score,
        stars: r.class,
        thumbnail: r.main_photo_url,
        publicOffer: {
          source: "public",
          label: "Public rate",
          nightlyAmount: round2(nightly),
          totalAmount: round2(nightly * nights),
          currency,
        },
      };
    });
  }

  // --- MOCK data ------------------------------------------------------------

  private mockProperties(query: HotelSearchQuery): ProviderProperty[] {
    const currency = query.currency ?? "EUR";
    const nights = nightsBetween(query.checkIn, query.checkOut);
    const limit = Math.min(query.limit ?? 6, MOCK.length);
    const seedBase = `${query.location}|${query.checkIn}|${query.adults}`;

    return Array.from({ length: limit }, (_, i) => {
      const [name, area, brand] = MOCK[i]!;
      const seed = hashToUnit(`${seedBase}|${i}`);
      const nightly = round2(70 + seed * 190);
      return {
        providerId: this.id,
        externalId: `mock-${createHash("sha1").update(seedBase + i).digest("hex").slice(0, 10)}`,
        name,
        brand,
        area,
        rating: round1(7.5 + seed * 2),
        stars: 3 + Math.round(seed * 2),
        publicOffer: {
          source: "public",
          label: "Public rate",
          nightlyAmount: nightly,
          totalAmount: round2(nightly * nights),
          currency,
        },
      };
    });
  }
}

function nightsBetween(checkIn: string, checkOut: string): number {
  const n = Math.round((new Date(checkOut).getTime() - new Date(checkIn).getTime()) / 86_400_000);
  return Math.max(1, n);
}
function hashToUnit(s: string): number {
  return createHash("sha256").update(s).digest().readUInt32BE(0) / 0xffffffff;
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
