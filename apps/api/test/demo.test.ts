import { test, before } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

// Public "TrueRate for your hotel" demo endpoints (apps/api/src/demo.ts).

before(() => {
  process.env.TRUERATE_INMEMORY = "true";
  process.env.TRUERATE_JWT_SECRET = "demo-test";
  process.env.TRUERATE_CRED_KEY = randomBytes(32).toString("base64");
});

async function getApp() {
  const { app } = await import("../src/app.js");
  return app;
}

test("/stats/overview reports platform scale (hotels, programs, countries)", async () => {
  const app = await getApp();
  const r = await app.request("/stats/overview");
  assert.equal(r.status, 200);
  const s = (await r.json()) as { hotelsCovered: number; programs: number; countries: number };
  assert.ok(s.hotelsCovered > 1000, `directory loaded with thousands of hotels (got ${s.hotelsCovered})`);
  assert.ok(s.programs >= 12, "catalog programs present");
  assert.ok(s.countries >= 10, "many countries covered");
});

test("/demo/hotel for a chain returns member programs with perk-value estimates", async () => {
  const app = await getApp();
  const r = await app.request("/demo/hotel?q=Marriott");
  assert.equal(r.status, 200);
  const d = (await r.json()) as { memberPrograms: { programId: string; summary: string[]; perkValues: { estUsd: number }[] }[] };
  const bonvoy = d.memberPrograms.find((p) => p.programId === "marriott_bonvoy");
  assert.ok(bonvoy, "Marriott Bonvoy surfaced for 'Marriott'");
  assert.ok(bonvoy!.summary.length > 0, "has a perk summary");
  assert.ok(bonvoy!.perkValues.some((v) => v.estUsd > 0), "has perk value estimates");
});

test("/demo/hotel returns well-formed book-direct options from the directory", async () => {
  const app = await getApp();
  const r = await app.request("/demo/hotel?q=Hotel Praha");
  assert.equal(r.status, 200);
  const d = (await r.json()) as { directBooking: { name: string; realizationUrl: string }[] };
  assert.ok(Array.isArray(d.directBooking));
  for (const h of d.directBooking) {
    assert.ok(h.name && h.realizationUrl, "each book-direct option has a name + URL");
  }
});

test("/demo/hotel never leaks hotel prices/rates (perk value estimates are allowed)", async () => {
  const app = await getApp();
  const raw = (await (await app.request("/demo/hotel?q=Hilton")).text()).toLowerCase();
  for (const k of ["nightly", "roomrate", "\"rate\"", "memberprice", "\"price\"", "perroom"]) {
    assert.ok(!raw.includes(k), `must not contain '${k}'`);
  }
});

test("/demo/hotel requires a query", async () => {
  const app = await getApp();
  assert.equal((await app.request("/demo/hotel")).status, 400);
});
