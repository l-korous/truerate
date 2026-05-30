import { test, before } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

before(() => {
  process.env.TRUERATE_CRED_KEY = randomBytes(32).toString("base64");
});

test("encrypt/decrypt round-trips the payload", async () => {
  const { encryptCredential, decryptCredential } = await import("../src/crypto.js");
  const secret = { password: "hunter2", token: "abc-123" };
  const blob = encryptCredential(secret);
  assert.notEqual(blob, JSON.stringify(secret));
  assert.deepEqual(decryptCredential(blob), secret);
});

test("ciphertext is non-deterministic (random IV)", async () => {
  const { encryptCredential } = await import("../src/crypto.js");
  const a = encryptCredential({ password: "x" });
  const b = encryptCredential({ password: "x" });
  assert.notEqual(a, b);
});

test("tampered ciphertext fails authentication", async () => {
  const { encryptCredential, decryptCredential } = await import("../src/crypto.js");
  const blob = encryptCredential({ password: "x" });
  const raw = Buffer.from(blob, "base64");
  raw[raw.length - 1] ^= 0xff; // flip a byte in the ciphertext
  const tampered = raw.toString("base64");
  assert.throws(() => decryptCredential(tampered));
});

test("rejects a key that is not 32 bytes", async () => {
  const original = process.env.TRUERATE_CRED_KEY;
  process.env.TRUERATE_CRED_KEY = Buffer.from("too-short").toString("base64");
  const { encryptCredential } = await import("../src/crypto.js");
  assert.throws(() => encryptCredential({ a: "b" }), /32 bytes/);
  process.env.TRUERATE_CRED_KEY = original;
});
