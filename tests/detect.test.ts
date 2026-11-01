import { describe, expect, it } from "vitest";
import {
  computeFacts,
  describeTechnology,
  detectTechnologies,
  isIgnoredPath,
  isLowValuePath,
  isSourceFile,
  isTestFile,
  parsePnpmCatalogs,
} from "../lib/detect";
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
        dependencies: { vue: "^3.4.0", axios: "1.6.0", rxjs: "^7.8.2" },
        devDependencies: { vite: "^5.0.0", typescript: "~5.3.0", "flow-bin": "^0.317.0" },
        engines: { node: ">=20" },
      }),
    );
    expect(names([pkg])).toEqual(
      expect.arrayContaining([
        ["Vue", "^3.4.0"],
        ["axios", "1.6.0"],
        ["RxJS", "^7.8.2"],
        ["Vite", "^5.0.0"],
        ["TypeScript", "~5.3.0"],
        ["Flow", "^0.317.0"],
        ["Node.js", ">=20"],
      ]),
    );
  });

  it("doesn't mistake built-in object properties for packages", () => {
    const pkg = file("package.json", JSON.stringify({ dependencies: { constructor: "1.0.0", toString: "2.0.0" } }));
    expect(names([pkg])).toEqual([]);
  });

  it("survives manifests that aren't objects", () => {
    expect(names([file("package.json", "null"), file("composer.json", "[]"), file("web/package.json", '"x"')])).toEqual([]);
  });

  it("resolves pnpm catalog versions", () => {
    const workspace = file(
      "pnpm-workspace.yaml",
      "packages:\n  - apps/*\ncatalog:\n  typescript: ^5.9.3\n  '@tanstack/react-query': ^5.0.0 # shared\ncatalogs:\n  react19:\n    react: 19.1.4\n",
    );
    const pkg = file(
      "apps/web/package.json",
      JSON.stringify({
        dependencies: { react: "catalog:react19", "@tanstack/react-query": "catalog:" },
        devDependencies: { typescript: "catalog:", vite: "catalog:missing" },
      }),
    );
    expect(parsePnpmCatalogs(workspace.text).get("react19")).toEqual({ react: "19.1.4" });
    expect(names([workspace, pkg])).toEqual(
      expect.arrayContaining([
        ["React", "19.1.4"],
        ["TanStack Query", "^5.0.0"],
        ["TypeScript", "^5.9.3"],
        ["Vite", "catalog:missing"],
      ]),
    );
  });

  it("lists each technology once, with how many files list it", () => {
    const manifests = ["apps/web", "apps/api", "packages/ui"].map((dir) =>
      file(`${dir}/package.json`, JSON.stringify({ devDependencies: { typescript: "^5.9.3" } })),
    );
    const [typescript] = detectTechnologies(manifests);
    expect(typescript).toEqual({ name: "TypeScript", version: "^5.9.3", source: "apps/web/package.json", count: 3 });
    expect(describeTechnology(typescript)).toBe("TypeScript ^5.9.3 (in apps/web/package.json and 2 other files)");
  });

  it("reads Python requirements, keeping version ranges", () => {
    const requirements = file(
      "requirements/prod.txt",
      "Django>=4.2,<5.0\ndjangorestframework>=3.14\n# comment\n-r base.txt\ncelery[redis]~=5.3\npsycopg2-binary==2.9.9\n",
    );
    expect(names([requirements])).toEqual([
      ["Django", ">=4.2,<5.0"],
      ["Django REST framework", ">=3.14"],
      ["Celery", "~=5.3"],
      ["PostgreSQL (psycopg2)", "2.9.9"],
    ]);
  });

  it("reads pyproject dependencies on one line or many, and Poetry tables", () => {
    expect(
      names([file("pyproject.toml", '[project]\nrequires-python = ">=3.11"\ndependencies = ["django>=5.0", "celery"]\n')]),
    ).toEqual(expect.arrayContaining([["Django", ">=5.0"], ["Celery", null], ["Python", ">=3.11"]]));
    expect(names([file("pyproject.toml", '[project]\ndependencies = [\n  "fastapi>=0.110",\n]\n')])).toEqual([
      ["FastAPI", ">=0.110"],
    ]);
    const poetry = file(
      "pyproject.toml",
      '[tool.poetry.dependencies]\npython = "^3.11"\nfastapi = "^0.110.0"\nsqlalchemy = { version = "^2.0", extras = ["asyncio"] }\n',
    );
    expect(names([poetry])).toEqual(
      expect.arrayContaining([["Python", "^3.11"], ["FastAPI", "^0.110.0"], ["SQLAlchemy", "^2.0"]]),
    );
  });

  it("reads Go, Ruby, Java, Rust and .NET manifests", () => {
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
    expect(
      names([
        file(
          "build.gradle",
          "implementation 'org.springframework.boot:spring-boot-starter-data-jpa'\nruntimeOnly 'com.h2database:h2'\n",
        ),
      ]),
    ).toEqual([
      ["Spring Boot", null],
      ["Spring Data JPA", null],
      ["H2 database", null],
    ]);
    expect(
      names([file("Cargo.toml", '[package]\nedition.workspace = true\n\n[dependencies]\ntokio = { workspace = true }\naxum = "0.7"\n')]),
    ).toEqual([
      ["Tokio", null],
      ["Axum", "0.7"],
    ]);
    expect(names([file("Api.csproj", '<Project Sdk="Microsoft.NET.Sdk.Web"><TargetFramework>net8.0</TargetFramework>')])).toEqual([
      [".NET", "net8.0"],
      ["ASP.NET Core", null],
    ]);
  });

  it("ignores dev-container Dockerfiles and unresolved base images", () => {
    expect(
      names([
        file(".devcontainer/Dockerfile", "FROM mcr.microsoft.com/vscode/devcontainers/java:0-${VARIANT}"),
        file("Dockerfile", "FROM node:20-alpine"),
      ]),
    ).toEqual([["Docker", "base image node:20-alpine"]]);
    expect(names([file("Dockerfile", "ARG V\nFROM python:${V}-slim")])).toEqual([["Docker", null]]);
  });

  it("finds package managers and tooling from files in the tree, skipping fixtures", () => {
    const paths = [
      "yarn.lock",
      "fixtures/app/yarn.lock",
      "node_modules/x/package-lock.json",
      "turbo.json",
      "packages/a/turbo.json",
      ".github/workflows/ci.yml",
      ".github/workflows/release.yml",
    ];
    expect(names([], paths)).toEqual([
      ["Yarn", null],
      ["Turborepo", null],
      ["GitHub Actions", null],
    ]);
  });

  it("doesn't repeat a tool found in a manifest just because its config file exists", () => {
    const pkg = file("package.json", JSON.stringify({ devDependencies: { turbo: "^2.5.8" } }));
    expect(names([pkg], ["package.json", "turbo.json"])).toEqual([["Turborepo", "^2.5.8"]]);
  });
});

describe("file classification", () => {
  it.each([
    ["src/App.test.tsx", true],
    ["tests/test_models.py", true],
    ["pkg/server_test.go", true],
    ["src/__tests__/cart.js", true],
    ["blog/tests.py", true],
    ["conftest.py", true],
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

  it("knows which folders hold tests, fixtures and examples", () => {
    expect(isLowValuePath("fixtures/ssr/package.json")).toBe(true);
    expect(isLowValuePath("examples/todo/src/main.js")).toBe(true);
    expect(isLowValuePath(".devcontainer/Dockerfile")).toBe(true);
    expect(isLowValuePath("packages/react/package.json")).toBe(false);
  });
});

function snapshot(overrides: Partial<RepoSnapshot>): RepoSnapshot {
  return {
    ref: { owner: "acme", repo: "app" },
    url: "https://github.com/acme/app",
    branch: "main",
    path: null,
    description: null,
    stars: 0,
    license: null,
    pushedAt: null,
    isPrivate: false,
    languages: {},
    files: [],
    treeTruncated: false,
    contents: [],
    ...overrides,
  };
}

describe("computeFacts", () => {
  it("estimates lines of code from the files it read, leaving out huge and generated files", () => {
    const source = Array.from({ length: 100 }, (_, i) => `const value${i} = ${i};`).join("\n");
    const bytes = new TextEncoder().encode(source).length;
    const facts = computeFacts(
      snapshot({
        languages: { TypeScript: 7500, CSS: 2500, Shell: 1 },
        files: [
          { path: "src/a.ts", size: bytes },
          { path: "src/b.ts", size: bytes * 3 },
          { path: "static/app.css", size: 300_000 },
          { path: "api/user.pb.go", size: 5000 },
          { path: "node_modules/x/index.js", size: 1_000_000 },
          { path: "README.md", size: 100 },
        ],
        contents: [file("src/a.ts", source)],
      }),
    );
    expect(facts.totalFiles).toBe(5);
    expect(facts.sourceFiles).toBe(4);
    expect(facts.estimatedLines).toBe(400);
    expect(facts.linesExcludedFiles).toBe(2);
    // Shell's share rounds to 0%, so it's left out.
    expect(facts.languages).toEqual([
      { name: "TypeScript", percent: 75 },
      { name: "CSS", percent: 25 },
    ]);
  });

  it("measures a folder's languages from its own files", () => {
    const facts = computeFacts(
      snapshot({
        path: "apps/web",
        languages: { Go: 1_000_000 },
        files: [
          { path: "apps/web/a.ts", size: 300 },
          { path: "apps/web/b.css", size: 100 },
        ],
      }),
    );
    expect(facts.path).toBe("apps/web");
    expect(facts.languages).toEqual([
      { name: "TypeScript", percent: 75 },
      { name: "CSS", percent: 25 },
    ]);
  });

  it("lists the product's manifests before fixtures, and counts them all", () => {
    const facts = computeFacts(
      snapshot({
        files: [
          { path: "fixtures/a/package.json", size: 10 },
          { path: "packages/react/package.json", size: 10 },
          { path: "package.json", size: 10 },
        ],
      }),
    );
    expect(facts.manifests).toEqual(["package.json", "packages/react/package.json", "fixtures/a/package.json"]);
    expect(facts.manifestCount).toBe(3);
  });
});
