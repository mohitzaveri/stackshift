import { addCosts, addUsage, emptyUsage } from "./cost";
import { computeFacts } from "./detect";
import { StepError } from "./errors";
import { computeEstimate, parseEstimate, renderEstimateMarkdown } from "./estimate";
import { formatNumber } from "./format";
import { buildSnapshotText, fetchRepoSnapshot, type GithubOptions } from "./github";
import type { AgentRequest, DemoHints, Effort, LlmClient } from "./llm";
import { estimateRequest, planRequest, researchRequest, stackRequest } from "./prompts";
import type { AnalysisResult, PipelineEvent, RepoRef, Source, StepId } from "./types";

export interface AnalysisInput {
  repo: RepoRef;
  targetStack: string;
  hourlyRate: number;
}

export interface PipelineDeps {
  llm: LlmClient;
  emit: (event: PipelineEvent) => void;
  github?: Omit<GithubOptions, "signal">;
  signal?: AbortSignal;
  /** Effort for the analysis, estimate and plan steps. Research runs at medium. */
  effort?: Effort;
  now?: () => number;
  newId?: () => string;
}

function withSources(report: string, sources: Source[]): string {
  if (!sources.length) return report;
  const list = sources.map((source) => `- [${source.title.replace(/[[\]]/g, "")}](${source.url})`).join("\n");
  return `${report}\n\n## Sources\n\n${list}`;
}

/**
 * Runs the five steps in order: read the repository, analyze the stack, research the
 * migration, estimate the effort, and write the plan. Each AI step gets the earlier
 * reports in full, and progress is reported through `emit` as it happens.
 */
export async function runAnalysis(input: AnalysisInput, deps: PipelineDeps): Promise<AnalysisResult> {
  const { llm, emit, signal } = deps;
  const now = deps.now ?? Date.now;
  const effort = deps.effort ?? "high";
  const startedAt = now();
  let usage = emptyUsage();
  let costUsd: number | null = 0;
  const servedBy = new Set<string>();

  async function step<T>(id: StepId, work: () => Promise<T>, summary?: (result: T) => string): Promise<T> {
    signal?.throwIfAborted();
    emit({ type: "step", step: id, status: "running" });
    try {
      const result = await work();
      emit({ type: "step", step: id, status: "done", summary: summary?.(result) || undefined });
      return result;
    } catch (err) {
      throw new StepError(id, err);
    }
  }

  async function ask(request: AgentRequest, streamText: boolean) {
    const output = await llm.run(request, {
      signal,
      onText: streamText ? (text) => emit({ type: "delta", step: request.step, text }) : undefined,
      onActivity: (message) => emit({ type: "activity", step: request.step, message }),
    });
    usage = addUsage(usage, output.usage);
    costUsd = addCosts(costUsd, output.costUsd);
    servedBy.add(output.model);
    return output;
  }

  const { snapshot, facts } = await step(
    "repo",
    async () => {
      const snapshot = await fetchRepoSnapshot(input.repo, { ...deps.github, signal });
      return { snapshot, facts: computeFacts(snapshot) };
    },
    ({ facts }) => `${formatNumber(facts.totalFiles)} files found, ${facts.filesRead} read`,
  );
  const context = buildSnapshotText(snapshot, facts);
  const hints: DemoHints = { targetStack: input.targetStack, facts };

  const stack = await step("stack", () => ask(stackRequest(context, hints, effort), true));

  const research = await step(
    "research",
    async () => {
      const output = await ask(researchRequest(stack.text, hints, "medium"), true);
      return { ...output, text: withSources(output.text, output.sources) };
    },
    (r) => (r.sources.length ? `${r.sources.length} sources` : ""),
  );

  const estimate = await step(
    "estimate",
    async () => {
      const output = await ask(estimateRequest(context, stack.text, research.text, hints, effort), false);
      const computed = computeEstimate(parseEstimate(output.text), input.hourlyRate);
      const markdown = renderEstimateMarkdown(computed);
      emit({ type: "delta", step: "estimate", text: markdown });
      return { computed, markdown };
    },
    (e) => `${formatNumber(e.computed.totalHoursLow)}–${formatNumber(e.computed.totalHoursHigh)} hours`,
  );

  const plan = await step("plan", () =>
    ask(planRequest(context, stack.text, research.text, estimate.markdown, hints, effort), true),
  );

  const result: AnalysisResult = {
    id: deps.newId?.() ?? crypto.randomUUID(),
    createdAt: new Date(startedAt).toISOString(),
    repo: facts,
    targetStack: input.targetStack,
    demo: llm.demo,
    model: llm.model,
    servedBy: [...servedBy],
    reports: { stack: stack.text, research: research.text, estimate: estimate.markdown, plan: plan.text },
    estimate: estimate.computed,
    sources: research.sources,
    usage,
    costUsd,
    durationMs: now() - startedAt,
  };
  emit({ type: "result", result });
  return result;
}
