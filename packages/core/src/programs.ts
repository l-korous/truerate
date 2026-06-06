import { randomUUID } from "node:crypto";
import type { Benefit, BenefitTemplate, Program } from "./types.js";

// The catalog is TrueRate's curated library of "what each membership program
// brings". Each program declares how it is recognised on the web (defaultMatch)
// and a set of benefit TEMPLATES per tier. When the user says "I have X", we
// instantiate the matching templates into concrete benefits on their profile.
//
// THE DATA BELOW IS RESEARCHED FROM REAL PROGRAMS (sources + as-of date on each
// entry), not invented. It is a SEED, not the truth: loyalty terms change, vary
// by region, and carry conditions. Treat percentage discounts as INDICATIVE.
// Perks are the high-trust part. This static seed should move to an ops-editable
// store (e.g. Cosmos) so non-engineers can keep it current; the `asOf` /
// `sourceUrl` / `region` fields exist to make that auditable.
//
// IMPORTANT honesty notes baked into the modelling:
//  - OTA-wide and direct-booking discounts (Genius, Czech direct rates) are real
//    percentage discounts and are modelled as such (indicative).
//  - Big-chain "member rates" are small and vary by property; only Accor
//    advertises an explicit headline % ("up to 10%"), so only it carries a base
//    discount. Marriott/Hilton/IHG are modelled as PERKS by tier (accurate),
//    not as a flat discount we can't stand behind.
//  - Card/fintech perks (Amex, Revolut) are mostly account-level (status,
//    lounge, credits, subscriptions), not on-site discounts, so they are global
//    perks — they show in the user's summary and assistant context, and rarely
//    trigger a price change on a hotel page. Region varies; flagged per entry.

export const PROGRAMS: Program[] = [
  // ── OTA ────────────────────────────────────────────────────────────────
  {
    id: "booking_genius",
    name: "Booking.com Genius",
    category: "ota",
    region: "Global",
    asOf: "2026-05",
    sourceUrl: "https://www.booking.com/genius.html",
    defaultMatch: { domains: ["booking.com"], categories: ["hotel"] },
    tiers: ["Level 1", "Level 2", "Level 3"],
    requiresCredential: false,
    fields: [{ key: "tier", label: "Genius level", type: "select", options: ["Level 1", "Level 2", "Level 3"] }],
    benefits: {
      "Level 1": [{ scope: "domain", value: { kind: "percentDiscount", percentOff: 0.1, conditions: "on participating properties when booking via Booking.com" } }],
      "Level 2": [
        { scope: "domain", value: { kind: "percentDiscount", percentOff: 0.15, conditions: "participating properties" } },
        {
          scope: "domain",
          value: {
            kind: "perk",
            perks: ["Free breakfast at select properties", "Free room upgrade at select properties"],
            structuredPerks: [
              { type: "free_breakfast", label: "Free breakfast at select properties", conditions: { subjectToAvailability: true, bookingChannel: ["ota"] } },
              { type: "room_upgrade", label: "Free room upgrade at select properties", conditions: { subjectToAvailability: true, bookingChannel: ["ota"] } },
            ],
          },
        },
      ],
      "Level 3": [
        { scope: "domain", value: { kind: "percentDiscount", percentOff: 0.2, conditions: "participating properties" } },
        {
          scope: "domain",
          value: {
            kind: "perk",
            perks: ["Free breakfast at select properties", "Free room upgrade at select properties", "Priority support"],
            structuredPerks: [
              { type: "free_breakfast", label: "Free breakfast at select properties", conditions: { subjectToAvailability: true, bookingChannel: ["ota"] } },
              { type: "room_upgrade", label: "Free room upgrade at select properties", conditions: { subjectToAvailability: true, bookingChannel: ["ota"] } },
              { type: "priority_support", label: "Priority customer support" },
            ],
          },
        },
      ],
    },
  },

  {
    id: "hotels_com_one_key",
    name: "Hotels.com One Key",
    category: "ota",
    region: "Global",
    asOf: "2026-05",
    sourceUrl: "https://www.hotels.com/loyalty/",
    // One Key is Expedia Group's unified loyalty program covering Hotels.com,
    // Expedia.com, and Vrbo. Members earn OneKeyCash (cash back) on bookings.
    // Member prices vary by property and are not a guaranteed flat percentage
    // (unlike Booking Genius), so they are modelled as perks rather than
    // percentDiscount to avoid overstating indicative discounts.
    defaultMatch: { domains: ["hotels.com"], categories: ["hotel"] },
    tiers: ["Blue", "Silver", "Gold"],
    requiresCredential: false,
    fields: [{ key: "tier", label: "One Key tier", type: "select", options: ["Blue", "Silver", "Gold"] }],
    benefits: {
      Blue: [
        {
          scope: "domain",
          value: {
            kind: "perk",
            perks: ["OneKeyCash earned on bookings (cash back on future stays)", "Member prices on participating hotels"],
            structuredPerks: [
              { type: "other", label: "OneKeyCash earned on bookings", conditions: { notes: "Cash back credited as OneKeyCash; redeemable on future Hotels.com/Expedia bookings" } },
              { type: "other", label: "Member prices on participating hotels", conditions: { subjectToAvailability: true, bookingChannel: ["ota"] } },
            ],
          },
        },
      ],
      Silver: [
        {
          scope: "domain",
          value: {
            kind: "perk",
            perks: ["OneKeyCash earned on bookings (higher earn rate)", "Member prices on participating hotels", "Priority customer support"],
            structuredPerks: [
              { type: "other", label: "OneKeyCash earned on bookings (Silver earn rate)", conditions: { notes: "Higher earn rate than Blue; redeemable on Hotels.com/Expedia" } },
              { type: "other", label: "Member prices on participating hotels", conditions: { subjectToAvailability: true, bookingChannel: ["ota"] } },
              { type: "priority_support", label: "Priority customer support" },
            ],
          },
        },
      ],
      Gold: [
        {
          scope: "domain",
          value: {
            kind: "perk",
            perks: ["OneKeyCash earned on bookings (highest earn rate)", "Member prices on participating hotels", "Priority customer support", "VIP Access perks at select properties"],
            structuredPerks: [
              { type: "other", label: "OneKeyCash earned on bookings (Gold earn rate)", conditions: { notes: "Highest earn rate; redeemable on Hotels.com/Expedia" } },
              { type: "other", label: "Member prices on participating hotels", conditions: { subjectToAvailability: true, bookingChannel: ["ota"] } },
              { type: "priority_support", label: "Priority customer support (Gold)" },
              { type: "other", label: "VIP Access perks at select properties", conditions: { subjectToAvailability: true, notes: "Room upgrades, early check-in, late check-out at VIP Access properties" } },
            ],
          },
        },
      ],
    },
  },

  // ── Czech direct-booking / independent (the cold-start sweet spot) ───────
  {
    id: "your_prague_hotels",
    name: "Your Prague Hotels — Select",
    category: "hotel",
    region: "CZ",
    asOf: "2026-05",
    sourceUrl: "https://www.yourpraguehotels.com/en/about-loyalty-program/",
    // Largest private hotel chain in Prague (Hotel Roma, Caesar, Michelangelo,
    // Galileo, Praga 1, Nová Živohošť). Free loyalty programme; direct only.
    defaultMatch: { domains: ["yourpraguehotels.com"], propertyNames: ["Hotel Roma", "Hotel Caesar", "Michelangelo Grand Hotel", "Hotel Galileo", "Hotel Praga 1"] },
    requiresCredential: false,
    fields: [],
    benefits: {
      "*": [
        { scope: "domain", value: { kind: "percentDiscount", percentOff: 0.1, conditions: "direct booking only; stacks with promotions; not via OTAs" } },
        {
          scope: "domain",
          value: {
            kind: "perk",
            perks: ["Priority early check-in", "Late check-out", "Complimentary room upgrade (when available)"],
            structuredPerks: [
              { type: "early_check_in", label: "Priority early check-in", conditions: { subjectToAvailability: true, bookingChannel: ["direct"] } },
              { type: "late_check_out", label: "Late check-out", conditions: { bookingChannel: ["direct"] } },
              { type: "room_upgrade", label: "Complimentary room upgrade when available", conditions: { subjectToAvailability: true, bookingChannel: ["direct"] } },
            ],
          },
        },
      ],
    },
  },
  {
    id: "emblem_prague",
    name: "Emblem Prague — Emblematic",
    category: "hotel",
    region: "CZ",
    asOf: "2026-05",
    sourceUrl: "https://www.emblemprague.com/about-us/loyalty",
    // 5-star boutique hotel, Prague Old Town. Member rate is direct-only.
    defaultMatch: { domains: ["emblemprague.com"], propertyNames: ["Emblem Hotel", "Emblem Prague"] },
    requiresCredential: false,
    fields: [],
    benefits: {
      "*": [
        { scope: "domain", value: { kind: "percentDiscount", percentOff: 0.2, conditions: "member rate, direct booking only; subject to availability on high-demand dates" } },
        {
          scope: "domain",
          value: {
            kind: "perk",
            perks: ["Priority room upgrade (when available)", "20% off Pure Altitude spa treatments", "Complimentary early check-in / late check-out (when available)"],
            structuredPerks: [
              { type: "room_upgrade", label: "Priority room upgrade when available", conditions: { subjectToAvailability: true, bookingChannel: ["direct"] } },
              { type: "spa_credit", label: "20% off Pure Altitude spa treatments", conditions: { bookingChannel: ["direct"], notes: "Discount on spa treatments; not a cash credit" } },
              { type: "early_check_in", label: "Complimentary early check-in when available", conditions: { subjectToAvailability: true, bookingChannel: ["direct"] } },
              { type: "late_check_out", label: "Complimentary late check-out when available", conditions: { subjectToAvailability: true, bookingChannel: ["direct"] } },
            ],
          },
        },
      ],
    },
  },
  {
    id: "orea",
    name: "OREA Hotels & Resorts",
    category: "hotel",
    region: "CZ",
    asOf: "2026-05",
    sourceUrl: "https://www.orea.cz/en",
    // Large Czech chain (mountains, cities, spa towns). Discounts via promo code
    // on orea.cz; ~15% on selected stays/dates; peak periods excluded.
    defaultMatch: { domains: ["orea.cz"], brands: ["OREA"] },
    requiresCredential: false,
    fields: [],
    benefits: {
      "*": [
        { scope: "domain", value: { kind: "percentDiscount", percentOff: 0.15, conditions: "selected hotels/dates via promo code on orea.cz; excludes packages and peak periods (Easter, Christmas, NYE, school holidays)" } },
      ],
    },
  },

  // ── International chains operating in Czechia ─────────────────────────────
  {
    id: "accor_all",
    name: "ALL — Accor Live Limitless",
    category: "hotel",
    region: "Global",
    asOf: "2026-05",
    sourceUrl: "https://all.accor.com/loyalty-program/",
    defaultMatch: {
      domains: ["all.accor.com", "accor.com"],
      brands: ["Sofitel", "Pullman", "Novotel", "Mercure", "ibis", "Raffles", "Fairmont", "MGallery", "Adagio", "Mövenpick", "Swissôtel", "Mama Shelter"],
    },
    tiers: ["Classic", "Silver", "Gold", "Platinum", "Diamond"],
    requiresCredential: false,
    fields: [
      { key: "tier", label: "Status", type: "select", options: ["Classic", "Silver", "Gold", "Platinum", "Diamond"] },
      { key: "membershipNumber", label: "ALL number (optional)", type: "text" },
    ],
    benefits: {
      // Headline member rate is "up to 10% off the public rate"; modelled at a
      // conservative, indicative 5% base across the brand.
      Classic: [
        { scope: "brand", value: { kind: "percentDiscount", percentOff: 0.05, conditions: "member rate (up to ~10% at participating hotels)" } },
        {
          scope: "brand",
          value: {
            kind: "perk",
            perks: ["Member rate", "Free Wi-Fi", "Online check-in"],
            structuredPerks: [
              { type: "free_wifi", label: "Complimentary Wi-Fi" },
              { type: "other", label: "Online check-in" },
            ],
          },
        },
      ],
      Silver: [
        { scope: "brand", value: { kind: "percentDiscount", percentOff: 0.05, conditions: "member rate" } },
        {
          scope: "brand",
          value: {
            kind: "perk",
            perks: ["Welcome drink", "Late check-out (when available)"],
            structuredPerks: [
              { type: "welcome_amenity", label: "Welcome drink on arrival" },
              { type: "late_check_out", label: "Late check-out when available", conditions: { subjectToAvailability: true } },
            ],
          },
        },
      ],
      Gold: [
        { scope: "brand", value: { kind: "percentDiscount", percentOff: 0.05, conditions: "member rate" } },
        {
          scope: "brand",
          value: {
            kind: "perk",
            perks: ["Welcome drink", "Room upgrade (when available)", "Executive lounge access (at applicable hotels)"],
            structuredPerks: [
              { type: "welcome_amenity", label: "Welcome drink on arrival" },
              { type: "room_upgrade", label: "Room upgrade when available", conditions: { subjectToAvailability: true } },
              { type: "lounge_access", label: "Executive lounge access at applicable hotels", conditions: { notes: "Available at hotels with executive lounge" } },
            ],
          },
        },
      ],
      Platinum: [
        { scope: "brand", value: { kind: "percentDiscount", percentOff: 0.05, conditions: "member rate" } },
        {
          scope: "brand",
          value: {
            kind: "perk",
            perks: ["Room upgrade (when available)", "2 suite-night upgrades", "Executive lounge access", "Guaranteed availability"],
            structuredPerks: [
              { type: "room_upgrade", label: "Room upgrade when available", conditions: { subjectToAvailability: true } },
              { type: "suite_upgrade", label: "2 suite-night upgrade certificates per year", conditions: { notes: "2 suite-night upgrade certificates per status year" } },
              { type: "lounge_access", label: "Executive lounge access" },
              { type: "guaranteed_availability", label: "Guaranteed room availability" },
            ],
          },
        },
      ],
      Diamond: [
        { scope: "brand", value: { kind: "percentDiscount", percentOff: 0.05, conditions: "member rate" } },
        {
          scope: "brand",
          value: {
            kind: "perk",
            perks: ["Weekend breakfast worldwide", "Dining & spa vouchers", "Premium room upgrade", "Executive lounge access"],
            structuredPerks: [
              { type: "free_breakfast", label: "Weekend breakfast worldwide", conditions: { notes: "Applies on weekend stays globally" } },
              { type: "spa_credit", label: "Dining and spa vouchers", conditions: { notes: "Vouchers included with Diamond status" } },
              { type: "room_upgrade", label: "Premium room upgrade" },
              { type: "lounge_access", label: "Executive lounge access" },
            ],
          },
        },
      ],
    },
  },
  {
    id: "ihg_one_rewards",
    name: "IHG One Rewards",
    category: "hotel",
    region: "Global",
    asOf: "2026-05",
    sourceUrl: "https://www.ihg.com/onerewards/",
    defaultMatch: {
      domains: ["ihg.com"],
      brands: ["InterContinental", "Crowne Plaza", "Holiday Inn", "Hotel Indigo", "Kimpton", "voco", "Regent", "Six Senses", "Staybridge", "Candlewood"],
    },
    tiers: ["Club", "Silver Elite", "Gold Elite", "Platinum Elite", "Diamond Elite"],
    requiresCredential: false,
    fields: [{ key: "tier", label: "Status", type: "select", options: ["Club", "Silver Elite", "Gold Elite", "Platinum Elite", "Diamond Elite"] }],
    benefits: {
      Club: [
        {
          scope: "brand",
          value: {
            kind: "perk",
            perks: ["Member rate (lowest available)", "Free Wi-Fi", "Earns points"],
            structuredPerks: [
              { type: "free_wifi", label: "Complimentary Wi-Fi" },
              { type: "points_bonus", label: "Earns IHG One Rewards points" },
            ],
          },
        },
      ],
      "Silver Elite": [
        {
          scope: "brand",
          value: {
            kind: "perk",
            perks: ["Member rate", "Free Wi-Fi", "20% bonus points"],
            structuredPerks: [
              { type: "free_wifi", label: "Complimentary Wi-Fi" },
              { type: "points_bonus", label: "20% bonus points on top of base earn", conditions: { notes: "20% bonus on base point earn rate" } },
            ],
          },
        },
      ],
      "Gold Elite": [
        {
          scope: "brand",
          value: {
            kind: "perk",
            perks: ["Member rate", "Room upgrade (when available)", "40% bonus points"],
            structuredPerks: [
              { type: "room_upgrade", label: "Room upgrade when available", conditions: { subjectToAvailability: true } },
              { type: "points_bonus", label: "40% bonus points on top of base earn", conditions: { notes: "40% bonus on base point earn rate" } },
            ],
          },
        },
      ],
      "Platinum Elite": [
        {
          scope: "brand",
          value: {
            kind: "perk",
            perks: ["Room upgrade (when available)", "Guaranteed room availability", "Welcome amenity"],
            structuredPerks: [
              { type: "room_upgrade", label: "Room upgrade when available", conditions: { subjectToAvailability: true } },
              { type: "guaranteed_availability", label: "Guaranteed room availability" },
              { type: "welcome_amenity", label: "Welcome amenity on arrival" },
            ],
          },
        },
      ],
      "Diamond Elite": [
        {
          scope: "brand",
          value: {
            kind: "perk",
            perks: ["Premium room upgrade", "Welcome amenity", "Dedicated support"],
            structuredPerks: [
              { type: "room_upgrade", label: "Premium room upgrade" },
              { type: "welcome_amenity", label: "Welcome amenity on arrival" },
              { type: "priority_support", label: "Dedicated IHG One Rewards support" },
            ],
          },
        },
      ],
    },
  },
  {
    id: "hilton_honors",
    name: "Hilton Honors",
    category: "hotel",
    region: "Global",
    asOf: "2026-05",
    sourceUrl: "https://www.hilton.com/en/hilton-honors/",
    defaultMatch: {
      domains: ["hilton.com"],
      brands: ["Hilton", "DoubleTree", "Hampton", "Conrad", "Waldorf Astoria", "Canopy", "Curio", "Embassy Suites", "Hilton Garden Inn"],
    },
    tiers: ["Member", "Silver", "Gold", "Diamond"],
    requiresCredential: false,
    fields: [
      { key: "tier", label: "Status", type: "select", options: ["Member", "Silver", "Gold", "Diamond"] },
      { key: "membershipNumber", label: "Honors number (optional)", type: "text" },
    ],
    benefits: {
      Member: [
        {
          scope: "brand",
          value: {
            kind: "perk",
            perks: ["Member rate (lowest available)", "Free Wi-Fi"],
            structuredPerks: [
              { type: "free_wifi", label: "Complimentary Wi-Fi" },
            ],
          },
        },
      ],
      Silver: [
        {
          scope: "brand",
          value: {
            kind: "perk",
            perks: ["Free Wi-Fi", "5th night free on points", "Bonus points"],
            structuredPerks: [
              { type: "free_wifi", label: "Complimentary Wi-Fi" },
              { type: "other", label: "5th night free on points redemptions", conditions: { notes: "Every 5th night is free when redeeming points" } },
              { type: "points_bonus", label: "Bonus points on stays" },
            ],
          },
        },
      ],
      // Hilton Gold genuinely includes free breakfast (or daily F&B credit at US
      // hotels) and space-available room upgrades — a real, high-value perk.
      Gold: [
        {
          scope: "brand",
          value: {
            kind: "perk",
            perks: ["Free breakfast (or daily F&B credit)", "Room upgrade (when available)", "Free Wi-Fi"],
            structuredPerks: [
              { type: "free_breakfast", label: "Free breakfast or daily F&B credit", conditions: { notes: "Daily F&B credit at US properties instead of breakfast" } },
              { type: "room_upgrade", label: "Room upgrade when available", conditions: { subjectToAvailability: true } },
              { type: "free_wifi", label: "Complimentary Wi-Fi" },
            ],
          },
        },
      ],
      Diamond: [
        {
          scope: "brand",
          value: {
            kind: "perk",
            perks: ["Free breakfast (or F&B credit)", "Executive lounge access", "Premium room upgrade", "48-hour guarantee"],
            structuredPerks: [
              { type: "free_breakfast", label: "Free breakfast or F&B credit", conditions: { notes: "F&B credit depending on brand and property" } },
              { type: "lounge_access", label: "Executive lounge access" },
              { type: "room_upgrade", label: "Premium room upgrade" },
              { type: "guaranteed_availability", label: "48-hour room guarantee", conditions: { notes: "Guaranteed room availability 48 hours before arrival" } },
            ],
          },
        },
      ],
    },
  },
  {
    id: "marriott_bonvoy",
    name: "Marriott Bonvoy",
    category: "hotel",
    region: "Global",
    asOf: "2026-05",
    sourceUrl: "https://www.marriott.com/loyalty.mi",
    defaultMatch: {
      domains: ["marriott.com"],
      brands: ["Marriott", "Sheraton", "Westin", "Courtyard", "St. Regis", "Ritz-Carlton", "W Hotels", "Le Méridien", "Autograph", "Aloft", "Four Points", "Renaissance", "Moxy"],
    },
    tiers: ["Member", "Silver", "Gold", "Platinum", "Titanium"],
    requiresCredential: false,
    fields: [
      { key: "tier", label: "Status", type: "select", options: ["Member", "Silver", "Gold", "Platinum", "Titanium"] },
      { key: "membershipNumber", label: "Bonvoy number (optional)", type: "text" },
    ],
    benefits: {
      Member: [
        {
          scope: "brand",
          value: {
            kind: "perk",
            perks: ["Member rate", "Free Wi-Fi"],
            structuredPerks: [
              { type: "free_wifi", label: "Complimentary Wi-Fi" },
            ],
          },
        },
      ],
      Silver: [
        {
          scope: "brand",
          value: {
            kind: "perk",
            perks: ["Late check-out (when available)", "10% bonus points"],
            structuredPerks: [
              { type: "late_check_out", label: "Late check-out when available", conditions: { subjectToAvailability: true } },
              { type: "points_bonus", label: "10% bonus points on stays", conditions: { notes: "10% bonus on base point earn rate" } },
            ],
          },
        },
      ],
      // NB: Marriott Gold does NOT include free breakfast — that begins at
      // Platinum (and is brand-dependent). Modelled accurately.
      Gold: [
        {
          scope: "brand",
          value: {
            kind: "perk",
            perks: ["Room upgrade (when available)", "2pm late check-out", "25% bonus points"],
            structuredPerks: [
              { type: "room_upgrade", label: "Room upgrade when available", conditions: { subjectToAvailability: true } },
              { type: "late_check_out", label: "Guaranteed 2pm late check-out", conditions: { notes: "Guaranteed until 2pm" } },
              { type: "points_bonus", label: "25% bonus points on stays", conditions: { notes: "25% bonus on base point earn rate" } },
            ],
          },
        },
      ],
      Platinum: [
        {
          scope: "brand",
          value: {
            kind: "perk",
            perks: ["Free breakfast (most brands)", "Lounge access", "Suite upgrade (when available)", "4pm late check-out"],
            structuredPerks: [
              { type: "free_breakfast", label: "Free breakfast at most Marriott brands", conditions: { notes: "Most Marriott Bonvoy brands; some exclusions apply" } },
              { type: "lounge_access", label: "Club lounge access" },
              { type: "suite_upgrade", label: "Suite upgrade when available", conditions: { subjectToAvailability: true } },
              { type: "late_check_out", label: "Guaranteed 4pm late check-out", conditions: { notes: "Guaranteed until 4pm" } },
            ],
          },
        },
      ],
      Titanium: [
        {
          scope: "brand",
          value: {
            kind: "perk",
            perks: ["Free breakfast (most brands)", "Lounge access", "Suite upgrade (when available)", "Guaranteed 4pm late check-out", "Choice benefit"],
            structuredPerks: [
              { type: "free_breakfast", label: "Free breakfast at most Marriott brands", conditions: { notes: "Most Marriott Bonvoy brands; some exclusions apply" } },
              { type: "lounge_access", label: "Club lounge access" },
              { type: "suite_upgrade", label: "Suite upgrade when available", conditions: { subjectToAvailability: true } },
              { type: "late_check_out", label: "Guaranteed 4pm late check-out", conditions: { subjectToAvailability: false, notes: "Guaranteed until 4pm" } },
              { type: "other", label: "Annual Titanium choice benefit", conditions: { notes: "Select one annual benefit from Marriott's choice list" } },
            ],
          },
        },
      ],
    },
  },

  // ── Cards / fintech (broader than hospitality) ───────────────────────────
  {
    id: "amex_platinum",
    name: "American Express Platinum",
    category: "card",
    region: "US (benefits vary by region)",
    asOf: "2026-05",
    sourceUrl: "https://www.americanexpress.com/us/credit-cards/card/platinum/",
    // Perks are account-level (status, credits, lounges), not on-site discounts,
    // so they are global perks. The hotel elite status is the part most likely
    // to matter on a hotel page.
    defaultMatch: { categories: ["hotel", "card"] },
    requiresCredential: false,
    fields: [],
    benefits: {
      "*": [
        {
          scope: "global",
          value: {
            kind: "perk",
            perks: ["Marriott Bonvoy Gold status (when enrolled)", "Hilton Honors Gold status (when enrolled)"],
            conditions: "enrolment required; US card — benefits vary by market",
            structuredPerks: [
              { type: "other", label: "Marriott Bonvoy Gold status", conditions: { enrollmentRequired: true, notes: "US card; enrolment required via Amex; benefits vary by market" } },
              { type: "other", label: "Hilton Honors Gold status", conditions: { enrollmentRequired: true, notes: "US card; enrolment required via Amex; benefits vary by market" } },
            ],
          },
        },
        {
          scope: "global",
          value: {
            kind: "perk",
            perks: ["Fine Hotels + Resorts: free breakfast, room upgrade, late checkout, on-property credit", "Airport lounge access (Centurion / Priority Pass)"],
            conditions: "FH+R via Amex Travel",
            structuredPerks: [
              { type: "free_breakfast", label: "Free breakfast via Fine Hotels + Resorts", conditions: { notes: "Booked via Amex Fine Hotels + Resorts programme" } },
              { type: "room_upgrade", label: "Room upgrade via Fine Hotels + Resorts", conditions: { notes: "Booked via Amex Fine Hotels + Resorts programme" } },
              { type: "late_check_out", label: "Late check-out via Fine Hotels + Resorts", conditions: { notes: "Booked via Amex Fine Hotels + Resorts programme" } },
              { type: "spa_credit", label: "On-property credit via Fine Hotels + Resorts", conditions: { notes: "On-property credit; amount varies by property" } },
              { type: "lounge_access", label: "Airport lounge access (Centurion and Priority Pass)", conditions: { notes: "Access to Centurion Lounges and Priority Pass network" } },
            ],
          },
        },
      ],
    },
  },
  {
    id: "revolut",
    name: "Revolut",
    category: "subscription",
    region: "EEA/UK (perks vary by country)",
    asOf: "2026-05",
    sourceUrl: "https://www.revolut.com/our-pricing-plans/",
    // Value is mostly account-level (FX, fee-free ATM, lounge, insurance,
    // partner subscriptions), not a hotel/site discount. Modelled as global
    // perks. Partner line-up and limits change frequently and vary by country.
    defaultMatch: { categories: ["subscription"] },
    tiers: ["Standard", "Plus", "Premium", "Metal", "Ultra"],
    requiresCredential: false,
    fields: [{ key: "tier", label: "Plan", type: "select", options: ["Standard", "Plus", "Premium", "Metal", "Ultra"] }],
    benefits: {
      Premium: [
        {
          scope: "global",
          value: {
            kind: "perk",
            perks: ["Unlimited interbank FX", "Fee-free ATM withdrawals (monthly limit)", "Partner subscriptions (e.g. Headspace)", "Purchase protection"],
            structuredPerks: [
              { type: "other", label: "Unlimited interbank foreign exchange" },
              { type: "other", label: "Fee-free ATM withdrawals up to monthly limit" },
              { type: "other", label: "Partner subscription benefits (e.g. Headspace)" },
              { type: "other", label: "Purchase protection insurance" },
            ],
          },
        },
      ],
      Metal: [
        {
          scope: "global",
          value: {
            kind: "perk",
            perks: ["Unlimited interbank FX", "Free Financial Times & The Athletic", "WeWork & ClassPass credits", "Discounted airport lounge access", "Travel & purchase insurance", "Higher cashback/points"],
            structuredPerks: [
              { type: "other", label: "Unlimited interbank foreign exchange" },
              { type: "other", label: "Free Financial Times and The Athletic subscriptions" },
              { type: "other", label: "WeWork and ClassPass credits" },
              { type: "lounge_access", label: "Discounted airport lounge access", conditions: { notes: "Discounted rate; not complimentary" } },
              { type: "other", label: "Travel and purchase insurance" },
              { type: "points_bonus", label: "Higher cashback and rewards earn" },
            ],
          },
        },
      ],
      Ultra: [
        {
          scope: "global",
          value: {
            kind: "perk",
            perks: ["Fee-free international transfers", "Unlimited worldwide airport lounge access", "Comprehensive travel & medical insurance", "Free eSIM data allowance", "Premium partner subscriptions", "Top-tier points earn"],
            structuredPerks: [
              { type: "other", label: "Fee-free international transfers" },
              { type: "lounge_access", label: "Unlimited worldwide airport lounge access", conditions: { notes: "Unlimited access to worldwide lounge network" } },
              { type: "other", label: "Comprehensive travel and medical insurance" },
              { type: "other", label: "Free eSIM data allowance" },
              { type: "other", label: "Premium partner subscription benefits" },
              { type: "points_bonus", label: "Top-tier points and cashback earn" },
            ],
          },
        },
      ],
    },
  },
  {
    id: "miles_and_more",
    name: "Miles & More (Lufthansa Group)",
    category: "airline",
    region: "Global",
    asOf: "2026-05",
    sourceUrl: "https://www.miles-and-more.com/",
    defaultMatch: { brands: ["Lufthansa", "Austrian Airlines", "SWISS", "Brussels Airlines"], domains: ["lufthansa.com"] },
    requiresCredential: false,
    fields: [{ key: "membershipNumber", label: "Card number (optional)", type: "text" }],
    benefits: {
      "*": [
        {
          scope: "brand",
          value: {
            kind: "pointsEarn",
            pointsPerUnit: 1,
            perks: ["Earns award miles"],
            structuredPerks: [
              { type: "points_bonus", label: "Earns Lufthansa Group award miles" },
            ],
          },
        },
      ],
    },
  },

  // ── Czech hotels — direct booking (seed; precursor to the crawler #99) ─────
  {
    id: "orea_hotels",
    name: "OREA Hotels & Resorts",
    category: "hotel",
    region: "CZ",
    asOf: "2026-06",
    sourceUrl: "https://www.orea.cz/en",
    // Direct-booking benefits (no public loyalty club): free parking and free
    // stay for children under 6 at selected hotels when booking on orea.cz.
    // No headline % is advertised → modelled as perks (never a price).
    realizationUrl: "https://www.orea.cz/en/hotels-apartments",
    defaultMatch: { brands: ["OREA", "OREA Hotels", "OREA Resort"], domains: ["orea.cz"], categories: ["hotel"] },
    requiresCredential: false,
    fields: [],
    benefits: {
      "*": [
        {
          scope: "brand",
          value: {
            kind: "perk",
            perks: ["Free parking at selected hotels", "Free stay for children under 6"],
            structuredPerks: [
              { type: "parking", label: "Free parking at selected hotels", conditions: { subjectToAvailability: true, bookingChannel: ["direct"] } },
              { type: "other", label: "Free stay for children under 6", conditions: { bookingChannel: ["direct"] } },
            ],
            conditions: "book direct at orea.cz; selected hotels",
            realizationUrl: "https://www.orea.cz/en/hotels-apartments",
          },
        },
      ],
    },
  },

  {
    id: "cpi_hotels",
    name: "CPI Hotels (Clarion, Spa & Wellness Nature Resorts)",
    category: "hotel",
    region: "CZ",
    asOf: "2026-06",
    sourceUrl: "https://www.cpihotels.com/rewards-program",
    // CPI Hotels rewards program: members earn points and unlock perks on direct
    // bookings. No headline % advertised → modelled as a points/perk benefit
    // (never a price). Covers Clarion, Spa & Wellness Nature Resorts, etc.
    realizationUrl: "https://www.cpihotels.com/reservation",
    defaultMatch: { brands: ["CPI Hotels", "Clarion", "Clarion Congress", "Spa & Wellness Nature Resorts", "Buddha-Bar Hotel"], domains: ["cpihotels.com"], categories: ["hotel"] },
    requiresCredential: false,
    fields: [],
    benefits: {
      "*": [
        {
          scope: "brand",
          value: {
            kind: "perk",
            perks: ["Loyalty points on direct bookings", "Member perks"],
            structuredPerks: [
              { type: "points_bonus", label: "Loyalty points on direct bookings", conditions: { bookingChannel: ["direct"] } },
            ],
            conditions: "join CPI Hotels rewards; book direct at cpihotels.com",
            realizationUrl: "https://www.cpihotels.com/reservation",
          },
        },
      ],
    },
  },
];

const BY_ID = new Map(PROGRAMS.map((p) => [p.id, p]));

export function getProgram(id: string): Program | undefined {
  return BY_ID.get(id);
}

/** Templates that apply for a given tier: the "*" base plus tier-specific. */
export function templatesForTier(program: Program, tier?: string): BenefitTemplate[] {
  const base = program.benefits["*"] ?? [];
  const tiered = tier ? program.benefits[tier] ?? [] : [];
  return [...base, ...tiered];
}

/** Instantiate concrete benefits for a program/tier the user selected. */
export function instantiateBenefits(program: Program, tier?: string): Benefit[] {
  return templatesForTier(program, tier).map((t) => ({
    id: randomUUID(),
    scope: t.scope,
    match: t.match ?? program.defaultMatch,
    value: t.value,
    source: "catalog" as const,
    programId: program.id,
  }));
}

/** A plain-language summary of what a program/tier brings (for the UI). */
export function summariseBenefits(templates: BenefitTemplate[]): string[] {
  const out: string[] = [];
  for (const t of templates) {
    const v = t.value;
    if (v.kind === "percentDiscount" && v.percentOff) out.push(`${Math.round(v.percentOff * 100)}% off`);
    else if (v.kind === "fixedDiscount" && v.amountOff) out.push(`${v.amountOff} off`);
    else if (v.kind === "pointsEarn") out.push("Earns points/miles");
    for (const p of v.perks ?? []) out.push(p);
  }
  return [...new Set(out)];
}
