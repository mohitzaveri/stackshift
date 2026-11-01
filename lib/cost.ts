import type { Usage } from "./types";

interface Price {
  /** USD per million input tokens. */
  input: number;
  /** USD per million output tokens. */
  output: number;
  /** USD per million cache-read tokens, when it isn't the usual 10% of the input price. */
  cacheRead?: number;
}

/** Anthropic list prices. Cache writes (5-minute TTL) cost 1.25x the input price. */
const PRICES: Record<string, Price> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
  "claude-fable-5-1": { input: 10, output: 50, cacheRead: 0.25 },
  "claude-opus-5": { input: 5, output: 25 },
  "claude-sonnet-5": { input: 2, output: 10 },
};

/** Server-side web search costs $10 per 1,000 searches. */
export const WEB_SEARCH_USD = 0.01;

export function emptyUsage(): Usage {
  return { inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0, webSearches: 0 };
}

export function addUsage(a: Usage, b: Usage): Usage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    webSearches: a.webSearches + b.webSearches,
  };
}

export function totalTokens(usage: Usage): number {
  return usage.inputTokens + usage.cacheWriteTokens + usage.cacheReadTokens + usage.outputTokens;
}

/** List-price cost of the usage, or null for a model whose price isn't known. */
export function estimateCostUsd(model: string, usage: Usage): number | null {
  const price = Object.hasOwn(PRICES, model) ? PRICES[model] : undefined;
  if (!price) return null;
  const perToken = (usdPerMillion: number) => usdPerMillion / 1_000_000;
  return (
    usage.inputTokens * perToken(price.input) +
    usage.cacheWriteTokens * perToken(price.input * 1.25) +
    usage.cacheReadTokens * perToken(price.cacheRead ?? price.input * 0.1) +
    usage.outputTokens * perToken(price.output) +
    usage.webSearches * WEB_SEARCH_USD
  );
}
