import { DEFAULT_MODEL, type Effort } from "./llm";

const EFFORTS: Effort[] = ["low", "medium", "high", "xhigh", "max"];

export interface ServerConfig {
  demo: boolean;
  model: string;
  effort: Effort;
  githubToken?: string;
  /** Lets visitors analyze private repositories the GitHub token can read. Off by default. */
  allowPrivateRepos: boolean;
  accessCode?: string;
  /** Analyses allowed per visitor per hour. 0 turns the limit off. */
  rateLimitPerHour: number;
  /** Analyses allowed per day across all visitors: a hard cap on spending. 0 turns it off. */
  dailyAnalysisLimit: number;
}

function enabled(value: string | undefined): boolean {
  return ["1", "true", "yes", "on"].includes(value?.trim().toLowerCase() ?? "");
}

function optional(value: string | undefined): string | undefined {
  return value?.trim() || undefined;
}

function count(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

/** Reads settings from environment variables (see .env.example). */
export function getConfig(env: Record<string, string | undefined> = process.env): ServerConfig {
  const effort = env.CLAUDE_EFFORT?.trim().toLowerCase() as Effort | undefined;
  return {
    demo: enabled(env.DEMO_MODE),
    model: optional(env.CLAUDE_MODEL) ?? DEFAULT_MODEL,
    effort: effort && EFFORTS.includes(effort) ? effort : "high",
    githubToken: optional(env.GITHUB_TOKEN),
    allowPrivateRepos: enabled(env.ALLOW_PRIVATE_REPOS),
    accessCode: optional(env.ACCESS_CODE),
    rateLimitPerHour: count(env.RATE_LIMIT_PER_HOUR, 5),
    dailyAnalysisLimit: count(env.DAILY_ANALYSIS_LIMIT, 50),
  };
}
