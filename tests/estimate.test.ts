import { describe, expect, it } from "vitest";
import {
  computeEstimate,
  estimateJsonSchema,
  parseEstimate,
  renderEstimateMarkdown,
  weeksFor,
} from "../lib/estimate";
import { estimateDraft } from "./fixtures";

describe("computeEstimate", () => {
  it("adds contingency, prices the hours and converts them to weeks", () => {
    const estimate = computeEstimate(estimateDraft, 100);
    expect(estimate.baseHoursLow).toBe(15);
    expect(estimate.baseHoursHigh).toBe(30);
    expect(estimate.totalHoursLow).toBe(18);
    expect(estimate.totalHoursHigh).toBe(36);
    expect(estimate.costLow).toBe(1800);
    expect(estimate.costHigh).toBe(3600);
    expect(estimate.timelines).toEqual([
      { developers: 1, weeksLow: 1, weeksHigh: 1.5 },
      { developers: 3, weeksLow: 0.5, weeksHigh: 1 },
      { developers: 5, weeksLow: 0.5, weeksHigh: 0.5 },
    ]);
  });

  it("fixes swapped, negative and non-numeric hours instead of trusting them", () => {
    const estimate = computeEstimate(
      {
        ...estimateDraft,
        workItems: [
          { name: "Swapped", description: "", hoursLow: 20, hoursHigh: 10 },
          { name: "Negative", description: "", hoursLow: -5, hoursHigh: 4 },
          { name: "Broken", description: "", hoursLow: Number.NaN, hoursHigh: 2 },
        ],
      },
      150,
    );
    expect(estimate.workItems.map((w) => [w.hoursLow, w.hoursHigh])).toEqual([
      [10, 20],
      [0, 4],
      [0, 2],
    ]);
    expect(estimate.baseHoursLow).toBe(10);
    expect(estimate.baseHoursHigh).toBe(26);
  });

  it("gives bigger teams fewer weeks, with coordination overhead", () => {
    expect(weeksFor(600, 1)).toBe(20);
    expect(weeksFor(600, 5)).toBe(6.5); // 4 weeks of work, plus 60% overhead, rounded up to half a week
  });
});

describe("parseEstimate", () => {
  it("accepts valid JSON", () => {
    expect(parseEstimate(JSON.stringify(estimateDraft))).toEqual(estimateDraft);
  });

  it.each([
    ["not JSON", "{oops"],
    ["missing fields", JSON.stringify({ complexity: "low" })],
    ["no work items", JSON.stringify({ ...estimateDraft, workItems: [] })],
  ])("rejects %s", (_label, text) => {
    expect(() => parseEstimate(text)).toThrow(/estimate/);
  });
});

describe("estimateJsonSchema", () => {
  it("is a closed object schema the structured-outputs API accepts", () => {
    const schema = estimateJsonSchema();
    expect(schema).not.toHaveProperty("$schema");
    expect(schema).toMatchObject({
      type: "object",
      additionalProperties: false,
      required: ["complexity", "complexityReason", "confidence", "workItems", "risks", "assumptions"],
    });
  });
});

describe("renderEstimateMarkdown", () => {
  it("shows the totals and keeps table cells intact", () => {
    const estimate = computeEstimate(
      {
        ...estimateDraft,
        risks: [{ title: "Old | new routing", likelihood: "low", impact: "high", mitigation: "Port\nroutes first" }],
      },
      100,
    );
    const markdown = renderEstimateMarkdown(estimate);
    expect(markdown).toContain("18–36 hours, including a 20% contingency");
    expect(markdown).toContain("$1,800–$3,600 at $100 per hour");
    expect(markdown).toContain("| 3 developers | 0.5–1 weeks |");
    expect(markdown).toContain("| Old \\| new routing | Low | High | Port routes first |");
  });
});
