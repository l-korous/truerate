import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createCipheriv, randomBytes } from "node:crypto";

const ALGO = "aes-256-gcm";

// Active key used by most tests
const TEST_KEY = randomBytes(32);
const TEST_VERSION = "testkey-v1";

before(() => {
  process.env.TRUERATE_CRED_KEY = `${TEST_VERSION}:${TEST_KEY.toString("base64")}`;
  delete process.env.TRUERATE_CRED_KEY_PREV;
});

after(() => {
  delete process.env.TRUERATE_CRED_KEY_PREV;
});

/** Build a legacy (v1) bare-base64 blob directly, bypassing encryptCredential. */
function makeLegacyBlob(plaintext: Record<string, string>, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(plaintext), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, data]).toString("base64");
}

// ─── Basic round-trip ────────────────────────────────────────────────────────

test("encrypt/decrypt round-trips the payload", async () => {
  const { encryptCredential, decryptCredential } = await import("../src/crypto.js");
  const secret = { password: "hunter2", token: "abc-123" };
  const blob = encryptCredential(secret);
  assert.notEqual(blob, JSON.stringify(secret));
  assert.deepEqual(decryptCredential(blob), secret);
});

test("versioned blob starts with v2:", async () => {
  const { encryptCredential } = await import("../src/crypto.js");
  const blob = encryptCredential({ x: "y" });
  assert.ok(blob.startsWith("v2:"), `Expected "v2:" prefix, got: ${blob.slice(0, 20)}`);
});

test("versioned blob embeds the active key version ID", async () => {
  const { encryptCredential } = await import("../src/crypto.js");
  const blob = encryptCredential({ x: "y" });
  assert.ok(blob.startsWith(`v2:${TEST_VERSION}:`));
});

test("ciphertext is non-deterministic (random IV)", async () => {
  const { encryptCredential } = await import("../src/crypto.js");
  const a = encryptCredential({ password: "x" });
  const b = encryptCredential({ password: "x" });
  assert.notEqual(a, b);
});

// ─── Tamper / auth-tag check ─────────────────────────────────────────────────

test("tampered ciphertext fails authentication", async () => {
  const { encryptCredential, decryptCredential } = await import("../src/crypto.js");
  const blob = encryptCredential({ password: "x" });
  // blob: v2:<version>:<base64-payload>
  const secondColon = blob.indexOf(":", 3);
  const prefix = blob.slice(0, secondColon + 1);
  const raw = Buffer.from(blob.slice(secondColon + 1), "base64");
  raw[raw.length - 1] ^= 0xff; // flip a byte in the ciphertext
  const tampered = prefix + raw.toString("base64");
  assert.throws(() => decryptCredential(tampered));
});

// ─── Key validation ──────────────────────────────────────────────────────────

test("rejects a key that is not 32 bytes", async () => {
  const original = process.env.TRUERATE_CRED_KEY;
  process.env.TRUERATE_CRED_KEY = Buffer.from("too-short").toString("base64");
  const { encryptCredential } = await import("../src/crypto.js");
  assert.throws(() => encryptCredential({ a: "b" }), /32 bytes/);
  process.env.TRUERATE_CRED_KEY = original;
});

// ─── Legacy blob fallback ────────────────────────────────────────────────────

test("legacy blob (no v2 prefix) decrypts with the active key", async () => {
  const { decryptCredential } = await import("../src/crypto.js");
  const secret = { legacy: "credential" };
  const legacyBlob = makeLegacyBlob(secret, TEST_KEY);
  assert.ok(!legacyBlob.startsWith("v2:"), "sanity: blob must lack version prefix");
  assert.deepEqual(decryptCredential(legacyBlob), secret);
});

// ─── Keyset lookup (key rotation) ────────────────────────────────────────────

test("keyset lookup: decrypts blob encrypted with previous key version", async () => {
  const { encryptCredential, decryptCredential } = await import("../src/crypto.js");
  const oldKey = randomBytes(32);
  const newKey = randomBytes(32);
  const oldVer = "prev-key";
  const newVer = "next-key";
  const secret = { cred: "old-encrypted" };

  const savedKey = process.env.TRUERATE_CRED_KEY;

  // Encrypt with the old key
  process.env.TRUERATE_CRED_KEY = `${oldVer}:${oldKey.toString("base64")}`;
  delete process.env.TRUERATE_CRED_KEY_PREV;
  const blob = encryptCredential(secret);
  assert.ok(blob.startsWith(`v2:${oldVer}:`));

  // Rotate to new key, retain old in PREV
  process.env.TRUERATE_CRED_KEY = `${newVer}:${newKey.toString("base64")}`;
  process.env.TRUERATE_CRED_KEY_PREV = `${oldVer}:${oldKey.toString("base64")}`;

  // Old blob should still decrypt via the keyset
  assert.deepEqual(decryptCredential(blob), secret);

  // Restore
  process.env.TRUERATE_CRED_KEY = savedKey!;
  delete process.env.TRUERATE_CRED_KEY_PREV;
});

test("unknown key version throws on decrypt", async () => {
  const { encryptCredential, decryptCredential } = await import("../src/crypto.js");
  const savedKey = process.env.TRUERATE_CRED_KEY;

  // Encrypt with version "known"
  process.env.TRUERATE_CRED_KEY = `known:${randomBytes(32).toString("base64")}`;
  delete process.env.TRUERATE_CRED_KEY_PREV;
  const blob = encryptCredential({ x: "y" });

  // Switch to a different active key without keeping the old one as PREV
  process.env.TRUERATE_CRED_KEY = `other:${randomBytes(32).toString("base64")}`;
  delete process.env.TRUERATE_CRED_KEY_PREV;
  assert.throws(() => decryptCredential(blob), /unknown key version/i);

  // Restore
  process.env.TRUERATE_CRED_KEY = savedKey!;
  delete process.env.TRUERATE_CRED_KEY_PREV;
});

// ─── reEncryptCredential ─────────────────────────────────────────────────────

test("reEncryptCredential migrates blob to active key", async () => {
  const { encryptCredential, decryptCredential, reEncryptCredential } = await import(
    "../src/crypto.js"
  );
  const oldKey = randomBytes(32);
  const newKey = randomBytes(32);
  const oldVer = "old";
  const newVer = "new";
  const secret = { cred: "to-migrate" };

  const savedKey = process.env.TRUERATE_CRED_KEY;

  // Encrypt with old key
  process.env.TRUERATE_CRED_KEY = `${oldVer}:${oldKey.toString("base64")}`;
  delete process.env.TRUERATE_CRED_KEY_PREV;
  const oldBlob = encryptCredential(secret);

  // Rotate to new key
  process.env.TRUERATE_CRED_KEY = `${newVer}:${newKey.toString("base64")}`;
  process.env.TRUERATE_CRED_KEY_PREV = `${oldVer}:${oldKey.toString("base64")}`;

  const newBlob = reEncryptCredential(oldBlob);
  assert.ok(newBlob.startsWith(`v2:${newVer}:`), "new blob must use the new version ID");
  assert.deepEqual(decryptCredential(newBlob), secret, "plaintext must survive re-encryption");

  // Restore
  process.env.TRUERATE_CRED_KEY = savedKey!;
  delete process.env.TRUERATE_CRED_KEY_PREV;
});

test("reEncryptCredential round-trips a legacy blob", async () => {
  const { decryptCredential, reEncryptCredential } = await import("../src/crypto.js");
  const secret = { legacy: "migrate-me" };
  const legacyBlob = makeLegacyBlob(secret, TEST_KEY);

  const newBlob = reEncryptCredential(legacyBlob);
  assert.ok(newBlob.startsWith(`v2:${TEST_VERSION}:`), "re-encrypted blob must use active version");
  assert.deepEqual(decryptCredential(newBlob), secret);
});
