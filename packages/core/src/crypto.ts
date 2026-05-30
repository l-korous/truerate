import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// Membership credentials (passwords, session tokens) are encrypted before they
// ever touch the database, using AES-256-GCM with a key held in Azure Key
// Vault. The key is injected into the process via managed identity at runtime
// (see infra/README) and read from TRUERATE_CRED_KEY here. The DB only ever
// sees ciphertext; a database compromise alone does not expose credentials.
//
// Format of the stored blob (base64 of):  [12-byte IV][16-byte tag][ciphertext]

const ALGO = "aes-256-gcm";

function loadKey(): Buffer {
  const b64 = process.env.TRUERATE_CRED_KEY;
  if (!b64) {
    throw new Error(
      "TRUERATE_CRED_KEY is not set. Generate one with: " +
        `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`,
    );
  }
  const key = Buffer.from(b64, "base64");
  if (key.length !== 32) {
    throw new Error("TRUERATE_CRED_KEY must decode to exactly 32 bytes (AES-256).");
  }
  return key;
}

export function encryptCredential(plaintext: Record<string, string>): string {
  const key = loadKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  const data = Buffer.concat([
    cipher.update(JSON.stringify(plaintext), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, data]).toString("base64");
}

export function decryptCredential(blob: string): Record<string, string> {
  const key = loadKey();
  const raw = Buffer.from(blob, "base64");
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const data = raw.subarray(28);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const out = Buffer.concat([decipher.update(data), decipher.final()]);
  return JSON.parse(out.toString("utf8"));
}
