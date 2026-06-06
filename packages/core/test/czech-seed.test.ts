import { test } from "node:test";
import assert from "node:assert/strict";
import { PROGRAMS } from "../src/programs.js";

// Seed for the Czech direct-booking catalog (precursor to crawler #99). Guards
// that each seed program carries a realization URL (#311) and never a price.
test("Czech direct-booking seed programs carry a realization URL and no price", () => {
  for (const id of ["orea_hotels", "cpi_hotels"]) {
    const p = PROGRAMS.find((x) => x.id === id);
    assert.ok(p, `program ${id} present in catalog`);
    assert.equal(p!.region, "CZ");
    assert.ok(p!.realizationUrl?.startsWith("https://"), `${id} program has a realization URL`);
    assert.ok(p!.sourceUrl?.startsWith("https://"), `${id} has a source URL`);

    const values = Object.values(p!.benefits).flat().map((t) => t.value);
    assert.ok(values.length > 0, `${id} has benefits`);
    assert.ok(
      values.some((v) => typeof v.realizationUrl === "string" && v.realizationUrl.startsWith("https://")),
      `${id} benefit value carries the realization URL`,
    );
    // No prices: these are perk-based direct-booking benefits.
    for (const v of values) {
      assert.equal(v.kind, "perk", `${id} benefit is a perk (no invented discount %)`);
      assert.equal(v.amountOff, undefined, `${id} carries no fixed amount`);
      assert.equal(v.percentOff, undefined, `${id} carries no percent (none advertised)`);
    }
  }
});
