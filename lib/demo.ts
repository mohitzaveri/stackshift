import { emptyUsage } from "./cost";
import { formatNumber } from "./format";
import type { AgentHooks, AgentRequest, DemoHints, LlmClient } from "./llm";
import type { EstimateDraft } from "./estimate";

const BANNER =
  "> **Demo mode.** This report is a placeholder written without AI, so you can try StackShift without an API key. " +
  "The repository facts in it are real. Add `ANTHROPIC_API_KEY` and turn off `DEMO_MODE` for a real analysis.";

function technologies(hints: DemoHints): string {
  const list = hints.facts.technologies.map((t) => `- ${t.name}${t.version ? ` ${t.version}` : ""} (in \`${t.source}\`)`);
  return list.length ? list.join("\n") : "- No recognized frameworks in the manifests.";
}

function stackReport({ facts, targetStack }: DemoHints): string {
  const languages = facts.languages.map((lang) => `${lang.name} (${lang.percent}%)`).join(", ") || "unknown";
  return `${BANNER}

## Overview

**${facts.owner}/${facts.name}**: ${facts.description ?? "no description on GitHub."}

## What the files show

- **Languages:** ${languages}
- **Size:** ${formatNumber(facts.totalFiles)} files, ${formatNumber(facts.sourceFiles)} of them source code, about ${formatNumber(facts.estimatedLines)} lines
- **Tests:** ${facts.testFiles ? `${facts.testFiles} test files` : "no test files found"}
- **Manifests:** ${facts.manifests.map((m) => `\`${m}\``).join(", ") || "none found"}

## Technologies detected

${technologies({ facts, targetStack })}

## What a real analysis adds

With Claude enabled, this step reads the ${facts.filesRead} files StackShift downloaded and explains how the code is organized, which parts port easily to ${targetStack}, and what could block the move.`;
}

function researchReport({ targetStack }: DemoHints): string {
  return `${BANNER}

## Recommended path

With Claude enabled, this step searches the web for official guides, codemods and real migration stories for moving to **${targetStack}**, and lists its sources at the end.

## What you'd see here

- The recommended order of work, and whether to migrate incrementally or rewrite
- Official tools and guides that help
- Common problems and how other teams solved them
- Version-specific issues for this project's dependencies`;
}

function planReport({ facts, targetStack }: DemoHints): string {
  return `${BANNER}

## Executive summary

Move **${facts.owner}/${facts.name}** to ${targetStack} in small, testable phases, keeping the app working at the end of each one.

## Phases

1. **Prepare**: set up the new project skeleton, CI and a test baseline.
2. **Port the foundations**: shared code, configuration and data access.
3. **Port features**: one area at a time, with tests for each.
4. **Switch over**: deploy, monitor, and remove the old code.

## First week

- [ ] Agree on the target versions and tooling
- [ ] Get the existing test suite running in CI
- [ ] Create the new project skeleton next to the old one`;
}

/** Placeholder hours that scale with the measured size of the repository. */
export function demoEstimate({ facts, targetStack }: DemoHints): EstimateDraft {
  const size = Math.max(1, facts.estimatedLines / 1000);
  const range = (perThousandLines: number, minimum: number) => {
    const low = Math.max(minimum, Math.round(size * perThousandLines));
    return { hoursLow: low, hoursHigh: Math.round(low * 1.6) };
  };
  return {
    complexity: facts.estimatedLines > 20_000 ? "high" : facts.estimatedLines > 5_000 ? "medium" : "low",
    complexityReason: `Demo estimate based only on size: about ${formatNumber(facts.estimatedLines)} lines of code.`,
    confidence: "low",
    workItems: [
      { name: "Project setup", description: `Create the ${targetStack} skeleton, tooling and CI.`, ...range(2, 6) },
      { name: "Port the codebase", description: "Move the source code over, one area at a time.", ...range(12, 10) },
      { name: "Tests", description: "Bring the existing tests across and add missing ones.", ...range(4, 6) },
      { name: "Deployment", description: "Update build and deployment, then switch traffic.", ...range(1, 4) },
    ],
    risks: [
      {
        title: "Demo numbers",
        likelihood: "high",
        impact: "medium",
        mitigation: "Run a real analysis with Claude for estimates based on the code itself.",
      },
    ],
    assumptions: ["These are demo placeholders that scale with the repository's size."],
  };
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException("Aborted", "AbortError"));
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

async function streamOut(text: string, hooks: AgentHooks, delayMs: number): Promise<void> {
  for (let i = 0; i < text.length; i += 24) {
    hooks.onText?.(text.slice(i, i + 24));
    if (delayMs) await sleep(delayMs, hooks.signal);
  }
}

/** Stands in for Claude: writes labeled placeholder reports from the real repository facts. */
export function createDemoClient(options: { delayMs?: number } = {}): LlmClient {
  const delayMs = options.delayMs ?? 12;
  return {
    model: "demo",
    demo: true,
    async run(request: AgentRequest, hooks: AgentHooks = {}) {
      if (request.jsonSchema) {
        await sleep(delayMs * 40, hooks.signal);
        return { text: JSON.stringify(demoEstimate(request.demo)), sources: [], usage: emptyUsage(), model: "demo" };
      }
      if (request.step === "research") hooks.onActivity?.(`Demo mode: skipping the web search for “${request.demo.targetStack}”`);
      const text =
        request.step === "stack"
          ? stackReport(request.demo)
          : request.step === "research"
            ? researchReport(request.demo)
            : planReport(request.demo);
      await streamOut(text, hooks, delayMs);
      return { text, sources: [], usage: emptyUsage(), model: "demo" };
    },
  };
}
