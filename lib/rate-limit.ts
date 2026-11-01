export type LimitResult = { ok: true } | { ok: false; retryAfterSeconds: number };

/**
 * Fixed-window rate limiter kept in memory. Good enough for one server process; use a shared
 * store such as Redis if you run several instances.
 */
export class RateLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Records one attempt for `key`. A limit of 0 means unlimited. */
  check(key: string, limit: number): LimitResult {
    const result = this.peek(key, limit);
    if (!result.ok || limit <= 0) return result;
    const now = this.now();
    const entry = this.hits.get(key);
    if (!entry || entry.resetAt <= now) {
      if (this.hits.size > 10_000) this.prune(now);
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
    } else {
      entry.count += 1;
    }
    return result;
  }

  /** Whether `key` still has attempts left, without recording one. */
  peek(key: string, limit: number): LimitResult {
    if (limit <= 0) return { ok: true };
    const now = this.now();
    const entry = this.hits.get(key);
    if (entry && entry.resetAt > now && entry.count >= limit) {
      return { ok: false, retryAfterSeconds: Math.ceil((entry.resetAt - now) / 1000) };
    }
    return { ok: true };
  }

  private prune(now: number) {
    for (const [key, entry] of this.hits) {
      if (entry.resetAt <= now) this.hits.delete(key);
    }
  }
}

/**
 * Best-effort visitor identifier: the last X-Forwarded-For entry, which is the one added by the
 * proxy in front of the app. Earlier entries come from the visitor and can be faked.
 */
export function clientKey(headers: Headers): string {
  const forwarded = headers
    .get("x-forwarded-for")
    ?.split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  return forwarded?.at(-1) || headers.get("x-real-ip")?.trim() || "local";
}
