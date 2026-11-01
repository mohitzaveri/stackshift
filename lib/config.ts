import { DEFAULT_MODEL, type Effort } from "./llm";

const EFFORTS: Effort[] = ["low", "medium", "high", "xhigh", "max"];

export interface ServerConfig {
  demo: boolean;
  model: string;
  effort: Effort;
  githubToken?: string;
  accessCode?: string;
  /** Analyses allowed per visitor per hour. 0 turns the limit off. */
  rateLimitPerHour: number;
}

function enabled(value: string | undefined): boolean {
  return ["1", "true", "yes", "on"].includes(value?.trim().toLowerCase() ?? "");
}

function optional(value: string | undefined): string | undefined {
  return value?.trim() || undefined;
}

/** Reads settings from environment variables (see .env.example). */
export function getConfig(env: Record<string, string | undefined> = process.env): ServerConfig {
  const effort = env.CLAUDE_EFFORT?.trim().toLowerCase() as Effort | undefined;
  const limit = Number.parseInt(env.RATE_LIMIT_PER_HOUR ?? "", 10);
  return {
    demo: enabled(env.DEMO_MODE),
    model: optional(env.CLAUDE_MODEL) ?? DEFAULT_MODEL,
    effort: effort && EFFORTS.includes(effort) ? effort : "high",
    githubToken: optional(env.GITHUB_TOKEN),
    accessCode: optional(env.ACCESS_CODE),
    rateLimitPerHour: Number.isFinite(limit) && limit >= 0 ? limit : 5,
  };
}
