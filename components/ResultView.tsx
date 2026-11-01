"use client";

import { useState } from "react";
import { Markdown } from "@/components/Markdown";
import { totalTokens } from "@/lib/cost";
import {
  capitalize,
  formatDuration,
  formatNumber,
  formatRange,
  formatRate,
  formatUsd,
  formatUsdPrecise,
  formatWeeks,
} from "@/lib/format";
import { REPORT_ORDER, buildFullReport, downloadText, modelLabel, repoLabel, reportFileName } from "@/lib/report";
import { REPORT_TITLES, type AnalysisResult, type ReportId } from "@/lib/types";

function Stat({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="stat card">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      <div className="stat-note">{note}</div>
    </div>
  );
}

export function ResultView({ result, onNew }: { result: AnalysisResult; onNew: () => void }) {
  const [tab, setTab] = useState<ReportId>("stack");
  const [copied, setCopied] = useState(false);
  const estimate = result.estimate;
  const team = estimate.timelines.find((t) => t.developers === 3) ?? estimate.timelines[0];

  async function copy() {
    try {
      await navigator.clipboard.writeText(result.reports[tab]);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can be blocked; downloading still works.
    }
  }

  return (
    <section className="result">
      <div className="page-header">
        <div>
          <p className="eyebrow">Migration report</p>
          <h2>
            <a href={result.repo.url} target="_blank" rel="noopener noreferrer">
              {repoLabel(result.repo)}
            </a>{" "}
            <span className="arrow">→</span> {result.targetStack}
          </h2>
          <p className="muted">
            {new Date(result.createdAt).toLocaleString()} · {result.demo ? "Demo mode (no AI)" : modelLabel(result)}
          </p>
        </div>
        <div className="header-actions">
          <button className="button" onClick={() => downloadText(reportFileName(result, "full"), buildFullReport(result))}>
            Download full report
          </button>
          <button className="button primary" onClick={onNew}>
            New analysis
          </button>
        </div>
      </div>

      {result.demo && (
        <div className="alert info">
          Demo mode: the repository facts are real, but the reports and numbers are placeholders. Add an Anthropic API
          key for a real analysis.
        </div>
      )}

      <div className="stats">
        <Stat label="Complexity" value={capitalize(estimate.complexity)} note={`Confidence: ${estimate.confidence}`} />
        <Stat
          label="Effort"
          value={`${formatRange(estimate.totalHoursLow, estimate.totalHoursHigh)} h`}
          note={`Includes ${estimate.contingencyPercent}% contingency`}
        />
        <Stat
          label="Cost"
          value={formatRange(estimate.costLow, estimate.costHigh, formatUsd)}
          note={`At ${formatRate(estimate.hourlyRate)} per hour`}
        />
        <Stat
          label="Timeline"
          value={formatWeeks(team.weeksLow, team.weeksHigh)}
          note={`With ${team.developers} developer${team.developers === 1 ? "" : "s"}`}
        />
      </div>

      <div className="tabs" role="tablist" aria-label="Reports">
        {REPORT_ORDER.map((id) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            className={`tab${tab === id ? " active" : ""}`}
            onClick={() => setTab(id)}
          >
            {REPORT_TITLES[id]}
          </button>
        ))}
      </div>

      <article className="card report" role="tabpanel">
        <Markdown text={result.reports[tab]} />
      </article>

      <div className="report-actions">
        <button className="button" onClick={() => downloadText(reportFileName(result, tab), result.reports[tab])}>
          Download this report (.md)
        </button>
        <button className="button" onClick={copy}>
          {copied ? "Copied" : "Copy Markdown"}
        </button>
      </div>

      <p className="run-meta">
        {result.repo.totalFiles.toLocaleString("en-US")} files · about {formatNumber(result.repo.estimatedLines)} lines of
        code · {result.repo.filesRead} files read · took {formatDuration(result.durationMs)} ·{" "}
        {formatNumber(totalTokens(result.usage))} tokens · {result.usage.webSearches} web searches · AI cost{" "}
        {result.costUsd === null ? "unknown" : formatUsdPrecise(result.costUsd)}
      </p>
    </section>
  );
}
