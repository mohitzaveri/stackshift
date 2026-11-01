import type { FileContent, RepoFacts, RepoSnapshot, Technology } from "./types";

/** Average bytes per line of source code, used when too few files were read to measure it. */
const DEFAULT_BYTES_PER_LINE = 32;

const SOURCE_LANGUAGES: Record<string, string> = {
  ts: "TypeScript", tsx: "TypeScript", mts: "TypeScript", cts: "TypeScript",
  js: "JavaScript", jsx: "JavaScript", mjs: "JavaScript", cjs: "JavaScript",
  vue: "Vue", svelte: "Svelte", astro: "Astro",
  py: "Python", rb: "Ruby", go: "Go", rs: "Rust", java: "Java", kt: "Kotlin", kts: "Kotlin",
  scala: "Scala", groovy: "Groovy", swift: "Swift", m: "Objective-C", mm: "Objective-C",
  c: "C", h: "C", cpp: "C++", cc: "C++", cxx: "C++", hpp: "C++",
  cs: "C#", fs: "F#", vb: "Visual Basic", php: "PHP", dart: "Dart",
  ex: "Elixir", exs: "Elixir", erl: "Erlang", clj: "Clojure", elm: "Elm", lua: "Lua",
  r: "R", jl: "Julia", sql: "SQL", sh: "Shell", bash: "Shell", ps1: "PowerShell",
  html: "HTML", htm: "HTML", css: "CSS", scss: "SCSS", sass: "Sass", less: "Less",
};

const IGNORED_DIRS = new Set([
  "node_modules", ".git", "dist", "build", "out", ".next", ".nuxt", ".svelte-kit", "vendor",
  "coverage", "__pycache__", ".venv", "venv", "env", "target", "bin", "obj", ".idea", ".vscode",
  "Pods", ".gradle", ".cache", ".turbo", ".parcel-cache", "bower_components", "site-packages",
]);

const BINARY_EXTENSIONS = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "avif", "ico", "bmp", "tiff", "psd", "svg",
  "mp3", "mp4", "mov", "avi", "webm", "wav", "ogg", "flac",
  "woff", "woff2", "ttf", "otf", "eot", "pdf", "zip", "gz", "tgz", "tar", "rar", "7z",
  "jar", "war", "class", "exe", "dll", "so", "dylib", "a", "o", "bin", "wasm", "pyc",
  "db", "sqlite", "sqlite3", "lockb",
]);

const LOCKFILES: Record<string, string> = {
  "package-lock.json": "npm",
  "npm-shrinkwrap.json": "npm",
  "yarn.lock": "Yarn",
  "pnpm-lock.yaml": "pnpm",
  "bun.lock": "Bun",
  "bun.lockb": "Bun",
  "poetry.lock": "Poetry",
  "Pipfile.lock": "Pipenv",
  "uv.lock": "uv",
  "Cargo.lock": "Cargo",
  "Gemfile.lock": "Bundler",
  "composer.lock": "Composer",
  "go.sum": "Go modules",
};

const MANIFEST_NAMES = new Set([
  "package.json", "pyproject.toml", "Pipfile", "setup.py", "setup.cfg", "go.mod", "Cargo.toml",
  "pom.xml", "build.gradle", "build.gradle.kts", "settings.gradle", "settings.gradle.kts",
  "Gemfile", "composer.json", "pubspec.yaml", "mix.exs", "Package.swift", "deno.json",
]);

const CONFIG_PATTERNS = [
  /^tsconfig(\..+)?\.json$/,
  /^(vite|next|nuxt|svelte|astro|webpack|rollup|tailwind|postcss|babel|jest|vitest|playwright|remix|metro)\.config\.[a-z]+$/,
  /^(angular|app|vercel|nest-cli)\.json$/,
  /^\.babelrc$/,
  /^dockerfile$/i,
  /^(docker-)?compose\.ya?ml$/,
  /^procfile$/i,
  /^\.(nvmrc|node-version|python-version|ruby-version|tool-versions)$/,
  /^runtime\.txt$/,
  /^(netlify\.toml|render\.yaml|fly\.toml|app\.yaml|serverless\.yml)$/,
  /^manage\.py$/,
  /^\.env\.example$/,
];

const ENTRY_POINT_NAMES = new Set([
  "index", "main", "app", "server", "application", "program", "startup", "routes", "router",
  "urls", "settings", "wsgi", "asgi", "_app", "layout", "page", "manage", "store",
]);

/** Own-property lookup, so names like "constructor" don't match Object.prototype. */
function lookup<T>(map: Record<string, T>, key: string): T | undefined {
  return Object.hasOwn(map, key) ? map[key] : undefined;
}

export function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

export function extension(path: string): string {
  const base = basename(path);
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
}

export function depth(path: string): number {
  return path.split("/").length - 1;
}

export function isIgnoredPath(path: string): boolean {
  if (/\.min\.(js|css)$/.test(path) || path.endsWith(".map")) return true;
  return path.split("/").slice(0, -1).some((segment) => IGNORED_DIRS.has(segment));
}

export function isBinary(path: string): boolean {
  return BINARY_EXTENSIONS.has(extension(path));
}

export function isLockfile(path: string): boolean {
  return lookup(LOCKFILES, basename(path)) !== undefined;
}

export function isSourceFile(path: string): boolean {
  return lookup(SOURCE_LANGUAGES, extension(path)) !== undefined && !isIgnoredPath(path);
}

export function isTestFile(path: string): boolean {
  const name = basename(path);
  return (
    /(^|\/)(tests?|__tests__|spec|e2e)\//i.test(path) ||
    /\.(test|spec)\.[a-z]+$/i.test(name) ||
    /_test\.(go|py)$/.test(name) ||
    /^test_.+\.py$/.test(name)
  );
}

export function isManifest(path: string): boolean {
  const name = basename(path);
  return MANIFEST_NAMES.has(name) || /^requirements.*\.txt$/.test(name) || /\.(cs|fs)proj$/.test(name);
}

export function isConfigFile(path: string): boolean {
  const name = basename(path);
  return CONFIG_PATTERNS.some((pattern) => pattern.test(name)) || /^\.github\/workflows\/[^/]+\.ya?ml$/.test(path);
}

export function isEntryPoint(path: string): boolean {
  const name = basename(path);
  const stem = name.includes(".") ? name.slice(0, name.indexOf(".")) : name;
  return ENTRY_POINT_NAMES.has(stem.toLowerCase());
}

export function languageOf(path: string): string | undefined {
  return lookup(SOURCE_LANGUAGES, extension(path));
}

// --- Technology detection -------------------------------------------------

const JS_PACKAGES: Record<string, string> = {
  react: "React", "react-dom": "React DOM", next: "Next.js", vue: "Vue", nuxt: "Nuxt",
  "@angular/core": "Angular", svelte: "Svelte", "@sveltejs/kit": "SvelteKit", "solid-js": "SolidJS",
  "react-native": "React Native", expo: "Expo", electron: "Electron", gatsby: "Gatsby",
  "@remix-run/react": "Remix", astro: "Astro", "react-scripts": "Create React App (react-scripts)",
  express: "Express", koa: "Koa", fastify: "Fastify", "@nestjs/core": "NestJS", hono: "Hono",
  vite: "Vite", webpack: "webpack", parcel: "Parcel", typescript: "TypeScript",
  tailwindcss: "Tailwind CSS", "@mui/material": "Material UI", bootstrap: "Bootstrap",
  "styled-components": "styled-components", "@emotion/react": "Emotion", sass: "Sass",
  redux: "Redux", "@reduxjs/toolkit": "Redux Toolkit", zustand: "Zustand", mobx: "MobX",
  "react-router-dom": "React Router", "react-router": "React Router", "vue-router": "Vue Router",
  "@tanstack/react-query": "TanStack Query", axios: "axios", graphql: "GraphQL",
  "@apollo/client": "Apollo Client", prisma: "Prisma", "@prisma/client": "Prisma Client",
  mongoose: "Mongoose", sequelize: "Sequelize", typeorm: "TypeORM", "drizzle-orm": "Drizzle ORM",
  jest: "Jest", vitest: "Vitest", mocha: "Mocha", cypress: "Cypress", "@playwright/test": "Playwright",
  "@testing-library/react": "React Testing Library", storybook: "Storybook", eslint: "ESLint",
  jquery: "jQuery", "socket.io": "Socket.IO", firebase: "Firebase",
  "@supabase/supabase-js": "Supabase", stripe: "Stripe",
};

const PYTHON_PACKAGES: Record<string, string> = {
  django: "Django", flask: "Flask", fastapi: "FastAPI", starlette: "Starlette",
  sqlalchemy: "SQLAlchemy", pydantic: "Pydantic", celery: "Celery", pandas: "pandas",
  numpy: "NumPy", "scikit-learn": "scikit-learn", torch: "PyTorch", tensorflow: "TensorFlow",
  pytest: "pytest", streamlit: "Streamlit", langchain: "LangChain", uvicorn: "Uvicorn",
  gunicorn: "Gunicorn", alembic: "Alembic", djangorestframework: "Django REST framework",
  requests: "Requests", jupyter: "Jupyter",
};

const GO_MODULES: Record<string, string> = {
  "github.com/gin-gonic/gin": "Gin", "github.com/labstack/echo": "Echo",
  "github.com/gofiber/fiber": "Fiber", "github.com/go-chi/chi": "chi", "gorm.io/gorm": "GORM",
  "github.com/gorilla/mux": "Gorilla Mux",
};

const RUST_CRATES: Record<string, string> = {
  axum: "Axum", "actix-web": "Actix Web", rocket: "Rocket", tokio: "Tokio", warp: "warp",
  diesel: "Diesel", sqlx: "SQLx", tauri: "Tauri", bevy: "Bevy",
};

function fromPackageJson(file: FileContent, out: Technology[]) {
  let pkg: Record<string, unknown>;
  try {
    pkg = JSON.parse(file.text);
  } catch {
    return;
  }
  const deps: Record<string, string> = {
    ...(pkg.peerDependencies as Record<string, string> | undefined),
    ...(pkg.devDependencies as Record<string, string> | undefined),
    ...(pkg.dependencies as Record<string, string> | undefined),
  };
  for (const [name, version] of Object.entries(deps)) {
    const display = lookup(JS_PACKAGES, name);
    if (display) out.push({ name: display, version: String(version), source: file.path });
  }
  const engines = pkg.engines as Record<string, string> | undefined;
  if (engines?.node) out.push({ name: "Node.js", version: engines.node, source: file.path });
}

function fromPython(file: FileContent, out: Technology[]) {
  for (const line of file.text.split("\n")) {
    const match = line.match(/^\s*["']?([A-Za-z0-9_.-]+)(?:\[[^\]]*\])?\s*(?:==|>=|<=|~=|!=|>|<|=)?\s*["']?([^"',;#\s]*)/);
    if (!match) continue;
    const display = lookup(PYTHON_PACKAGES, match[1].toLowerCase());
    if (display) out.push({ name: display, version: match[2] || undefined, source: file.path });
  }
  const python = file.text.match(/(?:requires-python|python_requires|python_version)\s*=\s*["']([^"']+)["']/);
  if (python) out.push({ name: "Python", version: python[1], source: file.path });
}

function fromGoMod(file: FileContent, out: Technology[]) {
  const go = file.text.match(/^go\s+([0-9.]+)/m);
  if (go) out.push({ name: "Go", version: go[1], source: file.path });
  for (const [module, display] of Object.entries(GO_MODULES)) {
    const match = file.text.match(new RegExp(`${module.replace(/[.]/g, "\\.")}(?:/v\\d+)?\\s+(v[^\\s]+)`));
    if (match) out.push({ name: display, version: match[1], source: file.path });
  }
}

function fromCargo(file: FileContent, out: Technology[]) {
  const edition = file.text.match(/^edition\s*=\s*"([^"]+)"/m);
  if (edition) out.push({ name: "Rust", version: `edition ${edition[1]}`, source: file.path });
  for (const line of file.text.split("\n")) {
    const match = line.match(/^([a-z0-9_-]+)\s*=\s*(?:"([^"]+)"|\{.*?version\s*=\s*"([^"]+)")/);
    const display = match && lookup(RUST_CRATES, match[1]);
    if (display) out.push({ name: display, version: match[2] ?? match[3], source: file.path });
  }
}

function fromJvm(file: FileContent, out: Technology[]) {
  const text = file.text;
  if (/spring-boot/.test(text)) {
    const version =
      text.match(/spring-boot-starter-parent<\/artifactId>\s*<version>([^<]+)</)?.[1] ??
      text.match(/org\.springframework\.boot['"]?\)?\s*version\s*['"]([^'"]+)['"]/)?.[1];
    out.push({ name: "Spring Boot", version, source: file.path });
  }
  if (/quarkus/.test(text)) out.push({ name: "Quarkus", source: file.path });
  if (/micronaut/.test(text)) out.push({ name: "Micronaut", source: file.path });
  const java =
    text.match(/<java\.version>([^<]+)</)?.[1] ??
    text.match(/<maven\.compiler\.(?:source|release)>([^<]+)</)?.[1] ??
    text.match(/JavaLanguageVersion\.of\((\d+)\)/)?.[1] ??
    text.match(/sourceCompatibility\s*=\s*['"]?(?:JavaVersion\.VERSION_)?([0-9_.]+)/)?.[1]?.replace(/_/g, ".");
  if (java) out.push({ name: "Java", version: java, source: file.path });
  const kotlin = text.match(/kotlin\(["']jvm["']\)\s*version\s*["']([^"']+)["']/)?.[1];
  if (kotlin) out.push({ name: "Kotlin", version: kotlin, source: file.path });
}

function fromGemfile(file: FileContent, out: Technology[]) {
  for (const [gem, display] of [["rails", "Ruby on Rails"], ["sinatra", "Sinatra"]] as const) {
    const match = file.text.match(new RegExp(`gem\\s+['"]${gem}['"](?:\\s*,\\s*['"]([^'"]+)['"])?`));
    if (match) out.push({ name: display, version: match[1], source: file.path });
  }
  const ruby = file.text.match(/^ruby\s+['"]([^'"]+)['"]/m);
  if (ruby) out.push({ name: "Ruby", version: ruby[1], source: file.path });
}

function fromComposer(file: FileContent, out: Technology[]) {
  let pkg: { require?: Record<string, string> };
  try {
    pkg = JSON.parse(file.text);
  } catch {
    return;
  }
  const require = pkg.require ?? {};
  const known: Record<string, string> = {
    php: "PHP",
    "laravel/framework": "Laravel",
    "symfony/framework-bundle": "Symfony",
  };
  for (const [name, display] of Object.entries(known)) {
    if (require[name]) out.push({ name: display, version: require[name], source: file.path });
  }
}

function fromDotnet(file: FileContent, out: Technology[]) {
  const framework = file.text.match(/<TargetFrameworks?>([^<]+)</)?.[1];
  if (framework) out.push({ name: ".NET", version: framework, source: file.path });
  if (/Sdk="Microsoft\.NET\.Sdk\.Web"/.test(file.text)) out.push({ name: "ASP.NET Core", source: file.path });
}

function fromDockerfile(file: FileContent, out: Technology[]) {
  const image = file.text.match(/^FROM\s+(?:--platform=\S+\s+)?(\S+)/im)?.[1];
  out.push({ name: "Docker", version: image ? `base image ${image}` : undefined, source: file.path });
}

/** Finds frameworks and tools listed in the manifests that were read. Versions are copied as written. */
export function detectTechnologies(contents: FileContent[], allPaths: string[] = []): Technology[] {
  const found: Technology[] = [];
  for (const file of contents) {
    const name = basename(file.path);
    if (name === "package.json") fromPackageJson(file, found);
    else if (/^requirements.*\.txt$/.test(name) || ["pyproject.toml", "Pipfile", "setup.py", "setup.cfg"].includes(name)) fromPython(file, found);
    else if (name === "go.mod") fromGoMod(file, found);
    else if (name === "Cargo.toml") fromCargo(file, found);
    else if (name === "pom.xml" || name.startsWith("build.gradle")) fromJvm(file, found);
    else if (name === "Gemfile") fromGemfile(file, found);
    else if (name === "composer.json") fromComposer(file, found);
    else if (/\.(cs|fs)proj$/.test(name)) fromDotnet(file, found);
    else if (/^dockerfile$/i.test(name)) fromDockerfile(file, found);
  }
  for (const path of allPaths) {
    const manager = lookup(LOCKFILES, basename(path));
    if (manager && !isIgnoredPath(path) && depth(path) <= 2) found.push({ name: manager, version: undefined, source: path });
  }

  const seen = new Set<string>();
  return found.filter((tech) => {
    const key = `${tech.name}|${tech.version ?? ""}|${tech.source}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Measures the repository: file counts, estimated lines of code, languages and detected technologies. */
export function computeFacts(snapshot: RepoSnapshot): RepoFacts {
  const files = snapshot.files.filter((file) => !isIgnoredPath(file.path));
  const sources = files.filter((file) => isSourceFile(file.path));
  const sourceBytes = sources.reduce((sum, file) => sum + file.size, 0);

  // Measure bytes-per-line on the source files we actually read, then apply it to the whole repo.
  const encoder = new TextEncoder();
  const sampled = snapshot.contents.filter((file) => isSourceFile(file.path) && !file.truncated);
  const sampledLines = sampled.reduce((sum, file) => sum + file.lines, 0);
  const sampledBytes = sampled.reduce((sum, file) => sum + encoder.encode(file.text).length, 0);
  const bytesPerLine = sampledLines >= 50 ? sampledBytes / sampledLines : DEFAULT_BYTES_PER_LINE;

  const languageBytes = Object.values(snapshot.languages).reduce((sum, bytes) => sum + bytes, 0);
  const languages = Object.entries(snapshot.languages)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([name, bytes]) => ({ name, percent: languageBytes ? Math.round((bytes / languageBytes) * 1000) / 10 : 0 }));

  return {
    owner: snapshot.ref.owner,
    name: snapshot.ref.repo,
    url: snapshot.url,
    defaultBranch: snapshot.defaultBranch,
    description: snapshot.description,
    stars: snapshot.stars,
    license: snapshot.license,
    pushedAt: snapshot.pushedAt,
    totalFiles: files.length,
    sourceFiles: sources.length,
    testFiles: sources.filter((file) => isTestFile(file.path)).length,
    estimatedLines: Math.round(sourceBytes / bytesPerLine),
    languages,
    manifests: files
      .map((file) => file.path)
      .filter(isManifest)
      .sort((a, b) => depth(a) - depth(b) || a.localeCompare(b))
      .slice(0, 20),
    technologies: detectTechnologies(snapshot.contents, files.map((file) => file.path)),
    filesRead: snapshot.contents.length,
    treeTruncated: snapshot.treeTruncated,
  };
}
