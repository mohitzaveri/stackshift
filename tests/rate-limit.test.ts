import { describe, expect, it } from "vitest";
import { accessCodeMatches } from "../lib/access-code";
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

  it("can look without recording an attempt", () => {
    const limiter = new RateLimiter(60_000);
    for (let i = 0; i < 5; i++) expect(limiter.peek("a", 1).ok).toBe(true);
    limiter.check("a", 1);
    expect(limiter.peek("a", 1).ok).toBe(false);
  });

  it("treats a limit of 0 as unlimited", () => {
    const limiter = new RateLimiter(60_000);
    for (let i = 0; i < 20; i++) expect(limiter.check("a", 0).ok).toBe(true);
  });
});

describe("clientKey", () => {
  it("uses the address the proxy added, not one the visitor wrote", () => {
    expect(clientKey(new Headers({ "x-forwarded-for": "1.2.3.4, 203.0.113.7" }))).toBe("203.0.113.7");
    expect(clientKey(new Headers({ "x-forwarded-for": "203.0.113.7" }))).toBe("203.0.113.7");
    expect(clientKey(new Headers({ "x-real-ip": "198.51.100.1" }))).toBe("198.51.100.1");
    expect(clientKey(new Headers())).toBe("local");
  });
});

describe("accessCodeMatches", () => {
  it("compares codes, including missing and differently sized ones", () => {
    expect(accessCodeMatches("open-sesame", "open-sesame")).toBe(true);
    expect(accessCodeMatches("open", "open-sesame")).toBe(false);
    expect(accessCodeMatches(undefined, "open-sesame")).toBe(false);
  });
});

describe("getConfig", () => {
  it("uses safe defaults", () => {
    expect(getConfig({})).toEqual({
      demo: false,
      model: "claude-opus-5-5",
      effort: "high",
      githubToken: undefined,
      allowPrivateRepos: false,
      accessCode: undefined,
      rateLimitPerHour: 5,
      dailyAnalysisLimit: 50,
    });
  });

  it("reads overrides and ignores invalid values", () => {
    const config = getConfig({
      DEMO_MODE: "1",
      CLAUDE_EFFORT: "turbo",
      RATE_LIMIT_PER_HOUR: "0",
      DAILY_ANALYSIS_LIMIT: "-3",
      GITHUB_TOKEN: "  ",
      ALLOW_PRIVATE_REPOS: "true",
    });
    expect(config).toMatchObject({
      demo: true,
      effort: "high",
      rateLimitPerHour: 0,
      dailyAnalysisLimit: 50,
      githubToken: undefined,
      allowPrivateRepos: true,
    });
  });
});
