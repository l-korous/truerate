// Sliding-window in-memory rate limiter.
// Each key (userId or IP) gets a list of request timestamps; entries older
// than windowMs are pruned on every check so memory stays bounded.

export interface RateLimiterConfig {
  windowMs: number;
  max: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetMs: number; // epoch ms when the oldest in-window request expires
}

export class RateLimiter {
  private readonly windows = new Map<string, number[]>();

  constructor(private readonly config: RateLimiterConfig) {}

  check(key: string): RateLimitResult {
    const now = Date.now();
    const cutoff = now - this.config.windowMs;

    const raw = this.windows.get(key) ?? [];
    const active = raw.filter((t) => t > cutoff);

    if (active.length >= this.config.max) {
      this.windows.set(key, active);
      return {
        allowed: false,
        remaining: 0,
        resetMs: active[0]! + this.config.windowMs,
      };
    }

    active.push(now);
    this.windows.set(key, active);
    return {
      allowed: true,
      remaining: this.config.max - active.length,
      resetMs: active[0]! + this.config.windowMs,
    };
  }

  /**
   * Check whether a request WOULD be allowed, WITHOUT recording it.
   * Use when composing several limiters so a request denied by one window
   * doesn't consume a slot in another (consume only after all windows pass).
   */
  peek(key: string): RateLimitResult {
    const now = Date.now();
    const cutoff = now - this.config.windowMs;
    const active = (this.windows.get(key) ?? []).filter((t) => t > cutoff);
    return {
      allowed: active.length < this.config.max,
      remaining: Math.max(0, this.config.max - active.length),
      resetMs: active.length ? active[0]! + this.config.windowMs : now,
    };
  }

  /** Remove all state for a key (useful in tests). */
  reset(key: string): void {
    this.windows.delete(key);
  }

  /** Clear ALL keys (useful in tests). */
  clear(): void {
    this.windows.clear();
  }
}

/** Build a RateLimiter from environment variables.
 *
 * RATE_LIMIT_WINDOW_MS – sliding window size in ms (default 60 000)
 * RATE_LIMIT_MAX       – max requests per window (default = fallback arg)
 */
export function createRateLimiter(defaultMax: number): RateLimiter {
  const windowMs = Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60_000);
  const max = Number(process.env.RATE_LIMIT_MAX ?? defaultMax);
  return new RateLimiter({ windowMs, max });
}
