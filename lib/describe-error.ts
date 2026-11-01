import { AgentError, RepoError, StepError } from "./errors";
import { describeClaudeError } from "./llm";

/** Turns any pipeline error into a message that is safe and useful to show in the browser. */
export function describeError(err: unknown): string {
  if (err instanceof StepError) return describeError(err.cause);
  if (err instanceof RepoError || err instanceof AgentError) return err.message;
  const claudeMessage = describeClaudeError(err);
  if (claudeMessage) return claudeMessage;
  console.error("Unexpected analysis error:", err);
  return "Something went wrong. Try again, and check the server logs if it keeps happening.";
}
