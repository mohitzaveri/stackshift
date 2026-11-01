import { describe, expect, it } from "vitest";
import { addCosts, addUsage, emptyUsage, priceTokensUsd, totalTokens } from "../lib/cost";

const none = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWrite5mTokens: 0, cacheWrite1hTokens: 0 };
const million = {
  inputTokens: 1_000_000,
  outputTokens: 1_000_000,
  cacheReadTokens: 1_000_000,
  cacheWrite5mTokens: 1_000_000,
  cacheWrite1hTokens: 1_000_000,
};

describe("priceTokensUsd", () => {
  it("prices input, output, cache reads and both kinds of cache writes", () => {
    // $4 input + $20 output + $0.20 cache reads + $5 five-minute writes (1.25x) + $8 one-hour writes (2x)
    expect(priceTokensUsd("claude-opus-5-5", million)).toBeCloseTo(37.2, 6);
    // Cache reads default to 10% of the input price.
    expect(priceTokensUsd("claude-opus-4-8", { ...none, cacheReadTokens: 1_000_000 })).toBeCloseTo(0.5, 6);
  });

  it("returns null for a model without a known price", () => {
    expect(priceTokensUsd("some-future-model", million)).toBeNull();
    expect(priceTokensUsd("constructor", million)).toBeNull();
  });
});

describe("cost and usage helpers", () => {
  it("treats a total as unknown when any part is unknown", () => {
    expect(addCosts(1, 2)).toBe(3);
    expect(addCosts(1, null)).toBeNull();
    expect(addCosts(null, 0)).toBeNull();
  });

  it("adds usage and counts tokens", () => {
    const usage = { inputTokens: 1, outputTokens: 2, cacheWriteTokens: 3, cacheReadTokens: 4, webSearches: 5 };
    const total = addUsage(usage, addUsage(usage, emptyUsage()));
    expect(total.webSearches).toBe(10);
    expect(totalTokens(total)).toBe(20);
  });
});
