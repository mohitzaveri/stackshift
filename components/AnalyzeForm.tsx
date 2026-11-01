"use client";

import { useState } from "react";
import { parseRepoUrl } from "@/lib/github";

export interface FormValues {
  repoUrl: string;
  targetStack: string;
  hourlyRate: number;
  accessCode?: string;
}

const SUGGESTIONS = [
  "Next.js 16 with TypeScript",
  "React 19 with Vite",
  "Vue 3 with Vite",
  "TypeScript (from JavaScript)",
  "FastAPI (from Flask)",
  "Spring Boot 3",
];

export function AnalyzeForm({
  initial,
  accessCodeRequired,
  onSubmit,
}: {
  initial?: FormValues;
  accessCodeRequired: boolean;
  onSubmit: (values: FormValues) => void;
}) {
  const [repoUrl, setRepoUrl] = useState(initial?.repoUrl ?? "");
  const [targetStack, setTargetStack] = useState(initial?.targetStack ?? "");
  const [hourlyRate, setHourlyRate] = useState(String(initial?.hourlyRate ?? 100));
  const [accessCode, setAccessCode] = useState(initial?.accessCode ?? "");
  const [error, setError] = useState("");

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const rate = Number(hourlyRate);
    if (!parseRepoUrl(repoUrl)) return setError("Enter a GitHub repository, like https://github.com/owner/repo.");
    if (targetStack.trim().length < 2) return setError("Describe the stack you want to move to.");
    if (!Number.isFinite(rate) || rate <= 0 || rate > 10_000) return setError("Enter an hourly rate between 1 and 10,000.");
    setError("");
    onSubmit({
      repoUrl: repoUrl.trim(),
      targetStack: targetStack.trim(),
      hourlyRate: rate,
      ...(accessCodeRequired ? { accessCode } : {}),
    });
  }

  return (
    <form className="card form" onSubmit={submit} noValidate>
      <label className="field">
        <span className="label">GitHub repository</span>
        <input
          type="text"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          placeholder="https://github.com/owner/repo"
          value={repoUrl}
          onChange={(e) => setRepoUrl(e.target.value)}
        />
        <span className="hint">
          Public repositories work right away. To analyze one part of a monorepo, link to its folder
          (…/tree/main/apps/web).
        </span>
      </label>

      <div className="field">
        <label className="label" htmlFor="target-stack">
          Where do you want to move it?
        </label>
        <input
          id="target-stack"
          type="text"
          autoComplete="off"
          placeholder="For example: Next.js 16 with TypeScript"
          value={targetStack}
          onChange={(e) => setTargetStack(e.target.value)}
        />
        <div className="chips" aria-label="Suggestions">
          {SUGGESTIONS.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              className={`chip${suggestion === targetStack ? " selected" : ""}`}
              onClick={() => setTargetStack(suggestion)}
            >
              {suggestion}
            </button>
          ))}
        </div>
      </div>

      <div className="field-row">
        <label className="field">
          <span className="label">Developer hourly rate (USD)</span>
          <input
            type="number"
            min={1}
            max={10000}
            step={1}
            value={hourlyRate}
            onChange={(e) => setHourlyRate(e.target.value)}
          />
          <span className="hint">Used to turn hours into cost.</span>
        </label>
        {accessCodeRequired && (
          <label className="field">
            <span className="label">Access code</span>
            <input type="password" value={accessCode} onChange={(e) => setAccessCode(e.target.value)} />
            <span className="hint">This server is protected. Ask its owner for the code.</span>
          </label>
        )}
      </div>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <button className="button primary large" type="submit">
        Analyze repository
      </button>
    </form>
  );
}
