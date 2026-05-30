import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getProgram,
  instantiateBenefits,
  PROGRAMS,
  summariseBenefits,
  templatesForTier,
} from "../src/programs.js";
import { BookingProvider } from "../src/providers/booking.js";

test("catalog is non-empty with unique ids", () => {
  assert.ok(PROGRAMS.length > 0);
  const ids = PROGRAMS.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("getProgram resolves known and unknown ids", () => {
  assert.equal(getProgram("booking_genius")?.name, "Booking.com Genius");
  assert.equal(getProgram("nope"), undefined);
});

test("instantiateBenefits builds catalog-sourced benefits with resolved match", () => {
  const program = getProgram("booking_genius")!;
  const benefits = instantiateBenefits(program, "Level 3");
  assert.ok(benefits.length >= 1);
  for (const b of benefits) {
    assert.equal(b.source, "catalog");
    assert.equal(b.programId, "booking_genius");
    assert.ok(b.match, "match must be resolved (inherited from defaultMatch)");
    assert.ok(b.id);
  }
  // Level 3 should include a 20% discount.
  assert.ok(benefits.some((b) => b.value.kind === "percentDiscount" && b.value.percentOff === 0.2));
});

test("Revolut Metal benefits include real partner perks (FT, lounge)", () => {
  const program = getProgram("revolut")!;
  const benefits = instantiateBenefits(program, "Metal");
  const perks = benefits.flatMap((b) => b.value.perks ?? []);
  assert.ok(perks.some((p) => /financial times/i.test(p)));
  assert.ok(perks.some((p) => /lounge/i.test(p)));
});

test("summariseBenefits renders human-readable lines", () => {
  const program = getProgram("hilton_honors")!;
  const summary = summariseBenefits(templatesForTier(program, "Gold"));
  assert.ok(summary.some((s) => /breakfast/i.test(s)));
});

test("Booking mock is deterministic and carries brands", async () => {
  const q = { location: "Vienna", checkIn: "2026-08-01", checkOut: "2026-08-03", adults: 2, rooms: 1, currency: "EUR", limit: 6 };
  const a = await new BookingProvider().search(q);
  const b = await new BookingProvider().search(q);
  assert.deepEqual(a.map((x) => [x.name, x.publicOffer.nightlyAmount]), b.map((x) => [x.name, x.publicOffer.nightlyAmount]));
  assert.ok(a.some((x) => x.brand === "Marriott"));
  assert.ok(a.some((x) => x.brand === undefined), "expected some independent hotels");
});
