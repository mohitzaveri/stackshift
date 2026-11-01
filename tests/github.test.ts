import { describe, expect, it } from "vitest";
import { computeFacts } from "../lib/detect";
import { RepoError } from "../lib/errors";
import {
  MAX_FILES_READ,
  buildSnapshotText,
  fetchRepoSnapshot,
  parseRepoUrl,
  selectFilesToRead,
} from "../lib/github";
import { fakeFetch, reactApp, repoRoutes } from "./fixtures";

describe("parseRepoUrl", () => {
  it.each([
    ["https://github.com/vercel/next.js", "vercel", "next.js"],
    ["https://github.com/vercel/next.js/", "vercel", "next.js"],
    ["https://github.com/vercel/next.js.git", "vercel", "next.js"],
    ["http://www.github.com/vercel/next.js/tree/canary/packages", "vercel", "next.js"],
    ["github.com/vercel/next.js", "vercel", "next.js"],
    ["vercel/next.js", "vercel", "next.js"],
    ["git@github.com:vercel/next.js.git", "vercel", "next.js"],
    ["  https://github.com/mtrishal123/food-ordering-app  ", "mtrishal123", "food-ordering-app"],
  ])("parses %s", (input, owner, repo) => {
    expect(parseRepoUrl(input)).toEqual({ owner, repo });
  });

  it.each([
    "",
    "https://gitlab.com/owner/repo",
    "https://github.com/onlyowner",
    "not a url",
    "https://github.com/-bad/repo",
    "ftp://github.com/owner/repo",
    "https://github.com/owner/..",
  ])("rejects %j", (input) => {
    expect(parseRepoUrl(input)).toBeNull();
  });
});

describe("selectFilesToRead", () => {
  it("reads the README, manifests, config and entry points first, and skips junk", () => {
    const files = [
      { path: "README.md", size: 2000 },
      { path: "package.json", size: 800 },
      { path: "package-lock.json", size: 3000 },
      { path: "node_modules/react/index.js", size: 500 },
      { path: "public/logo.png", size: 4000 },
      { path: "src/index.js", size: 300 },
      { path: "src/App.jsx", size: 5000 },
      { path: "src/components/Big.jsx", size: 9000 },
      { path: "src/App.test.js", size: 700 },
      { path: "dist/bundle.js", size: 90_000 },
      { path: "vite.config.js", size: 200 },
      { path: "src/huge.js", size: 500_000 },
    ];
    expect(selectFilesToRead(files)).toEqual([
      "README.md",
      "package.json",
      "vite.config.js",
      "src/App.jsx",
      "src/index.js",
      "src/components/Big.jsx",
    ]);
  });

  it("stops at the file limit", () => {
    const files = Array.from({ length: 100 }, (_, i) => ({ path: `src/module${i}.ts`, size: 100 }));
    expect(selectFilesToRead(files)).toHaveLength(MAX_FILES_READ);
  });
});

describe("fetchRepoSnapshot", () => {
  it("reads the real manifests and measures the repository", async () => {
    const github = fakeFetch(repoRoutes(reactApp));
    const snapshot = await fetchRepoSnapshot({ owner: "acme", repo: "food-app" }, { fetchImpl: github.fetch });

    expect(snapshot.defaultBranch).toBe("main");
    expect(snapshot.license).toBe("MIT");
    expect(snapshot.contents.map((file) => file.path)).toContain("package.json");
    expect(snapshot.contents.map((file) => file.path)).not.toContain("node_modules/react/index.js");

    const facts = computeFacts(snapshot);
    const names = facts.technologies.map((tech) => `${tech.name} ${tech.version ?? ""}`.trim());
    expect(names).toEqual(
      expect.arrayContaining(["React ^19.2.1", "React Router ^7.10.1", "Create React App (react-scripts) 5.0.1", "npm"]),
    );
    expect(names.some((name) => name.startsWith("Material UI"))).toBe(false);
    expect(facts.totalFiles).toBe(8); // node_modules is not counted
    expect(facts.testFiles).toBe(1);

    const text = buildSnapshotText(snapshot, facts);
    expect(text).toContain('<file path="package.json"');
    expect(text).toContain("react-scripts");
    expect(text).toContain("Create React App (react-scripts) 5.0.1 (in package.json)");
  });

  it("reads files through the API with the token when one is set", async () => {
    const routes = repoRoutes(reactApp);
    const api = "https://api.github.com/repos/acme/food-app/contents";
    routes[`${api}/package.json?ref=main`] = { body: "{}" };
    const github = fakeFetch(routes);
    await fetchRepoSnapshot({ owner: "acme", repo: "food-app" }, { fetchImpl: github.fetch, token: "secret" });

    const fileRequest = github.requests.find((r) => r.url === `${api}/package.json?ref=main`);
    expect(fileRequest?.headers.get("authorization")).toBe("Bearer secret");
    expect(github.requests.some((r) => r.url.startsWith("https://raw.githubusercontent.com"))).toBe(false);
  });

  it("explains a missing repository", async () => {
    const github = fakeFetch({});
    await expect(fetchRepoSnapshot({ owner: "acme", repo: "nope" }, { fetchImpl: github.fetch })).rejects.toThrow(
      /Repository not found/,
    );
  });

  it("explains GitHub's anonymous rate limit", async () => {
    const github = fakeFetch({
      "https://api.github.com/repos/acme/food-app": {
        status: 403,
        body: { message: "API rate limit exceeded" },
        headers: { "x-ratelimit-remaining": "0" },
      },
    });
    const error = await fetchRepoSnapshot({ owner: "acme", repo: "food-app" }, { fetchImpl: github.fetch }).catch(
      (err: unknown) => err,
    );
    expect(error).toBeInstanceOf(RepoError);
    expect((error as Error).message).toMatch(/60 anonymous requests per hour/);
  });

  it("explains an empty repository", async () => {
    const routes = repoRoutes(reactApp);
    routes["https://api.github.com/repos/acme/food-app/git/trees/main?recursive=1"] = {
      status: 409,
      body: { message: "Git Repository is empty." },
    };
    await expect(
      fetchRepoSnapshot({ owner: "acme", repo: "food-app" }, { fetchImpl: fakeFetch(routes).fetch }),
    ).rejects.toThrow(/empty/);
  });

  it("turns network failures into a readable error", async () => {
    const failing = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    await expect(fetchRepoSnapshot({ owner: "acme", repo: "food-app" }, { fetchImpl: failing })).rejects.toThrow(
      /Couldn't reach GitHub/,
    );
  });
});
