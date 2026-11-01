export type StepId = "repo" | "stack" | "research" | "estimate" | "plan";
export type ReportId = Exclude<StepId, "repo">;
export type Level = "low" | "medium" | "high";

export const STEPS: ReadonlyArray<{ id: StepId; title: string; description: string }> = [
  {
    id: "repo",
    title: "Read the repository",
    description: "Fetch the file tree, manifests and key source files from GitHub.",
  },
  {
    id: "stack",
    title: "Analyze the current stack",
    description: "Work out what the project is built with, from the real files.",
  },
  {
    id: "research",
    title: "Research the migration",
    description: "Search the web for official guides, tools and known problems.",
  },
  {
    id: "estimate",
    title: "Estimate the effort",
    description: "Size each piece of work in hours, then calculate time and cost.",
  },
  {
    id: "plan",
    title: "Write the migration plan",
    description: "Turn everything into a phase-by-phase plan a team can follow.",
  },
];

export const REPORT_TITLES: Record<ReportId, string> = {
  stack: "Current stack",
  research: "Migration research",
  estimate: "Effort estimate",
  plan: "Migration plan",
};

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  webSearches: number;
}

export interface Source {
  url: string;
  title: string;
}

export interface RepoRef {
  owner: string;
  repo: string;
  /** From a /tree/<branch>/... link. Defaults to the repository's default branch. */
  branch?: string;
  /** From a /tree/<branch>/<path> link: analyze only this folder. */
  path?: string;
}

export interface RepoFile {
  path: string;
  size: number;
}

export interface FileContent {
  path: string;
  text: string;
  /** Line count of the whole file, even when `text` is truncated. */
  lines: number;
  truncated: boolean;
}

export interface RepoSnapshot {
  ref: RepoRef;
  url: string;
  /** The branch that was read. */
  branch: string;
  /** The folder that was read, or null for the whole repository. */
  path: string | null;
  description: string | null;
  stars: number;
  license: string | null;
  pushedAt: string | null;
  isPrivate: boolean;
  /** Bytes of code per language, as reported by GitHub. */
  languages: Record<string, number>;
  files: RepoFile[];
  treeTruncated: boolean;
  contents: FileContent[];
}

export interface Technology {
  name: string;
  version?: string;
  /** The file the technology was found in (the most important one, if several list it). */
  source: string;
  /** How many files list it, when more than one does. */
  count?: number;
}

/** Facts measured from the repository by code, not by the AI. */
export interface RepoFacts {
  owner: string;
  name: string;
  url: string;
  branch: string;
  /** The folder that was analyzed, or null for the whole repository. */
  path: string | null;
  description: string | null;
  stars: number;
  license: string | null;
  pushedAt: string | null;
  totalFiles: number;
  sourceFiles: number;
  testFiles: number;
  estimatedLines: number;
  /** Source files left out of the line count because they're very large or generated. */
  linesExcludedFiles: number;
  languages: Array<{ name: string; percent: number }>;
  /** The most important manifests, up to 20. */
  manifests: string[];
  manifestCount: number;
  technologies: Technology[];
  filesRead: number;
  treeTruncated: boolean;
}

export interface WorkItem {
  name: string;
  description: string;
  hoursLow: number;
  hoursHigh: number;
}

export interface Risk {
  title: string;
  likelihood: Level;
  impact: Level;
  mitigation: string;
}

export interface TeamTimeline {
  developers: number;
  weeksLow: number;
  weeksHigh: number;
}

export interface ComputedEstimate {
  complexity: Level;
  complexityReason: string;
  confidence: Level;
  workItems: WorkItem[];
  risks: Risk[];
  assumptions: string[];
  baseHoursLow: number;
  baseHoursHigh: number;
  contingencyPercent: number;
  totalHoursLow: number;
  totalHoursHigh: number;
  hourlyRate: number;
  costLow: number;
  costHigh: number;
  timelines: TeamTimeline[];
}

export interface AnalysisResult {
  id: string;
  createdAt: string;
  repo: RepoFacts;
  targetStack: string;
  demo: boolean;
  /** The model that was requested. */
  model: string;
  /** Models that actually answered; includes fallback models if any step used one. */
  servedBy: string[];
  reports: Record<ReportId, string>;
  estimate: ComputedEstimate;
  sources: Source[];
  usage: Usage;
  /** What the Claude API calls cost, at list prices. Null when the model's price is unknown. */
  costUsd: number | null;
  durationMs: number;
}

/** One line of the NDJSON stream sent from /api/analyze to the browser. */
export type PipelineEvent =
  | { type: "step"; step: StepId; status: "running" | "done"; summary?: string }
  | { type: "activity"; step: StepId; message: string }
  | { type: "delta"; step: StepId; text: string }
  | { type: "result"; result: AnalysisResult }
  | { type: "error"; message: string; step?: StepId }
  | { type: "ping" };
