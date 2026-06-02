import { createMiddleware } from "hono/factory";
import { verify } from "hono/jwt";
import { createRateLimiter } from "@truerate/core";

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
