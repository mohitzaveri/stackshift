import { describe, expect, it } from "vitest";
import { getConfig } from "../lib/config";
import { RateLimiter, clientKey } from "../lib/rate-limit";

describe("RateLimiter", () => {
  it("allows the limit, then blocks until the window resets", () => {
    let now = 0;
    const limiter = new RateLimiter(60_000, () => now);
    expect(limiter.check("a", 2)).toEqual({ ok: true });
    expect(limiter.check("a", 2)).toEqual({ ok: true });
    expect(limiter.check("a", 2)).toEqual({ ok: false, retryAfterSeconds: 60 });
    expect(limiter.check("b", 2)).toEqual({ ok: true });
    now = 60_000;
    expect(limiter.check("a", 2)).toEqual({ ok: true });
  });

  it("treats a limit of 0 as unlimited", () => {
    const limiter = new RateLimiter(60_000);
    for (let i = 0; i < 20; i++) expect(limiter.check("a", 0).ok).toBe(true);
  });

  it("identifies clients by forwarded address", () => {
    expect(clientKey(new Headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" }))).toBe("203.0.113.7");
    expect(clientKey(new Headers())).toBe("local");
  });
});

describe("getConfig", () => {
  it("uses safe defaults", () => {
    expect(getConfig({})).toEqual({
      demo: false,
      model: "claude-opus-5-5",
      effort: "high",
      githubToken: undefined,
      accessCode: undefined,
      rateLimitPerHour: 5,
    });
  });

  it("reads overrides and ignores invalid values", () => {
    const config = getConfig({ DEMO_MODE: "1", CLAUDE_EFFORT: "turbo", RATE_LIMIT_PER_HOUR: "0", GITHUB_TOKEN: "  " });
    expect(config).toMatchObject({ demo: true, effort: "high", rateLimitPerHour: 0, githubToken: undefined });
  });
});
