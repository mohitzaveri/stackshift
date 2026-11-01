import { estimateJsonSchema } from "./estimate";
import type { AgentRequest, DemoHints, Effort } from "./llm";
import type { RepoFacts } from "./types";

/** Each step gets the earlier reports in full. Nothing is cut short. */
function tagged(tag: string, text: string): string {
  return `<${tag}>\n${text}\n</${tag}>`;
}

function technologyList(facts: RepoFacts): string {
  if (!facts.technologies.length) return "None recognized in the manifests.";
  return facts.technologies
    .map((tech) => `- ${tech.name}${tech.version ? ` ${tech.version}` : ""} (in ${tech.source})`)
    .join("\n");
}

export function stackRequest(snapshot: string, demo: DemoHints, effort: Effort): AgentRequest {
  return {
    step: "stack",
    context: snapshot,
    effort,
    demo,
    prompt: `The team wants to move this project to: ${demo.targetStack}

Using the repository snapshot above, write the "Current stack" report. The research, estimate and plan steps all build on it, so accuracy matters more than length.

Cover:
- What the project is and does, in two or three sentences.
- Languages, frameworks and key libraries, with versions exactly as they appear in the manifests.
- Build tooling, package manager, tests, CI and deployment, where the files show them.
- How the code is organized: main folders, entry points, and patterns such as routing, state management, data access and styling.
- Size and complexity, using the measured facts.
- What matters most for moving to ${demo.targetStack}: what will port easily, what needs rewriting, and anything that could block the move.

Only state what the evidence supports. Say so when something can't be determined from the files that were read. Don't restate the snapshot.`,
  };
}

export function researchRequest(stackReport: string, demo: DemoHints, effort: Effort): AgentRequest {
  return {
    step: "research",
    effort,
    demo,
    webSearch: { maxUses: 6 },
    prompt: `A team wants to migrate a project to: ${demo.targetStack}

Here is the analysis of the project's current stack:

${tagged("current_stack_report", stackReport)}

Technologies found in the project's manifests:
${technologyList(demo.facts)}

Search the web to learn how teams actually do this migration. Prefer official documentation and migration guides, then established engineering blogs and case studies. Then write the "Migration research" report:
- The recommended path for a project like this one (incremental or rewrite, and in what order), and why.
- Official guides, codemods and tools that help.
- Problems teams commonly hit, and how they solved them.
- Anything specific to this project's versions and libraries: deprecated APIs, packages without an equivalent, upgrades needed first.
- What sources say about typical timelines, if anything.

Keep it practical and specific to this project.`,
  };
}

export function estimateRequest(
  snapshot: string,
  stackReport: string,
  researchReport: string,
  demo: DemoHints,
  effort: Effort,
): AgentRequest {
  return {
    step: "estimate",
    context: snapshot,
    effort,
    demo,
    jsonSchema: estimateJsonSchema(),
    prompt: `The team wants to move this project to: ${demo.targetStack}

${tagged("current_stack_report", stackReport)}

${tagged("migration_research", researchReport)}

Estimate the engineering effort for this migration. Break the work into concrete work items, usually 5 to 12, such as project setup, porting specific parts of the codebase, data and state changes, tests, and deployment. Size each one for this repository using the measured facts in the snapshot (file counts, lines of code, dependencies), and give a low and a high estimate in hours for an experienced developer.

Give hours only. Don't add contingency, calendar time or cost: StackShift adds a contingency, converts hours to weeks for different team sizes and calculates cost itself.

Also list the main risks, each with likelihood, impact and a mitigation, and the assumptions behind your numbers. Base everything on this project's evidence rather than generic averages. Keep complexityReason to one or two sentences.`,
  };
}

export function planRequest(
  snapshot: string,
  stackReport: string,
  researchReport: string,
  estimateReport: string,
  demo: DemoHints,
  effort: Effort,
): AgentRequest {
  return {
    step: "plan",
    context: snapshot,
    effort,
    demo,
    prompt: `The team wants to move this project to: ${demo.targetStack}

${tagged("current_stack_report", stackReport)}

${tagged("migration_research", researchReport)}

${tagged("effort_estimate", estimateReport)}

Write the migration plan the team will follow:
1. **Executive summary**: what we're doing, why, the recommended approach, and the overall timeline (consistent with the effort estimate).
2. **Phases**: three to six phases in order. For each, give the goal, concrete tasks that name real files, folders and packages from this repository where possible, deliverables, and how we'll know the phase is done.
3. **Risks**: how to handle the risks in the estimate.
4. **Testing and rollback**: how to prove each phase works and how to back out safely.
5. **Team and roles**: who is needed, based on the estimate.
6. **First week**: a checklist of the very first tasks.

Use the estimate's numbers rather than new ones, and keep the plan specific to this repository.`,
  };
}
