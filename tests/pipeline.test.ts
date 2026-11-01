import { describe, expect, it } from "vitest";
import { createDemoClient } from "../lib/demo";
import { StepError } from "../lib/errors";
import type { AgentRequest, LlmClient } from "../lib/llm";
import { runAnalysis, type PipelineDeps } from "../lib/pipeline";
import type { PipelineEvent, StepId } from "../lib/types";
import { estimateDraft, fakeFetch, flaskApi, reactApp, repoRoutes } from "./fixtures";

const STACK_REPORT = `## Current stack\n${"Details about the code. ".repeat(400)}\nEND-OF-STACK-REPORT`;
const RESEARCH_REPORT = `## Migration research\n${"Findings from the guides. ".repeat(300)}\nEND-OF-RESEARCH`;

/**
 * A fake Claude that records every request and answers each step with canned text. Each step
 * costs $0.02 (research $0.05); `fallback` makes one step answered by another model, and
 * `unpriced` makes one step's cost unknown.
 */
function recordingClient(
  overrides: Partial<Record<StepId, string>> = {},
  options: { fallback?: StepId; unpriced?: StepId } = {},
) {
  const requests: AgentRequest[] = [];
  const answers: Partial<Record<StepId, string>> = {
    stack: STACK_REPORT,
    research: RESEARCH_REPORT,
    estimate: JSON.stringify(estimateDraft),
    plan: "## Plan\nPhase 1",
    ...overrides,
  };
  const client: LlmClient = {
    model: "claude-opus-5-5",
    demo: false,
    async run(request, hooks) {
      requests.push(request);
      const text = answers[request.step] ?? "";
      hooks?.onText?.(text);
      return {
        text,
        sources: request.step === "research" ? [{ url: "https://nextjs.org/docs/app/guides", title: "Next.js guide" }] : [],
        usage: { inputTokens: 1000, outputTokens: 500, cacheWriteTokens: 0, cacheReadTokens: 0, webSearches: request.step === "research" ? 3 : 0 },
        costUsd: request.step === options.unpriced ? null : request.step === "research" ? 0.05 : 0.02,
        model: request.step === options.fallback ? "claude-opus-4-8" : "claude-opus-5-5",
      };
    },
  };
  const find = (step: StepId) => requests.find((r) => r.step === step);
  return { client, requests, find };
}

function deps(llm: LlmClient, fixture = reactApp, extra: Partial<PipelineDeps> = {}) {
  const events: PipelineEvent[] = [];
  return {
    events,
    deps: {
      llm,
      emit: (event: PipelineEvent) => events.push(event),
      github: { fetchImpl: fakeFetch(repoRoutes(fixture)).fetch },
      newId: () => "test-id",
      ...extra,
    } satisfies PipelineDeps,
  };
}

const input = { repo: { owner: "acme", repo: "food-app" }, targetStack: "Next.js 16 with TypeScript", hourlyRate: 100 };

describe("runAnalysis", () => {
  it("gives the researcher the full stack report, not a hard-coded stack", async () => {
    const fake = recordingClient();
    const flask = deps(fake.client, flaskApi);
    await runAnalysis({ ...input, repo: { owner: "acme", repo: "flask-api" }, targetStack: "FastAPI" }, flask.deps);

    const research = fake.find("research")!;
    expect(research.prompt).toContain(STACK_REPORT);
    expect(research.prompt).toContain("Flask 2.3.3 (in requirements.txt)");
    expect(research.prompt).not.toMatch(/React|Create React App/);
  });

  it("gives the estimate and plan steps every earlier report in full", async () => {
    const fake = recordingClient();
    await runAnalysis(input, deps(fake.client).deps);

    const estimate = fake.find("estimate")!;
    expect(estimate.prompt).toContain(STACK_REPORT);
    expect(estimate.prompt).toContain(RESEARCH_REPORT);
    expect(estimate.prompt).toContain("## Sources");
    expect(estimate.jsonSchema).toBeDefined();

    const plan = fake.find("plan")!;
    expect(plan.prompt).toContain(STACK_REPORT);
    expect(plan.prompt).toContain(RESEARCH_REPORT);
    expect(plan.prompt).toContain("18–36 hours");
  });

  it("sends the same snapshot to the stack, estimate and plan steps so it can be cached", async () => {
    const fake = recordingClient();
    await runAnalysis(input, deps(fake.client).deps);

    const context = fake.find("stack")!.context;
    expect(context).toContain('<file path="package.json"');
    expect(fake.find("estimate")!.context).toBe(context);
    expect(fake.find("plan")!.context).toBe(context);
    expect(fake.find("research")!.context).toBeUndefined();
    expect(fake.find("research")!.webSearch).toEqual({ maxUses: 6 });
  });

  it("reports progress in order and ends with the full result", async () => {
    const fake = recordingClient();
    const run = deps(fake.client);
    const result = await runAnalysis(input, run.deps);

    const steps = run.events.filter((e) => e.type === "step").map((e) => `${e.step}:${e.status}`);
    expect(steps).toEqual([
      "repo:running", "repo:done", "stack:running", "stack:done", "research:running", "research:done",
      "estimate:running", "estimate:done", "plan:running", "plan:done",
    ]);
    expect(run.events.at(-1)).toEqual({ type: "result", result });
    expect(run.events.some((e) => e.type === "delta" && e.step === "estimate" && e.text.includes("## Summary"))).toBe(true);
    // The summary counts the files that matter (node_modules is left out).
    expect(run.events).toContainEqual({ type: "step", step: "repo", status: "done", summary: "8 files found, 5 read" });

    expect(result.reports.research).toContain("[Next.js guide](https://nextjs.org/docs/app/guides)");
    expect(result.estimate.totalHoursLow).toBe(18);
    expect(result.usage).toEqual({ inputTokens: 4000, outputTokens: 2000, cacheWriteTokens: 0, cacheReadTokens: 0, webSearches: 3 });
    expect(result.costUsd).toBeCloseTo(0.02 + 0.05 + 0.02 + 0.02, 9);
    expect(result.servedBy).toEqual(["claude-opus-5-5"]);
    expect(result.repo.technologies.map((t) => t.name)).toContain("Create React App (react-scripts)");
  });

  it("records fallback models, and leaves the cost unknown if any step's price is", async () => {
    const fake = recordingClient({}, { fallback: "research", unpriced: "plan" });
    const result = await runAnalysis(input, deps(fake.client).deps);
    expect(result.model).toBe("claude-opus-5-5");
    expect(result.servedBy).toEqual(["claude-opus-5-5", "claude-opus-4-8"]);
    expect(result.costUsd).toBeNull();
  });

  it("names the step that failed", async () => {
    const fake = recordingClient({ estimate: "not json" });
    const error = await runAnalysis(input, deps(fake.client).deps).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(StepError);
    expect((error as StepError).step).toBe("estimate");
    expect(fake.find("plan")).toBeUndefined();
  });

  it("stops when the browser goes away", async () => {
    const controller = new AbortController();
    const fake = recordingClient();
    const original = fake.client.run.bind(fake.client);
    fake.client.run = async (request, hooks) => {
      const output = await original(request, hooks);
      if (request.step === "stack") controller.abort();
      return output;
    };
    await expect(runAnalysis(input, deps(fake.client, reactApp, { signal: controller.signal }).deps)).rejects.toThrow();
    expect(fake.requests.map((r) => r.step)).toEqual(["stack"]);
  });

  it("works end to end in demo mode, with real repository facts", async () => {
    const run = deps(createDemoClient({ delayMs: 0 }));
    const result = await runAnalysis(input, run.deps);
    expect(result.demo).toBe(true);
    expect(result.costUsd).toBe(0);
    expect(result.reports.stack).toContain("Demo mode");
    expect(result.reports.stack).toContain("React ^19.2.1");
    expect(result.estimate.workItems.length).toBeGreaterThan(0);
  });
});
