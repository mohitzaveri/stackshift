import type { StepId } from "./types";

/** A problem reading the repository. The message is safe to show to users. */
export class RepoError extends Error {
  name = "RepoError";
}

/** A problem with an AI step's output. The message is safe to show to users. */
export class AgentError extends Error {
  name = "AgentError";
}

/** Wraps any error thrown inside a pipeline step, so callers know which step failed. */
export class StepError extends Error {
  name = "StepError";

  constructor(
    readonly step: StepId,
    cause: unknown,
  ) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
  }
}

export function isAbortError(err: unknown): boolean {
  return err instanceof Error && (err.name === "AbortError" || err.name === "APIUserAbortError");
}
