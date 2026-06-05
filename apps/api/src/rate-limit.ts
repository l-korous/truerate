import { createMiddleware } from "hono/factory";
import type { Context } from "hono";
import { verify } from "hono/jwt";
import { createRateLimiter, RateLimiter } from "@truerate/core";

// Default: 60 requests per minute per identity. Override with env vars:
//   RATE_LIMIT_WINDOW_MS  – window size in ms
//   RATE_LIMIT_MAX        – max requests per window
export const apiLimiter = createRateLimiter(60);

// Extract a best-effort identity key from the request.
// If a valid JWT bearer token is present we key on the userId (sub claim),
// otherwise we fall back to the client IP so unauthenticated callers are
// still rate-limited even before the auth middleware runs.
async function identityKey(authHeader: string | undefined, ip: string): Promise<string> {
  if (authHeader?.startsWith("Bearer ")) {
    try {
      const secret = process.env.TRUERATE_JWT_SECRET;
      if (secret) {
        const payload = (await verify(authHeader.slice(7), secret, "HS256")) as { sub?: string };
        if (payload.sub) return `uid:${payload.sub}`;
      }
    } catch {
      // invalid token — fall through to IP
    }
  }
  return `ip:${ip}`;
}

export const rateLimitMiddleware = createMiddleware(async (c, next) => {
  const authHeader = c.req.header("Authorization");
  const forwarded = c.req.header("x-forwarded-for");
  const ip = forwarded ? forwarded.split(",")[0]!.trim() : (c.req.header("x-real-ip") ?? "unknown");

  const key = await identityKey(authHeader, ip);
  const maxRequests = Number(process.env.RATE_LIMIT_MAX ?? 60);
  const result = apiLimiter.check(key);

  const resetSec = Math.ceil(result.resetMs / 1000);
  c.header("X-RateLimit-Limit", String(maxRequests));
  c.header("X-RateLimit-Remaining", String(result.remaining));
  c.header("X-RateLimit-Reset", String(resetSec));

  if (!result.allowed) {
    c.header("Retry-After", String(Math.ceil((result.resetMs - Date.now()) / 1000)));
    return c.json({ error: "rate_limit_exceeded", retryAfter: resetSec }, 429);
  }

  await next();
});

// ─── Signup abuse control ────────────────────────────────────────────────────
// Account creation is the one unauthenticated, side-effectful, write endpoint, so
// it needs a stricter, dedicated cap than the global limiter. Two sliding windows
// per source IP: at most 5 sign-ups / hour AND 10 / 24h (env-overridable). Both
// windows must pass; a request is only counted (consumed) when allowed, so a
// request blocked by one window doesn't burn a slot in the other.
//
// NOTE: in-memory + per-replica, like the global limiter. With scale-to-zero this
// is one replica in the common case; under multi-replica fan-out the effective
// cap is per-replica. A shared (Cosmos) counter is the future hardening if needed.
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

// Resolve a signup cap: an explicit env override always wins; otherwise the
// real prod default applies — EXCEPT under the in-memory backend, which is
// dev/test only (Bicep pins TRUERATE_INMEMORY=false in prod). Unit tests
// register many users from a single (header-less → "unknown") IP, so a live cap
// there would throttle unrelated tests; abuse control is a prod concern (real
// per-client IPs + a shared store), so it's effectively off in dev/test unless
// a test opts in via env or __setSignupLimitsForTest.
function signupCap(envValue: string | undefined, prodDefault: number): number {
  if (envValue !== undefined && envValue !== "") return Number(envValue);
  return process.env.TRUERATE_INMEMORY === "true" ? Number.MAX_SAFE_INTEGER : prodDefault;
}
let signupHourly = new RateLimiter({ windowMs: HOUR_MS, max: signupCap(process.env.SIGNUP_RATE_LIMIT_HOUR_MAX, 5) });
let signupDaily = new RateLimiter({ windowMs: DAY_MS, max: signupCap(process.env.SIGNUP_RATE_LIMIT_DAY_MAX, 10) });

/** Best-effort source IP from proxy headers (Container Apps ingress sets XFF). */
export function clientIp(c: Context): string {
  const forwarded = c.req.header("x-forwarded-for");
  return forwarded ? forwarded.split(",")[0]!.trim() : (c.req.header("x-real-ip") ?? "unknown");
}

/** Per-IP signup limiter: 5/hour + 10/24h. Apply to POST /auth/register. */
export const signupRateLimit = createMiddleware(async (c, next) => {
  const key = `signup:${clientIp(c)}`;
  const hour = signupHourly.peek(key);
  const day = signupDaily.peek(key);
  const blocked = !hour.allowed ? hour : !day.allowed ? day : null;
  if (blocked) {
    const retryAfter = Math.max(1, Math.ceil((blocked.resetMs - Date.now()) / 1000));
    c.header("Retry-After", String(retryAfter));
    return c.json(
      {
        error: "signup_rate_limited",
        message: "Too many sign-up attempts from this network. Please try again later.",
        retryAfter,
      },
      429,
    );
  }
  // Allowed by both windows — record the attempt in each.
  signupHourly.check(key);
  signupDaily.check(key);
  await next();
});

/** Test-only: reconfigure the signup limiters with custom maxes + fresh state. */
export function __setSignupLimitsForTest(hourMax: number, dayMax: number): void {
  signupHourly = new RateLimiter({ windowMs: HOUR_MS, max: hourMax });
  signupDaily = new RateLimiter({ windowMs: DAY_MS, max: dayMax });
}
