import type { Usage } from "./types";

interface Price {
  /** USD per million input tokens. */
  input: number;
  /** USD per million output tokens. */
  output: number;
  /** USD per million cache-read tokens, when it isn't the usual 10% of the input price. */
  cacheRead?: number;
}

/** Anthropic list prices, including the models server-side fallbacks can route to. */
const PRICES: Record<string, Price> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
  "claude-fable-5-1": { input: 10, output: 50, cacheRead: 0.25 },
  "claude-fable-5": { input: 10, output: 50 },
  "claude-opus-5": { input: 5, output: 25 },
  "claude-sonnet-5": { input: 2, output: 10 },
  "claude-opus-4-8": { input: 5, output: 25 },
  "claude-opus-4-7": { input: 5, output: 25 },
  "claude-opus-4-6": { input: 5, output: 25 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-haiku-4-5": { input: 1, output: 5 },
};

/** Cache writes cost more than plain input: 1.25x for the 5-minute cache, 2x for the 1-hour cache. */
const CACHE_WRITE_5M = 1.25;
const CACHE_WRITE_1H = 2;

/** Server-side web search costs $10 per 1,000 searches. */
export const WEB_SEARCH_USD = 0.01;

/** Tokens from one model attempt, split the way they're priced. */
export interface BilledTokens {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWrite5mTokens: number;
  cacheWrite1hTokens: number;
}

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

/** List-price cost of one model's tokens, or null for a model whose price isn't known. */
export function priceTokensUsd(model: string, tokens: BilledTokens): number | null {
  const price = Object.hasOwn(PRICES, model) ? PRICES[model] : undefined;
  if (!price) return null;
  const usd = (count: number, perMillion: number) => (count * perMillion) / 1_000_000;
  return (
    usd(tokens.inputTokens, price.input) +
    usd(tokens.outputTokens, price.output) +
    usd(tokens.cacheReadTokens, price.cacheRead ?? price.input * 0.1) +
    usd(tokens.cacheWrite5mTokens, price.input * CACHE_WRITE_5M) +
    usd(tokens.cacheWrite1hTokens, price.input * CACHE_WRITE_1H)
  );
}

/** Adds two costs. The total is unknown (null) if either part is. */
export function addCosts(a: number | null, b: number | null): number | null {
  return a === null || b === null ? null : a + b;
}
