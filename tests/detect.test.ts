import { describe, expect, it } from "vitest";
import { computeFacts, detectTechnologies, isIgnoredPath, isSourceFile, isTestFile } from "../lib/detect";
import type { FileContent, RepoSnapshot } from "../lib/types";

function file(path: string, text: string): FileContent {
  return { path, text, lines: text.split("\n").length, truncated: false };
}

function names(contents: FileContent[], paths: string[] = []) {
  return detectTechnologies(contents, paths).map((tech) => [tech.name, tech.version ?? null]);
}

describe("detectTechnologies", () => {
  it("reads JavaScript manifests and keeps versions as written", () => {
    const pkg = file(
      "client/package.json",
      JSON.stringify({
        dependencies: { vue: "^3.4.0", axios: "1.6.0" },
        devDependencies: { vite: "^5.0.0", typescript: "~5.3.0" },
        engines: { node: ">=20" },
      }),
    );
    expect(names([pkg])).toEqual(
      expect.arrayContaining([
        ["Vue", "^3.4.0"],
        ["axios", "1.6.0"],
        ["Vite", "^5.0.0"],
        ["TypeScript", "~5.3.0"],
        ["Node.js", ">=20"],
      ]),
    );
  });

  it("doesn't mistake built-in object properties for packages", () => {
    const pkg = file("package.json", JSON.stringify({ dependencies: { constructor: "1.0.0", toString: "2.0.0" } }));
    expect(names([pkg])).toEqual([]);
  });

  it("reads Python requirements and pyproject files", () => {
    expect(names([file("requirements.txt", "Django==4.2.7\ndjangorestframework>=3.14\n# comment\ncelery[redis]~=5.3\n")])).toEqual([
      ["Django", "4.2.7"],
      ["Django REST framework", "3.14"],
      ["Celery", "5.3"],
    ]);
    expect(
      names([file("pyproject.toml", '[project]\nrequires-python = ">=3.11"\ndependencies = [\n  "fastapi>=0.110",\n]\n')]),
    ).toEqual(expect.arrayContaining([["FastAPI", "0.110"], ["Python", ">=3.11"]]));
  });

  it("reads Go, Ruby, Java and .NET manifests", () => {
    expect(names([file("go.mod", "module x\n\ngo 1.22\n\nrequire github.com/gin-gonic/gin v1.9.1\n")])).toEqual([
      ["Go", "1.22"],
      ["Gin", "v1.9.1"],
    ]);
    expect(names([file("Gemfile", "ruby '3.2.2'\ngem 'rails', '~> 7.1'\n")])).toEqual(
      expect.arrayContaining([["Ruby on Rails", "~> 7.1"], ["Ruby", "3.2.2"]]),
    );
    expect(
      names([
        file(
          "pom.xml",
          "<parent><artifactId>spring-boot-starter-parent</artifactId><version>3.2.1</version></parent><java.version>17</java.version>",
        ),
      ]),
    ).toEqual([
      ["Spring Boot", "3.2.1"],
      ["Java", "17"],
    ]);
    expect(names([file("Api.csproj", '<Project Sdk="Microsoft.NET.Sdk.Web"><TargetFramework>net8.0</TargetFramework>')])).toEqual([
      [".NET", "net8.0"],
      ["ASP.NET Core", null],
    ]);
  });

  it("detects package managers from lockfiles", () => {
    expect(names([], ["yarn.lock", "node_modules/x/package-lock.json"])).toEqual([["Yarn", null]]);
  });
});

describe("file classification", () => {
  it.each([
    ["src/App.test.tsx", true],
    ["tests/test_models.py", true],
    ["pkg/server_test.go", true],
    ["src/__tests__/cart.js", true],
    ["src/App.tsx", false],
    ["src/latest.js", false],
  ])("isTestFile(%s) is %s", (path, expected) => {
    expect(isTestFile(path)).toBe(expected);
  });

  it("ignores dependency and build folders, and minified files", () => {
    expect(isIgnoredPath("node_modules/react/index.js")).toBe(true);
    expect(isIgnoredPath("web/dist/app.js")).toBe(true);
    expect(isIgnoredPath("static/app.min.js")).toBe(true);
    expect(isIgnoredPath("src/build.js")).toBe(false);
    expect(isSourceFile("src/main.rs")).toBe(true);
    expect(isSourceFile("data.json")).toBe(false);
  });
});

describe("computeFacts", () => {
  it("estimates lines of code from the files it read", () => {
    const source = Array.from({ length: 100 }, (_, i) => `const value${i} = ${i};`).join("\n");
    const snapshot: RepoSnapshot = {
      ref: { owner: "acme", repo: "app" },
      url: "https://github.com/acme/app",
      defaultBranch: "main",
      description: null,
      stars: 0,
      license: null,
      pushedAt: null,
      isPrivate: false,
      languages: { TypeScript: 750, CSS: 250 },
      files: [
        { path: "src/a.ts", size: new TextEncoder().encode(source).length },
        { path: "src/b.ts", size: new TextEncoder().encode(source).length * 3 },
        { path: "node_modules/x/index.js", size: 1_000_000 },
        { path: "README.md", size: 100 },
      ],
      treeTruncated: false,
      contents: [file("src/a.ts", source)],
    };
    const facts = computeFacts(snapshot);
    expect(facts.totalFiles).toBe(3);
    expect(facts.sourceFiles).toBe(2);
    expect(facts.estimatedLines).toBe(400);
    expect(facts.languages).toEqual([
      { name: "TypeScript", percent: 75 },
      { name: "CSS", percent: 25 },
    ]);
  });
});
