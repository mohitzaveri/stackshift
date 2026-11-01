"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnalyzeForm, type FormValues } from "@/components/AnalyzeForm";
import { HistoryList } from "@/components/HistoryList";
import { Logo } from "@/components/Logo";
import { ResultView } from "@/components/ResultView";
import { RunView, newRunState, type RunState } from "@/components/RunView";
import { parseRepoUrl } from "@/lib/github";
import { addToHistory, loadHistory, removeFromHistory } from "@/lib/history";
import { readNdjson } from "@/lib/ndjson";
import { STEPS, type AnalysisResult, type PipelineEvent, type StepId } from "@/lib/types";

interface ServerInfo {
  demo: boolean;
  model: string;
  accessCodeRequired: boolean;
}

type View = { kind: "home" } | { kind: "running"; run: RunState } | { kind: "result"; result: AnalysisResult };

/** Streamed text is batched and applied every few frames, instead of re-rendering on every token. */
const FLUSH_MS = 80;

export default function Home() {
  const [view, setView] = useState<View>({ kind: "home" });
  const [server, setServer] = useState<ServerInfo | null>(null);
  const [history, setHistory] = useState<AnalysisResult[]>([]);
  const [lastValues, setLastValues] = useState<FormValues>();
  const abortRef = useRef<AbortController | null>(null);
  const pendingText = useRef<Partial<Record<StepId, string>>>({});
  const flushTimer = useRef<number | null>(null);
  const activityId = useRef(0);

  useEffect(() => {
    setHistory(loadHistory());
    fetch("/api/health")
      .then((res) => res.json())
      .then((info: ServerInfo) => setServer(info))
      .catch(() => setServer(null));
    return () => abortRef.current?.abort();
  }, []);

  const updateRun = useCallback((update: (run: RunState) => RunState) => {
    setView((current) => (current.kind === "running" ? { kind: "running", run: update(current.run) } : current));
  }, []);

  const flushText = useCallback(() => {
    if (flushTimer.current !== null) window.clearTimeout(flushTimer.current);
    flushTimer.current = null;
    const chunks = pendingText.current;
    pendingText.current = {};
    updateRun((run) => {
      const texts = { ...run.texts };
      for (const [step, text] of Object.entries(chunks) as Array<[StepId, string]>) {
        texts[step] = (texts[step] ?? "") + text;
      }
      return { ...run, texts };
    });
  }, [updateRun]);

  const handleEvent = useCallback(
    (event: PipelineEvent) => {
      switch (event.type) {
        case "delta":
          pendingText.current[event.step] = (pendingText.current[event.step] ?? "") + event.text;
          flushTimer.current ??= window.setTimeout(flushText, FLUSH_MS);
          break;
        case "step":
          updateRun((run) => ({
            ...run,
            status: { ...run.status, [event.step]: event.status },
            summaries: event.summary ? { ...run.summaries, [event.step]: event.summary } : run.summaries,
            current: event.status === "running" ? event.step : run.current,
          }));
          break;
        case "activity":
          updateRun((run) => ({
            ...run,
            activity: [...run.activity.slice(-40), { id: activityId.current++, step: event.step, message: event.message }],
          }));
          break;
        case "error":
          flushText();
          updateRun((run) => {
            const failed = event.step ?? run.current;
            return {
              ...run,
              error: event.message,
              endedAt: Date.now(),
              status: failed ? { ...run.status, [failed]: "failed" } : run.status,
            };
          });
          break;
        default:
          break;
      }
    },
    [flushText, updateRun],
  );

  async function start(values: FormValues) {
    const ref = parseRepoUrl(values.repoUrl);
    const controller = new AbortController();
    abortRef.current = controller;
    pendingText.current = {};
    setLastValues(values);
    setView({ kind: "running", run: newRunState(ref ? `${ref.owner}/${ref.repo}` : values.repoUrl, values.targetStack) });
    window.scrollTo({ top: 0 });

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? `The server returned an error (${res.status}).`);
      }

      let finished = false;
      for await (const event of readNdjson<PipelineEvent>(res.body)) {
        if (event.type === "result") {
          finished = true;
          setHistory(addToHistory(event.result));
          setView({ kind: "result", result: event.result });
          window.scrollTo({ top: 0 });
        } else {
          if (event.type === "error") finished = true;
          handleEvent(event);
        }
      }
      if (!finished) throw new Error("The connection closed before the analysis finished. Try again.");
    } catch (err) {
      if (controller.signal.aborted) return;
      handleEvent({ type: "error", message: err instanceof Error ? err.message : String(err) });
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }

  function cancel() {
    abortRef.current?.abort();
    abortRef.current = null;
    setView({ kind: "home" });
  }

  return (
    <>
      <header className="site-header">
        <div className="container header-inner">
          <button className="brand" onClick={() => view.kind !== "running" && setView({ kind: "home" })}>
            <Logo />
            <span>StackShift</span>
          </button>
          {server && <span className="badge">{server.demo ? "Demo mode" : server.model}</span>}
        </div>
      </header>

      <main className="container main">
        {view.kind === "home" && (
          <>
            <section className="hero">
              <h1>Plan your tech stack migration</h1>
              <p className="lead">
                Point StackShift at a GitHub repository and tell it where you want to go. It reads the real code,
                researches the move on the web, estimates the effort and writes a step-by-step plan.
              </p>
            </section>

            {server?.demo && (
              <div className="alert info">
                Demo mode is on. StackShift reads the repository for real, but the AI steps are placeholders. Set{" "}
                <code>ANTHROPIC_API_KEY</code> and turn off <code>DEMO_MODE</code> for a real analysis.
              </div>
            )}

            <AnalyzeForm initial={lastValues} accessCodeRequired={server?.accessCodeRequired ?? false} onSubmit={start} />

            <section className="how">
              <h3>How it works</h3>
              <ol className="how-steps">
                {STEPS.map((step, index) => (
                  <li key={step.id}>
                    <span className="how-number">{index + 1}</span>
                    <div>
                      <strong>{step.title}</strong>
                      <p>{step.description}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </section>

            <HistoryList
              entries={history}
              onOpen={(result) => {
                setView({ kind: "result", result });
                window.scrollTo({ top: 0 });
              }}
              onRemove={(id) => setHistory(removeFromHistory(id))}
            />
          </>
        )}

        {view.kind === "running" && <RunView run={view.run} onCancel={cancel} onBack={() => setView({ kind: "home" })} />}

        {view.kind === "result" && <ResultView result={view.result} onNew={() => setView({ kind: "home" })} />}
      </main>

      <footer className="container site-footer">
        StackShift v1 · Built with Next.js and Claude · Estimates are a starting point for planning, not a quote.
      </footer>
    </>
  );
}
