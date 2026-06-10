import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { getUsageRepo, resetUsageRepo, recordUsageSafe, type UsageEventInput } from "../src/usage-db.js";

process.env["TRUERATE_INMEMORY"] = "true";

beforeEach(() => resetUsageRepo());

function ev(over: Partial<UsageEventInput> = {}): UsageEventInput {
  return {
    channel: "mcp",
    programId: "booking_genius",
    perkType: "free_breakfast",
    benefitKind: "perk",
    country: "CZ",
    userIdHash: "hash-1",
    ...over,
  };
}

test("aggregate counts by provider, perk, country, and day", async () => {
  const repo = await getUsageRepo();
  await repo.recordMany([
    ev({ programId: "booking_genius", perkType: "free_breakfast" }),
    ev({ programId: "booking_genius", perkType: "room_upgrade" }),
    ev({ programId: "hilton_honors", perkType: "free_breakfast", country: "DE" }),
  ]);

  const agg = await repo.aggregate();
  assert.equal(agg.total, 3);
  assert.deepEqual(agg.byProvider, [
    { key: "booking_genius", count: 2 },
    { key: "hilton_honors", count: 1 },
  ]);
  assert.deepEqual(agg.byPerk, [
    { key: "free_breakfast", count: 2 },
    { key: "room_upgrade", count: 1 },
  ]);
  assert.equal(agg.byCountry.find((b) => b.key === "CZ")?.count, 2);
  assert.equal(agg.byCountry.find((b) => b.key === "DE")?.count, 1);
  assert.equal(agg.byDay.length, 1, "all recorded same day");
});

test("buckets are sorted by count descending", async () => {
  const repo = await getUsageRepo();
  await repo.recordMany([
    ev({ programId: "a" }), ev({ programId: "a" }), ev({ programId: "a" }),
    ev({ programId: "b" }), ev({ programId: "b" }),
    ev({ programId: "c" }),
  ]);
  const agg = await repo.aggregate();
  assert.deepEqual(agg.byProvider.map((b) => b.key), ["a", "b", "c"]);
});

test("country filter scopes the aggregation (per-country leaderboard)", async () => {
  const repo = await getUsageRepo();
  await repo.recordMany([
    ev({ programId: "orea", country: "CZ" }),
    ev({ programId: "orea", country: "CZ" }),
    ev({ programId: "accor_all", country: "DE" }),
  ]);
  const cz = await repo.aggregate({ country: "CZ" });
  assert.equal(cz.total, 2);
  assert.deepEqual(cz.byProvider, [{ key: "orea", count: 2 }]);
});

test("channel and programId filters work", async () => {
  const repo = await getUsageRepo();
  await repo.recordMany([
    ev({ channel: "mcp", programId: "booking_genius" }),
    ev({ channel: "extension", programId: "booking_genius" }),
    ev({ channel: "extension", programId: "hilton_honors" }),
  ]);
  assert.equal((await repo.aggregate({ channel: "extension" })).total, 2);
  assert.equal((await repo.aggregate({ programId: "booking_genius" })).total, 2);
  assert.equal((await repo.aggregate({ channel: "mcp", programId: "booking_genius" })).total, 1);
});

test("discount-only events (no perkType) are counted for provider but not perk", async () => {
  const repo = await getUsageRepo();
  await repo.recordMany([
    { channel: "mcp", programId: "booking_genius", benefitKind: "percentDiscount", userIdHash: "h", country: "CZ" },
  ]);
  const agg = await repo.aggregate();
  assert.equal(agg.total, 1);
  assert.equal(agg.byProvider[0]?.key, "booking_genius");
  assert.equal(agg.byPerk.length, 0, "no perkType → no perk bucket");
});

test("recorded events never contain price/money fields (rule #1)", async () => {
  const repo = await getUsageRepo();
  await repo.recordMany([ev(), ev({ benefitKind: "percentDiscount", perkType: undefined })]);
  const agg = await repo.aggregate();
  const serialised = JSON.stringify(agg);
  for (const k of ["price", "amount", "amountOff", "percentOff", "memberPrice", "savings", "currency"]) {
    assert.ok(!serialised.includes(`"${k}"`), `usage aggregation must not contain '${k}'`);
  }
});

test("recordUsageSafe records via the singleton and tolerates empty input", async () => {
  await recordUsageSafe([]); // no-op, must not throw
  await recordUsageSafe([ev({ programId: "revolut" })]);
  const repo = await getUsageRepo();
  const agg = await repo.aggregate();
  assert.equal(agg.byProvider.find((b) => b.key === "revolut")?.count, 1);
});
