import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// Membership credentials (passwords, session tokens) are encrypted before they
// ever touch the database, using AES-256-GCM with a key held in Azure Key
// Vault. The key is injected via managed identity at runtime and read from
// TRUERATE_CRED_KEY here. The DB only ever sees ciphertext; a database
// compromise alone does not expose credentials.
//
// Blob format v2 (versioned):
//   v2:<key-version-id>:<base64([12-byte IV][16-byte GCM tag][ciphertext])>
//
// Blob format legacy (v1):
//   <base64([12-byte IV][16-byte GCM tag][ciphertext])>
//
// Key env vars (both accept "<version-id>:<base64-32-bytes>" or bare base64):
//   TRUERATE_CRED_KEY      — active key used for encryption
//   TRUERATE_CRED_KEY_PREV — previous key kept during rotation (optional)

const ALGO = "aes-256-gcm";

interface KeyEntry {
  versionId: string;
  key: Buffer;
}

interface Keyset {
  active: KeyEntry;
  map: Map<string, Buffer>;
}

function parseKeyEntry(raw: string, envVar: string): KeyEntry {
  const colonIdx = raw.indexOf(":");
  // Colon is not a base64 character, so any colon means it's the versioned format.
  if (colonIdx > 0) {
    const versionId = raw.slice(0, colonIdx);
    const key = Buffer.from(raw.slice(colonIdx + 1), "base64");
    if (key.length !== 32) {
      throw new Error(`${envVar} key must decode to exactly 32 bytes (AES-256).`);
    }
    return { versionId, key };
  }
  // Legacy bare-base64 format — treat as version "v1".
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error(`${envVar} must decode to exactly 32 bytes (AES-256).`);
  }
  return { versionId: "v1", key };
}

function loadKeyset(): Keyset {
  const rawActive = process.env.TRUERATE_CRED_KEY;
  if (!rawActive) {
    throw new Error(
      "TRUERATE_CRED_KEY is not set. Generate one with: " +
        `node -e "console.log('mykey-v1:' + require('crypto').randomBytes(32).toString('base64'))"`,
    );
  }
  const active = parseKeyEntry(rawActive, "TRUERATE_CRED_KEY");
  const map = new Map<string, Buffer>([[active.versionId, active.key]]);

  const rawPrev = process.env.TRUERATE_CRED_KEY_PREV;
  if (rawPrev) {
    const prev = parseKeyEntry(rawPrev, "TRUERATE_CRED_KEY_PREV");
    map.set(prev.versionId, prev.key);
  }

  return { active, map };
}

function decryptPayload(base64Payload: string, key: Buffer): Record<string, string> {
  const raw = Buffer.from(base64Payload, "base64");
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const data = raw.subarray(28);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const out = Buffer.concat([decipher.update(data), decipher.final()]);
  return JSON.parse(out.toString("utf8"));
}

export function encryptCredential(plaintext: Record<string, string>): string {
  const { active } = loadKeyset();
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, active.key, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(plaintext), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const payload = Buffer.concat([iv, tag, data]).toString("base64");
  return `v2:${active.versionId}:${payload}`;
}

export function decryptCredential(blob: string): Record<string, string> {
  if (blob.startsWith("v2:")) {
    const rest = blob.slice(3); // strip "v2:"
    const colonIdx = rest.indexOf(":");
    if (colonIdx === -1) throw new Error("Malformed versioned credential blob.");
    const versionId = rest.slice(0, colonIdx);
    const payload = rest.slice(colonIdx + 1);
    const { map } = loadKeyset();
    const key = map.get(versionId);
    if (!key) throw new Error(`Credential encrypted with unknown key version "${versionId}".`);
    return decryptPayload(payload, key);
  }
  // Legacy blob: use the active key.
  const { active } = loadKeyset();
  return decryptPayload(blob, active.key);
}

/** Decrypt a credential blob and re-encrypt it under the current active key. */
export function reEncryptCredential(blob: string): string {
  return encryptCredential(decryptCredential(blob));
}
