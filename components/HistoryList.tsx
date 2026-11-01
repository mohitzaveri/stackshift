"use client";

import type { AnalysisResult } from "@/lib/types";

export function HistoryList({
  entries,
  onOpen,
  onRemove,
}: {
  entries: AnalysisResult[];
  onOpen: (result: AnalysisResult) => void;
  onRemove: (id: string) => void;
}) {
  if (!entries.length) return null;
  return (
    <section className="history">
      <h3>Recent analyses</h3>
      <ul>
        {entries.map((entry) => (
          <li key={entry.id}>
            <button className="history-item" onClick={() => onOpen(entry)}>
              <span className="history-title">
                {entry.repo.owner}/{entry.repo.name} → {entry.targetStack}
              </span>
              <span className="muted">
                {new Date(entry.createdAt).toLocaleDateString()}
                {entry.demo ? " · demo" : ""}
              </span>
            </button>
            <button
              className="icon-button"
              aria-label={`Remove ${entry.repo.owner}/${entry.repo.name} from history`}
              onClick={() => onRemove(entry.id)}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      <p className="hint">Saved in this browser only.</p>
    </section>
  );
}
