import { describe, expect, it } from "vitest";
import { createDemoClient } from "../lib/demo";
import { runAnalysis } from "../lib/pipeline";
import { buildFullReport, reportFileName } from "../lib/report";
import { fakeFetch, reactApp, repoRoutes } from "./fixtures";

async function demoResult() {
  return runAnalysis(
    { repo: { owner: "acme", repo: "food-app" }, targetStack: "Vue 3 with Vite", hourlyRate: 120 },
    { llm: createDemoClient({ delayMs: 0 }), emit: () => {}, github: { fetchImpl: fakeFetch(repoRoutes(reactApp)).fetch } },
  );
}

describe("buildFullReport", () => {
  it("puts all four reports in order under one header", async () => {
    const result = await demoResult();
    const report = buildFullReport(result);
    expect(report.startsWith("# Migration report: acme/food-app → Vue 3 with Vite")).toBe(true);
    expect(report).toContain("in demo mode (no AI)");
    const order = ["# 1. Current stack", "# 2. Migration research", "# 3. Effort estimate", "# 4. Migration plan"].map(
      (heading) => report.indexOf(heading),
    );
    expect(order.every((index) => index > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("names downloads after the repository", async () => {
    const result = await demoResult();
    expect(reportFileName(result, "full")).toBe("acme-food-app-migration-report.md");
    expect(reportFileName(result, "plan")).toBe("acme-food-app-plan.md");
  });
});
