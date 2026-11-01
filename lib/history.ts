import type { AnalysisResult } from "./types";

const KEY = "stackshift:history:v1";
const MAX_ENTRIES = 10;

/** Past analyses saved in this browser. Storage can be unavailable (private mode), so every call is guarded. */
export function loadHistory(): AnalysisResult[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as AnalysisResult[]) : [];
  } catch {
    return [];
  }
}

function save(entries: AnalysisResult[]): AnalysisResult[] {
  // If storage is full, drop the oldest entries until the list fits.
  for (let list = entries; list.length; list = list.slice(0, -1)) {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(list));
      return list;
    } catch {
      // keep trimming
    }
  }
  return [];
}

export function addToHistory(result: AnalysisResult): AnalysisResult[] {
  return save([result, ...loadHistory().filter((entry) => entry.id !== result.id)].slice(0, MAX_ENTRIES));
}

export function removeFromHistory(id: string): AnalysisResult[] {
  return save(loadHistory().filter((entry) => entry.id !== id));
}
