import { RepoError, isAbortError } from "./errors";
import {
  LARGE_FILE_BYTES,
  depth,
  describeTechnology,
  isBinary,
  isConfigFile,
  isEntryPoint,
  isIgnoredPath,
  isLockfile,
  isLowValuePath,
  isManifest,
  isSourceFile,
  isTestFile,
  isWorkflowFile,
} from "./detect";
import type { FileContent, RepoFacts, RepoFile, RepoRef, RepoSnapshot } from "./types";

const API = "https://api.github.com";

/** Most files StackShift reads from one repository. */
export const MAX_FILES_READ = 40;
/** Most manifests read; the rest are still listed. */
const MAX_MANIFESTS_READ = 16;
/** Longest excerpt of a single file that goes into the prompt. */
export const MAX_FILE_CHARS = 24_000;
/** Total characters of file contents that go into the prompt (roughly 40K tokens). */
export const MAX_CONTENT_CHARS = 160_000;
/** Most paths listed in the snapshot's file tree. */
const MAX_TREE_PATHS = 600;

export interface GithubOptions {
  /** Raises the rate limit from 60 to 5,000 requests per hour, and can read private repositories. */
  token?: string;
  /** Read private repositories the token can access. Off by default, so a public server can't leak them. */
  allowPrivate?: boolean;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}

const OWNER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPO_PATTERN = /^[A-Za-z0-9._-]{1,100}$/;
/** Branch names and folder names from a /tree/ link: no control characters, quotes or backslashes. */
const SEGMENT_PATTERN = /^[^\u0000-\u001f"'<>\\]+$/;

function decodeSegment(segment: string): string | null {
  try {
    const decoded = decodeURIComponent(segment);
    return SEGMENT_PATTERN.test(decoded) && decoded !== "." && decoded !== ".." ? decoded : null;
  } catch {
    return null;
  }
}

/**
 * Accepts https://github.com/owner/repo (with or without .git or a trailing slash),
 * github.com/owner/repo, git@github.com:owner/repo.git and owner/repo. A link to a folder,
 * https://github.com/owner/repo/tree/<branch>/<folder>, limits the analysis to that folder.
 * Branch names that contain a slash aren't supported in folder links.
 */
export function parseRepoUrl(input: string): RepoRef | null {
  let value = input.trim();
  if (!value) return null;

  let parts: string[];
  const ssh = value.match(/^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?\/?$/i);
  if (ssh) {
    parts = [ssh[1], ssh[2]];
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
    parts = url.pathname.split("/").filter(Boolean);
  }

  const [owner, rawRepo, kind, ...scope] = parts;
  const repo = rawRepo?.replace(/\.git$/i, "");
  if (!owner || !repo || !OWNER_PATTERN.test(owner) || !REPO_PATTERN.test(repo)) return null;
  if (repo === "." || repo === "..") return null;
  if (kind !== "tree" || scope.length === 0) return { owner, repo };

  const decoded = scope.map(decodeSegment);
  if (decoded.some((segment) => segment === null)) return null;
  const [branch, ...folder] = decoded as string[];
  return folder.length ? { owner, repo, branch, path: folder.join("/") } : { owner, repo, branch };
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

/** The same message for a missing repository and a private one the server won't read, so neither can be told apart. */
function notFoundError(opts: GithubOptions): RepoError {
  if (!opts.token) {
    return new RepoError("Repository not found. Check the URL. Private repositories need a GITHUB_TOKEN and ALLOW_PRIVATE_REPOS=1 on the server.");
  }
  if (!opts.allowPrivate) {
    return new RepoError("Repository not found. Check the URL. Private repositories also need ALLOW_PRIVATE_REPOS=1 on the server.");
  }
  return new RepoError("Repository not found. Check the URL, and that the GITHUB_TOKEN can read it.");
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
      return notFoundError(opts);
    case 409:
      return new RepoError("This repository is empty, so there is nothing to analyze.");
    default:
      return new RepoError(`GitHub returned an error (${res.status}). Try again in a moment.`);
  }
}

async function getJson<T>(path: string, opts: GithubOptions, notFoundMessage?: string): Promise<T> {
  const res = await request(`${API}${path}`, { headers: apiHeaders(opts.token) }, opts);
  if (!res.ok) throw res.status === 404 && notFoundMessage ? new RepoError(notFoundMessage) : errorFor(res, opts);
  return (await res.json()) as T;
}

/**
 * Picks the files worth reading, most useful first: the README, manifests, config files, entry
 * points, then the largest source files, until the character budget is used. Tests, fixtures,
 * examples and docs come last, so on big repositories the product's own code is read first.
 * `scope` is the folder being analyzed, if any.
 */
export function selectFilesToRead(files: RepoFile[], scope?: string): string[] {
  const relative = (file: RepoFile) => (scope ? file.path.slice(scope.length + 1) : file.path);
  const candidates = files.filter(
    (file) =>
      file.size > 0 &&
      file.size <= LARGE_FILE_BYTES &&
      !isIgnoredPath(file.path) &&
      !isBinary(file.path) &&
      !isLockfile(file.path),
  );
  const main = candidates.filter((file) => !isLowValuePath(relative(file)));
  const byDepth = (a: RepoFile, b: RepoFile) => depth(relative(a)) - depth(relative(b)) || a.path.localeCompare(b.path);
  const bySize = (a: RepoFile, b: RepoFile) => b.size - a.size;
  const isSource = (file: RepoFile) => isSourceFile(file.path) && !isTestFile(relative(file));

  const manifests = main.filter((file) => isManifest(relative(file)) && depth(relative(file)) <= 3).sort(byDepth);
  const configs = main.filter((file) => isConfigFile(relative(file)) && depth(relative(file)) <= 2).sort(byDepth);
  const groups: RepoFile[][] = [
    candidates.filter((file) => /^readme(\.[a-z]+)?$/i.test(relative(file))),
    (manifests.length ? manifests : candidates.filter((file) => isManifest(relative(file))).sort(byDepth)).slice(
      0,
      MAX_MANIFESTS_READ,
    ),
    // CI workflows say how the project is built, but a couple is enough.
    [
      ...configs.filter((file) => !isWorkflowFile(relative(file))).slice(0, 8),
      ...configs.filter((file) => isWorkflowFile(relative(file))).slice(0, 2),
    ],
    main.filter((file) => isSource(file) && isEntryPoint(file.path) && depth(relative(file)) <= 4).sort(byDepth).slice(0, 10),
    main.filter(isSource).sort(bySize),
    candidates.filter((file) => isSource(file) && isLowValuePath(relative(file))).sort(bySize),
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

/**
 * Reads a repository (or one folder of it) from GitHub: metadata, languages, the file tree and
 * the most useful files.
 */
export async function fetchRepoSnapshot(ref: RepoRef, opts: GithubOptions = {}): Promise<RepoSnapshot> {
  const base = `/repos/${ref.owner}/${ref.repo}`;
  const meta = await getJson<RepoMeta>(base, opts);
  // A token can see private repositories. Unless the server allows it, refuse them with the same
  // message as a missing repository, so visitors can't read private code or probe for names.
  if (meta.private && !opts.allowPrivate) throw notFoundError(opts);

  const branch = ref.branch ?? meta.default_branch;
  const [languages, tree] = await Promise.all([
    getJson<Record<string, number>>(`${base}/languages`, opts),
    getJson<TreeResponse>(
      `${base}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
      opts,
      ref.branch
        ? `This repository has no branch called "${ref.branch}". (Links to branches with a slash in their name aren't supported yet.)`
        : undefined,
    ),
  ]);

  const allFiles = tree.tree
    .filter((entry) => entry.type === "blob")
    .map((entry) => ({ path: entry.path, size: entry.size ?? 0 }));
  let files = allFiles;
  const alsoRead: string[] = [];
  if (ref.path) {
    files = allFiles.filter((file) => file.path.startsWith(`${ref.path}/`));
    if (files.length === 0) throw new RepoError(`There's no folder called "${ref.path}" on the ${branch} branch.`);
    // A pnpm monorepo keeps shared versions ("catalog:") at its root, outside the folder.
    if (allFiles.some((file) => file.path === "pnpm-workspace.yaml")) alsoRead.push("pnpm-workspace.yaml");
  }
  if (files.length === 0) throw new RepoError("This repository has no files to analyze.");

  const toRead = [...alsoRead, ...selectFilesToRead(files, ref.path)];
  const contents = await mapWithLimit(toRead, 8, (path) => readFile(ref, branch, path, opts));
  const license = meta.license
    ? meta.license.spdx_id && meta.license.spdx_id !== "NOASSERTION"
      ? meta.license.spdx_id
      : meta.license.name
    : null;

  return {
    ref,
    url: ref.branch ? `${meta.html_url}/tree/${encodePath(branch)}${ref.path ? `/${encodePath(ref.path)}` : ""}` : meta.html_url,
    branch,
    path: ref.path ?? null,
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

/** Keeps file contents from closing the tags that mark where the repository data ends. */
function escapeTags(text: string): string {
  return text.replace(/<\/(file|repository_snapshot)>/gi, "<\\/$1>");
}

/**
 * The repository as one block of text for the AI steps. It is the same for every step,
 * so it can be cached between them.
 */
export function buildSnapshotText(snapshot: RepoSnapshot, facts: RepoFacts): string {
  const paths = snapshot.files.map((file) => file.path).filter((path) => !isIgnoredPath(path));
  const listed = paths.slice(0, MAX_TREE_PATHS);
  const technologies = facts.technologies.length
    ? facts.technologies.map((tech) => `- ${describeTechnology(tech)}`).join("\n")
    : "- None of the frameworks StackShift recognizes were found in the manifests.";
  const title = `${facts.owner}/${facts.name}${facts.path ? `/${facts.path}` : ""}`;
  const manifestNote =
    facts.manifestCount > facts.manifests.length ? ` (${facts.manifestCount} in total; the most important are listed)` : "";

  const lines = [
    "<repository_snapshot>",
    `# Repository snapshot: ${title}`,
    "",
    `URL: ${facts.url}`,
    facts.path
      ? `Scope: only the ${facts.path} folder, on the ${facts.branch} branch. Files outside this folder were not read.`
      : `Branch: ${facts.branch}`,
    `Description: ${facts.description ?? "none"}`,
    `Stars: ${facts.stars} · License: ${facts.license ?? "none"} · Last push: ${facts.pushedAt?.slice(0, 10) ?? "unknown"}`,
    "",
    "## Measured facts (computed by code from the repository)",
    `- Files: ${facts.totalFiles} (source files: ${facts.sourceFiles}, of which tests: ${facts.testFiles})`,
    `- Estimated lines of source code: about ${facts.estimatedLines.toLocaleString("en-US")} (estimated from file sizes${
      facts.linesExcludedFiles ? `; ${facts.linesExcludedFiles} very large or generated files are not counted` : ""
    })`,
    `- Languages ${facts.path ? "(by file size, in this folder)" : "(reported by GitHub)"}: ${
      facts.languages.map((lang) => `${lang.name} ${lang.percent}%`).join(", ") || "none"
    }`,
    `- Manifests${manifestNote}: ${facts.manifests.join(", ") || "none found"}`,
    "",
    "## Technologies detected in the manifests that were read (versions exactly as written)",
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
    lines.push(`<file path="${file.path.replace(/"/g, "&quot;")}" lines="${file.lines}"${note}>`, escapeTags(file.text), "</file>", "");
  }
  lines.push("</repository_snapshot>");
  return lines.join("\n");
}
