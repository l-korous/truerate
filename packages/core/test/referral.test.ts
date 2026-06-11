import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  getReferralRepo,
  resetReferralRepo,
  generateReferralCode,
  REFERRAL_REWARD_DAYS,
} from "../src/referral.js";

beforeEach(() => {
  process.env.TRUERATE_INMEMORY = "true";
  resetReferralRepo();
});

test("generateReferralCode: produces an 8-char URL-safe string", () => {
  const code = generateReferralCode();
  assert.equal(code.length, 8);
  assert.match(code, /^[A-Za-z2-9]{8}$/);
});

test("generateReferralCode: produces different codes each call", () => {
  const codes = new Set(Array.from({ length: 20 }, () => generateReferralCode()));
  // Extremely unlikely to have a collision in 20 draws from 56^8 space.
  assert.ok(codes.size > 1, "expected distinct codes");
});

test("REFERRAL_REWARD_DAYS is 90", () => {
  assert.equal(REFERRAL_REWARD_DAYS, 90);
});

test("getOrCreateCode: returns stable code for same hotel", async () => {
  const repo = await getReferralRepo();
  const first = await repo.getOrCreateCode("hotel-1");
  const second = await repo.getOrCreateCode("hotel-1");
  assert.equal(first.code, second.code);
  assert.equal(first.hotelId, "hotel-1");
});

test("getOrCreateCode: different hotels get different codes", async () => {
  const repo = await getReferralRepo();
  const a = await repo.getOrCreateCode("hotel-a");
  const b = await repo.getOrCreateCode("hotel-b");
  assert.notEqual(a.code, b.code);
});

test("lookupByCode: finds the right hotel", async () => {
  const repo = await getReferralRepo();
  const { code } = await repo.getOrCreateCode("hotel-x");
  const found = await repo.lookupByCode(code);
  assert.ok(found);
  assert.equal(found.hotelId, "hotel-x");
});

test("lookupByCode: returns null for unknown code", async () => {
  const repo = await getReferralRepo();
  const result = await repo.lookupByCode("NOTEXIST");
  assert.equal(result, null);
});

test("createReferral: records pending referral", async () => {
  const repo = await getReferralRepo();
  const rec = await repo.createReferral("referrer-1", "referee-1", "CODE1234");
  assert.equal(rec.referrerId, "referrer-1");
  assert.equal(rec.refereeId, "referee-1");
  assert.equal(rec.status, "pending");
  assert.ok(rec.id);
});

test("getPendingForReferee: returns the pending record", async () => {
  const repo = await getReferralRepo();
  await repo.createReferral("r1", "e1", "X");
  const found = await repo.getPendingForReferee("e1");
  assert.ok(found);
  assert.equal(found.referrerId, "r1");
  assert.equal(found.status, "pending");
});

test("getPendingForReferee: returns null when none", async () => {
  const repo = await getReferralRepo();
  assert.equal(await repo.getPendingForReferee("nobody"), null);
});

test("markRewarded: transitions status to rewarded", async () => {
  const repo = await getReferralRepo();
  const rec = await repo.createReferral("r2", "e2", "Y");
  const rewarded = await repo.markRewarded(rec.id);
  assert.equal(rewarded.status, "rewarded");
  assert.ok(rewarded.rewardedAt);
});

test("getRewardedForReferee: finds rewarded record", async () => {
  const repo = await getReferralRepo();
  const rec = await repo.createReferral("r3", "e3", "Z");
  await repo.markRewarded(rec.id);

  assert.equal(await repo.getPendingForReferee("e3"), null);
  const found = await repo.getRewardedForReferee("e3");
  assert.ok(found);
  assert.equal(found.status, "rewarded");
});

test("listByReferrer: returns all referrals for a referrer", async () => {
  const repo = await getReferralRepo();
  await repo.createReferral("host", "guest-a", "C1");
  await repo.createReferral("host", "guest-b", "C2");
  await repo.createReferral("other", "guest-c", "C3");

  const list = await repo.listByReferrer("host");
  assert.equal(list.length, 2);
  assert.ok(list.every((r) => r.referrerId === "host"));
});

test("listByReferrer: empty list when no referrals", async () => {
  const repo = await getReferralRepo();
  assert.deepEqual(await repo.listByReferrer("no-one"), []);
});
