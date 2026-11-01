"use client";

import { useEffect, useState } from "react";
import { Markdown } from "@/components/Markdown";
import { formatDuration } from "@/lib/format";
import { STEPS, type StepId } from "@/lib/types";

export type StepStatus = "pending" | "running" | "done" | "failed";

export interface RunState {
  repoLabel: string;
  targetStack: string;
  startedAt: number;
  endedAt?: number;
  status: Record<StepId, StepStatus>;
  summaries: Partial<Record<StepId, string>>;
  texts: Partial<Record<StepId, string>>;
  activity: Array<{ id: number; step: StepId; message: string }>;
  current: StepId | null;
  error?: string;
}

export function newRunState(repoLabel: string, targetStack: string): RunState {
  return {
    repoLabel,
    targetStack,
    startedAt: Date.now(),
    status: { repo: "pending", stack: "pending", research: "pending", estimate: "pending", plan: "pending" },
    summaries: {},
    texts: {},
    activity: [],
    current: null,
  };
}

const ICONS: Record<StepStatus, string> = { pending: "", running: "", done: "✓", failed: "!" };

function useElapsed(startedAt: number, endedAt?: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (endedAt) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [endedAt]);
  return (endedAt ?? now) - startedAt;
}

export function RunView({ run, onCancel, onBack }: { run: RunState; onCancel: () => void; onBack: () => void }) {
  const elapsed = useElapsed(run.startedAt, run.endedAt);
  const shown = run.current ?? "repo";
  const shownStep = STEPS.find((step) => step.id === shown)!;
  const text = run.texts[shown];
  const activity = run.activity.filter((item) => item.step === shown).slice(-4);
  const running = !run.error && run.status[shown] === "running";

  return (
    <section className="run" aria-live="polite">
      <div className="page-header">
        <div>
          <p className="eyebrow">{run.error ? "Analysis stopped" : "Analyzing"}</p>
          <h2>
            {run.repoLabel} <span className="arrow">→</span> {run.targetStack}
          </h2>
        </div>
        <div className="header-actions">
          <span className="timer" title="Time elapsed">
            {formatDuration(elapsed)}
          </span>
          {run.error ? (
            <button className="button primary" onClick={onBack}>
              Start over
            </button>
          ) : (
            <button className="button" onClick={onCancel}>
              Cancel
            </button>
          )}
        </div>
      </div>

      {run.error && (
        <div className="alert error" role="alert">
          {run.error}
        </div>
      )}

      <div className="run-grid">
        <ol className="steps">
          {STEPS.map((step) => {
            const status = run.status[step.id];
            return (
              <li key={step.id} className={`step ${status}`}>
                <span className="step-icon" aria-hidden="true">
                  {ICONS[status]}
                </span>
                <div>
                  <div className="step-title">{step.title}</div>
                  <div className="step-detail">{run.summaries[step.id] || step.description}</div>
                </div>
              </li>
            );
          })}
          {!run.error && <li className="steps-note">Usually takes a few minutes. Keep this tab open.</li>}
        </ol>

        <div className="card live">
          <div className="live-header">
            <span>{shownStep.title}</span>
            {running && <span className="pulse" aria-label="In progress" />}
          </div>
          {activity.length > 0 && (
            <ul className="activity">
              {activity.map((item) => (
                <li key={item.id}>{item.message}</li>
              ))}
            </ul>
          )}
          {text ? (
            <Markdown text={text} />
          ) : (
            <p className="muted">
              {run.error
                ? "This step stopped before it produced any output."
                : shown === "repo"
                  ? "Reading the file tree, manifests and key source files from GitHub…"
                  : shown === "estimate"
                    ? "Sizing each piece of work in hours…"
                    : "Thinking…"}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
