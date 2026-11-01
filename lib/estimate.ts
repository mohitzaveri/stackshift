import { z } from "zod";
import { AgentError } from "./errors";
import { capitalize, formatRange, formatUsd, formatWeeks } from "./format";
import type { ComputedEstimate, TeamTimeline } from "./types";

/** Buffer added on top of the AI's hours for things nobody saw coming. */
export const CONTINGENCY_PERCENT = 20;
/** Hours per week a developer spends on the migration itself (meetings, reviews and support take the rest). */
export const FOCUS_HOURS_PER_WEEK = 30;
/** Extra coordination cost for each developer beyond the first. */
export const COORDINATION_OVERHEAD = 0.15;
export const TEAM_SIZES = [1, 3, 5] as const;

const Level = z.enum(["low", "medium", "high"]);

/** What the AI returns for the estimate step (enforced with structured outputs). */
export const EstimateSchema = z.object({
  complexity: Level,
  complexityReason: z.string(),
  confidence: Level,
  workItems: z.array(
    z.object({
      name: z.string(),
      description: z.string(),
      hoursLow: z.number(),
      hoursHigh: z.number(),
    }),
  ),
  risks: z.array(
    z.object({
      title: z.string(),
      likelihood: Level,
      impact: Level,
      mitigation: z.string(),
    }),
  ),
  assumptions: z.array(z.string()),
});

export type EstimateDraft = z.infer<typeof EstimateSchema>;

/** JSON Schema for the Claude API's `output_config.format`. */
export function estimateJsonSchema(): Record<string, unknown> {
  const { $schema: _dialect, ...schema } = z.toJSONSchema(EstimateSchema) as Record<string, unknown>;
  return schema;
}

export function parseEstimate(text: string): EstimateDraft {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new AgentError("The effort estimate came back in an unexpected format. Run the analysis again.");
  }
  const parsed = EstimateSchema.safeParse(data);
  if (!parsed.success) {
    throw new AgentError("The effort estimate was missing some fields. Run the analysis again.");
  }
  if (parsed.data.workItems.length === 0) {
    throw new AgentError("The effort estimate didn't include any work items. Run the analysis again.");
  }
  return parsed.data;
}

function hours(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.round(value * 10) / 10 : 0;
}

/** Calendar weeks for a team, rounded up to the nearest half week. */
export function weeksFor(totalHours: number, developers: number): number {
  const weeks = (totalHours / (developers * FOCUS_HOURS_PER_WEEK)) * (1 + COORDINATION_OVERHEAD * (developers - 1));
  return Math.max(0.5, Math.ceil(weeks * 2) / 2);
}

/** Turns the AI's per-item hours into totals, cost and timelines. All arithmetic happens here, not in the AI. */
export function computeEstimate(draft: EstimateDraft, hourlyRate: number): ComputedEstimate {
  const workItems = draft.workItems.map((item) => {
    const a = hours(item.hoursLow);
    const b = hours(item.hoursHigh);
    return { ...item, hoursLow: Math.min(a, b), hoursHigh: Math.max(a, b) };
  });
  const baseHoursLow = workItems.reduce((sum, item) => sum + item.hoursLow, 0);
  const baseHoursHigh = workItems.reduce((sum, item) => sum + item.hoursHigh, 0);
  const factor = 1 + CONTINGENCY_PERCENT / 100;
  const totalHoursLow = Math.round(baseHoursLow * factor);
  const totalHoursHigh = Math.round(baseHoursHigh * factor);
  const timelines: TeamTimeline[] = TEAM_SIZES.map((developers) => ({
    developers,
    weeksLow: weeksFor(totalHoursLow, developers),
    weeksHigh: weeksFor(totalHoursHigh, developers),
  }));

  return {
    complexity: draft.complexity,
    complexityReason: draft.complexityReason,
    confidence: draft.confidence,
    workItems,
    risks: draft.risks,
    assumptions: draft.assumptions,
    baseHoursLow: Math.round(baseHoursLow),
    baseHoursHigh: Math.round(baseHoursHigh),
    contingencyPercent: CONTINGENCY_PERCENT,
    totalHoursLow,
    totalHoursHigh,
    hourlyRate,
    costLow: totalHoursLow * hourlyRate,
    costHigh: totalHoursHigh * hourlyRate,
    timelines,
  };
}

function cell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ");
}

export function renderEstimateMarkdown(estimate: ComputedEstimate): string {
  const lines = [
    "## Summary",
    "",
    `- **Complexity:** ${capitalize(estimate.complexity)}. ${estimate.complexityReason}`,
    `- **Total effort:** ${formatRange(estimate.totalHoursLow, estimate.totalHoursHigh)} hours, including a ${estimate.contingencyPercent}% contingency`,
    `- **Cost:** ${formatRange(estimate.costLow, estimate.costHigh, formatUsd)} at ${formatUsd(estimate.hourlyRate)} per hour`,
    `- **Confidence:** ${capitalize(estimate.confidence)}`,
    "",
    "## Timeline by team size",
    "",
    "| Team | Calendar time |",
    "| --- | --- |",
    ...estimate.timelines.map(
      (t) => `| ${t.developers} developer${t.developers === 1 ? "" : "s"} | ${formatWeeks(t.weeksLow, t.weeksHigh)} |`,
    ),
    "",
    "## Work breakdown",
    "",
    "| Work item | Hours | What it involves |",
    "| --- | --- | --- |",
    ...estimate.workItems.map(
      (item) => `| ${cell(item.name)} | ${formatRange(item.hoursLow, item.hoursHigh)} | ${cell(item.description)} |`,
    ),
    `| **Subtotal** | **${formatRange(estimate.baseHoursLow, estimate.baseHoursHigh)}** | Before the ${estimate.contingencyPercent}% contingency |`,
    "",
  ];

  if (estimate.risks.length) {
    lines.push(
      "## Risks",
      "",
      "| Risk | Likelihood | Impact | Mitigation |",
      "| --- | --- | --- | --- |",
      ...estimate.risks.map(
        (risk) =>
          `| ${cell(risk.title)} | ${capitalize(risk.likelihood)} | ${capitalize(risk.impact)} | ${cell(risk.mitigation)} |`,
      ),
      "",
    );
  }
  if (estimate.assumptions.length) {
    lines.push("## Assumptions", "", ...estimate.assumptions.map((a) => `- ${a}`), "");
  }
  lines.push(
    "## How these numbers are calculated",
    "",
    `Claude sizes each work item in hours from the repository's measured size and the migration research. ` +
      `StackShift then does the math: it adds a ${estimate.contingencyPercent}% contingency, multiplies by the hourly rate, ` +
      `and converts hours to calendar weeks assuming ${FOCUS_HOURS_PER_WEEK} focused hours per developer per week, ` +
      `plus ${Math.round(COORDINATION_OVERHEAD * 100)}% coordination overhead for each developer beyond the first.`,
  );
  return lines.join("\n");
}
