// Lightweight admin session for the web admin console (interim gate ahead of
// SSO/RBAC #59). The web /api/admin/* proxies inject ADMIN_SECRET server-side,
// so without a caller check the admin data is world-readable. This gates them:
// the operator signs in once with the admin secret → an httpOnly, signed,
// expiring cookie → middleware only forwards admin routes when the cookie is
// valid. Stateless (HMAC over the secret), so no session store is needed.
//
// Edge-runtime safe: uses Web Crypto (crypto.subtle) + manual hex/compare so it
// works in both Next.js middleware (edge) and route handlers (node).

export const ADMIN_COOKIE = "truerate_admin";
const TTL_MS = 12 * 60 * 60 * 1000; // 12h
export const ADMIN_COOKIE_MAX_AGE = TTL_MS / 1000;

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function hmacHex(secret: string, msg: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(msg));
  return toHex(sig);
}

/** Constant-time string compare (avoids leaking match position via timing). */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Mint a signed, expiring admin token: "<expEpochMs>.<hmacHex>". */
export async function makeAdminToken(secret: string, now: number = Date.now()): Promise<string> {
  const exp = String(now + TTL_MS);
  const sig = await hmacHex(secret, exp);
  return `${exp}.${sig}`;
}

/** Verify an admin token against the secret: present, unexpired, signature valid. */
export async function verifyAdminToken(token: string | undefined, secret: string, now: number = Date.now()): Promise<boolean> {
  if (!token) return false;
  const dot = token.indexOf(".");
  if (dot <= 0) return false;
  const exp = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expMs = Number(exp);
  if (!Number.isFinite(expMs) || expMs < now) return false;
  const expected = await hmacHex(secret, exp);
  return timingSafeEqual(sig, expected);
}
