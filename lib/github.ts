import { RepoError, isAbortError } from "./errors";
import {
  depth,
  isBinary,
  isConfigFile,
  isEntryPoint,
  isIgnoredPath,
  isLockfile,
  isManifest,
  isSourceFile,
  isTestFile,
} from "./detect";
import type { FileContent, RepoFacts, RepoFile, RepoRef, RepoSnapshot } from "./types";

const API = "https://api.github.com";

/** Most files StackShift reads from one repository. */
export const MAX_FILES_READ = 40;
/** Files larger than this are listed in the tree but never downloaded. */
const MAX_FILE_BYTES = 200_000;
/** Longest excerpt of a single file that goes into the prompt. */
export const MAX_FILE_CHARS = 24_000;
/** Total characters of file contents that go into the prompt (roughly 40K tokens). */
export const MAX_CONTENT_CHARS = 160_000;
/** Most paths listed in the snapshot's file tree. */
const MAX_TREE_PATHS = 600;

export interface GithubOptions {
  /** Raises the rate limit from 60 to 5,000 requests per hour and allows private repositories. */
  token?: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}

const OWNER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPO_PATTERN = /^[A-Za-z0-9._-]{1,100}$/;

/**
 * Accepts https://github.com/owner/repo (with or without .git, a trailing slash, or a /tree/... path),
 * github.com/owner/repo, git@github.com:owner/repo.git and owner/repo.
 */
export function parseRepoUrl(input: string): RepoRef | null {
  let value = input.trim();
  if (!value) return null;

  let owner: string | undefined;
  let repo: string | undefined;
  const ssh = value.match(/^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?\/?$/i);
  if (ssh) {
    [, owner, repo] = ssh;
  } else {
    if (!/^[a-z]+:\/\//i.test(value)) {
      value = /^(www\.)?github\.com\//i.test(value) ? `https://${value}` : `https://github.com/${value}`;
    }
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      return null;
    }
    if (!/^https?:$/.test(url.protocol) || !/^(www\.)?github\.com$/i.test(url.hostname)) return null;
    [owner, repo] = url.pathname.split("/").filter(Boolean);
    repo = repo?.replace(/\.git$/i, "");
  }

  if (!owner || !repo || !OWNER_PATTERN.test(owner) || !REPO_PATTERN.test(repo)) return null;
  if (repo === "." || repo === "..") return null;
  return { owner, repo };
}

interface RepoMeta {
  html_url: string;
  default_branch: string;
  description: string | null;
  stargazers_count: number;
  license: { spdx_id: string | null; name: string } | null;
  pushed_at: string | null;
  private: boolean;
}

interface TreeResponse {
  truncated: boolean;
  tree: Array<{ path: string; type: string; size?: number }>;
}

function apiHeaders(token: string | undefined, accept = "application/vnd.github+json"): HeadersInit {
  return {
    Accept: accept,
    "User-Agent": "stackshift",
    "X-GitHub-Api-Version": "2022-11-28",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function request(url: string, init: RequestInit, opts: GithubOptions): Promise<Response> {
  try {
    return await (opts.fetchImpl ?? fetch)(url, { ...init, signal: opts.signal });
  } catch (err) {
    if (isAbortError(err)) throw err;
    throw new RepoError("Couldn't reach GitHub. Check your internet connection and try again.");
  }
}

function errorFor(res: Response, opts: GithubOptions): RepoError {
  const rateLimited = (res.status === 403 || res.status === 429) && res.headers.get("x-ratelimit-remaining") === "0";
  if (rateLimited) {
    return new RepoError(
      opts.token
        ? "GitHub's rate limit for your token was reached. Try again in a few minutes."
        : "GitHub's limit of 60 anonymous requests per hour was reached. Add a GITHUB_TOKEN, or try again later.",
    );
  }
  switch (res.status) {
    case 401:
      return new RepoError("GitHub rejected the GITHUB_TOKEN. Check that it is valid.");
    case 404:
      return new RepoError(
        opts.token
          ? "Repository not found. Check the URL, and that your GITHUB_TOKEN can read it."
          : "Repository not found. Check the URL. If the repository is private, add a GITHUB_TOKEN that can read it.",
      );
    case 409:
      return new RepoError("This repository is empty, so there is nothing to analyze.");
    default:
      return new RepoError(`GitHub returned an error (${res.status}). Try again in a moment.`);
  }
}

async function getJson<T>(path: string, opts: GithubOptions): Promise<T> {
  const res = await request(`${API}${path}`, { headers: apiHeaders(opts.token) }, opts);
  if (!res.ok) throw errorFor(res, opts);
  return (await res.json()) as T;
}

/**
 * Picks the files worth reading, most useful first: the README, manifests, config files,
 * entry points, then the largest source files, until the character budget is used.
 */
export function selectFilesToRead(files: RepoFile[]): string[] {
  const candidates = files.filter(
    (file) =>
      file.size > 0 &&
      file.size <= MAX_FILE_BYTES &&
      !isIgnoredPath(file.path) &&
      !isBinary(file.path) &&
      !isLockfile(file.path),
  );
  const byDepth = (a: RepoFile, b: RepoFile) => depth(a.path) - depth(b.path) || a.path.localeCompare(b.path);
  const groups: RepoFile[][] = [
    candidates.filter((file) => /^readme(\.[a-z]+)?$/i.test(file.path)),
    candidates.filter((file) => isManifest(file.path) && depth(file.path) <= 3).sort(byDepth).slice(0, 12),
    candidates.filter((file) => isConfigFile(file.path) && depth(file.path) <= 2).sort(byDepth).slice(0, 10),
    candidates
      .filter((file) => isSourceFile(file.path) && isEntryPoint(file.path) && !isTestFile(file.path) && depth(file.path) <= 4)
      .sort(byDepth)
      .slice(0, 10),
    candidates.filter((file) => isSourceFile(file.path) && !isTestFile(file.path)).sort((a, b) => b.size - a.size),
  ];

  const picked: string[] = [];
  const seen = new Set<string>();
  let budget = MAX_CONTENT_CHARS;
  for (const group of groups) {
    for (const file of group) {
      if (picked.length >= MAX_FILES_READ) return picked;
      if (seen.has(file.path)) continue;
      const cost = Math.min(file.size, MAX_FILE_CHARS);
      if (cost > budget) continue;
      seen.add(file.path);
      picked.push(file.path);
      budget -= cost;
    }
  }
  return picked;
}

function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

async function readFile(ref: RepoRef, branch: string, path: string, opts: GithubOptions): Promise<FileContent | null> {
  // Public repos are read from raw.githubusercontent.com, which doesn't count against the API rate limit.
  const res = opts.token
    ? await request(
        `${API}/repos/${ref.owner}/${ref.repo}/contents/${encodePath(path)}?ref=${encodeURIComponent(branch)}`,
        { headers: apiHeaders(opts.token, "application/vnd.github.raw+json") },
        opts,
      )
    : await request(
        `https://raw.githubusercontent.com/${ref.owner}/${ref.repo}/${encodePath(branch)}/${encodePath(path)}`,
        { headers: { "User-Agent": "stackshift" } },
        opts,
      );
  if (!res.ok) return null;
  const raw = await res.text();
  if (raw.includes("\u0000")) return null;
  const truncated = raw.length > MAX_FILE_CHARS;
  return {
    path,
    text: truncated ? raw.slice(0, MAX_FILE_CHARS) : raw,
    lines: raw.length === 0 ? 0 : raw.split("\n").length,
    truncated,
  };
}

async function mapWithLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

/** Reads a repository from GitHub: metadata, languages, the full file tree and the most useful files. */
export async function fetchRepoSnapshot(ref: RepoRef, opts: GithubOptions = {}): Promise<RepoSnapshot> {
  const base = `/repos/${ref.owner}/${ref.repo}`;
  const meta = await getJson<RepoMeta>(base, opts);
  const branch = meta.default_branch;
  const [languages, tree] = await Promise.all([
    getJson<Record<string, number>>(`${base}/languages`, opts),
    getJson<TreeResponse>(`${base}/git/trees/${encodeURIComponent(branch)}?recursive=1`, opts),
  ]);

  const files = tree.tree
    .filter((entry) => entry.type === "blob")
    .map((entry) => ({ path: entry.path, size: entry.size ?? 0 }));
  if (files.length === 0) throw new RepoError("This repository has no files to analyze.");

  const contents = await mapWithLimit(selectFilesToRead(files), 8, (path) => readFile(ref, branch, path, opts));
  const license = meta.license
    ? meta.license.spdx_id && meta.license.spdx_id !== "NOASSERTION"
      ? meta.license.spdx_id
      : meta.license.name
    : null;

  return {
    ref,
    url: meta.html_url,
    defaultBranch: branch,
    description: meta.description,
    stars: meta.stargazers_count,
    license,
    pushedAt: meta.pushed_at,
    isPrivate: meta.private,
    languages,
    files,
    treeTruncated: tree.truncated,
    contents: contents.filter((file): file is FileContent => file !== null),
  };
}

function folderOverview(paths: string[]): string[] {
  const counts = new Map<string, number>();
  for (const path of paths) {
    const parts = path.split("/");
    const folder = parts.length === 1 ? "(root)" : parts.slice(0, Math.min(2, parts.length - 1)).join("/") + "/";
    counts.set(folder, (counts.get(folder) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 40)
    .map(([folder, count]) => `- ${folder}: ${count} file${count === 1 ? "" : "s"}`);
}

/**
 * The repository as one block of text for the AI steps. It is the same for every step,
 * so it can be cached between them.
 */
export function buildSnapshotText(snapshot: RepoSnapshot, facts: RepoFacts): string {
  const paths = snapshot.files.map((file) => file.path).filter((path) => !isIgnoredPath(path));
  const listed = paths.slice(0, MAX_TREE_PATHS);
  const technologies = facts.technologies.length
    ? facts.technologies
        .map((tech) => `- ${tech.name}${tech.version ? ` ${tech.version}` : ""} (in ${tech.source})`)
        .join("\n")
    : "- None of the frameworks StackShift recognizes were found in the manifests.";

  const lines = [
    `# Repository snapshot: ${facts.owner}/${facts.name}`,
    "",
    `URL: ${facts.url} (default branch: ${facts.defaultBranch})`,
    `Description: ${facts.description ?? "none"}`,
    `Stars: ${facts.stars} · License: ${facts.license ?? "none"} · Last push: ${facts.pushedAt?.slice(0, 10) ?? "unknown"}`,
    "",
    "## Measured facts (computed by code from the repository)",
    `- Files: ${facts.totalFiles} (source files: ${facts.sourceFiles}, of which tests: ${facts.testFiles})`,
    `- Estimated lines of source code: about ${facts.estimatedLines.toLocaleString("en-US")} (estimated from file sizes)`,
    `- Languages reported by GitHub: ${facts.languages.map((lang) => `${lang.name} ${lang.percent}%`).join(", ") || "none"}`,
    `- Manifests: ${facts.manifests.join(", ") || "none found"}`,
    "",
    "## Technologies detected in manifests (versions exactly as written)",
    technologies,
    "",
    "## Folder overview",
    ...folderOverview(paths),
    "",
    "## File tree",
    listed.length < paths.length || snapshot.treeTruncated
      ? `Showing ${listed.length} of ${paths.length}${snapshot.treeTruncated ? "+" : ""} files. Folders such as node_modules and build output are not listed.`
      : `All ${paths.length} files. Folders such as node_modules and build output are not listed.`,
    ...listed,
    "",
    "## File contents",
    `These ${snapshot.contents.length} files were read. No other file contents were read.`,
    "",
  ];

  for (const file of snapshot.contents) {
    const note = file.truncated ? ` truncated="true" note="only the first ${MAX_FILE_CHARS} characters are shown"` : "";
    lines.push(`<file path="${file.path}" lines="${file.lines}"${note}>`, file.text, "</file>", "");
  }
  return lines.join("\n");
}
