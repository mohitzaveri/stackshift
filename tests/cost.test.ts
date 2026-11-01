import { describe, expect, it } from "vitest";
import { addUsage, emptyUsage, estimateCostUsd, totalTokens } from "../lib/cost";

const million = {
  inputTokens: 1_000_000,
  outputTokens: 1_000_000,
  cacheWriteTokens: 1_000_000,
  cacheReadTokens: 1_000_000,
  webSearches: 10,
};

describe("estimateCostUsd", () => {
  it("prices input, output, cache writes, cache reads and web searches", () => {
    // $4 input + $20 output + $5 cache write (1.25x) + $0.20 cache read + 10 searches at $0.01
    expect(estimateCostUsd("claude-opus-5-5", million)).toBeCloseTo(29.3, 6);
    // Cache reads default to 10% of the input price.
    expect(estimateCostUsd("claude-opus-5", { ...emptyUsage(), cacheReadTokens: 1_000_000 })).toBeCloseTo(0.5, 6);
  });

  it("returns null for a model without a known price", () => {
    expect(estimateCostUsd("some-future-model", million)).toBeNull();
    expect(estimateCostUsd("constructor", million)).toBeNull();
  });
});

describe("usage helpers", () => {
  it("adds usage and counts tokens", () => {
    const total = addUsage(million, million);
    expect(total.webSearches).toBe(20);
    expect(totalTokens(total)).toBe(8_000_000);
  });
});
