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
  check(key: string, limit: number): { ok: true } | { ok: false; retryAfterSeconds: number } {
    if (limit <= 0) return { ok: true };
    const now = this.now();
    if (this.hits.size > 10_000) this.prune(now);

    const entry = this.hits.get(key);
    if (!entry || entry.resetAt <= now) {
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
      return { ok: true };
    }
    if (entry.count >= limit) {
      return { ok: false, retryAfterSeconds: Math.ceil((entry.resetAt - now) / 1000) };
    }
    entry.count += 1;
    return { ok: true };
  }

  private prune(now: number) {
    for (const [key, entry] of this.hits) {
      if (entry.resetAt <= now) this.hits.delete(key);
    }
  }
}

/** Best-effort client identifier. Behind a proxy you trust, x-forwarded-for holds the real address. */
export function clientKey(headers: Headers): string {
  return headers.get("x-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip")?.trim() || "local";
}
