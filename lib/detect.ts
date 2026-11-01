import type { FileContent, RepoFacts, RepoFile, RepoSnapshot, Technology } from "./types";

/** Average bytes per line of source code, used when too few files were read to measure it. */
const DEFAULT_BYTES_PER_LINE = 32;
/** Files larger than this are never downloaded, and source files this large are left out of the line count. */
export const LARGE_FILE_BYTES = 200_000;

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

/** Folders that hold tests, fixtures, examples or docs rather than the product's own code. */
const LOW_VALUE_DIRS = new Set([
  "fixtures", "fixture", "examples", "example", "samples", "sample", "demo", "demos",
  "test", "tests", "__tests__", "__mocks__", "mocks", "e2e", "spec", "docs", "doc", "website",
  "benchmarks", "benchmark", "bench", "playground", ".devcontainer",
]);

const GENERATED_PATTERNS = [
  /\.bundle\.js$/, /\.generated\./, /\.pb\.go$/, /_pb2(_grpc)?\.py$/, /\.g\.dart$/, /\.freezed\.dart$/, /\.designer\.cs$/i,
];

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
  "package.json", "pnpm-workspace.yaml", "pyproject.toml", "Pipfile", "setup.py", "setup.cfg", "go.mod",
  "Cargo.toml", "pom.xml", "build.gradle", "build.gradle.kts", "settings.gradle", "settings.gradle.kts",
  "Gemfile", "composer.json", "pubspec.yaml", "mix.exs", "Package.swift", "deno.json",
]);

/** Files whose presence alone says something about the stack (checked at the top of the analyzed folder). */
const SIGNAL_FILES: Record<string, string> = {
  "turbo.json": "Turborepo",
  "nx.json": "Nx",
  "lerna.json": "Lerna",
  "pnpm-workspace.yaml": "pnpm workspaces",
  ".flowconfig": "Flow",
  "docker-compose.yml": "Docker Compose",
  "docker-compose.yaml": "Docker Compose",
  "compose.yml": "Docker Compose",
  "compose.yaml": "Docker Compose",
  "vercel.json": "Vercel",
  "netlify.toml": "Netlify",
  "render.yaml": "Render",
  "fly.toml": "Fly.io",
  Procfile: "Procfile (Heroku-style hosting)",
};

const CONFIG_PATTERNS = [
  /^tsconfig(\..+)?\.json$/,
  /^(vite|next|nuxt|svelte|astro|webpack|rollup|tailwind|postcss|babel|jest|vitest|playwright|remix|metro)\.config\.[a-z]+$/,
  /^(angular|app|vercel|nest-cli|turbo|nx)\.json$/,
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

/** The value if it's a plain object, otherwise an empty one (manifests can contain anything). */
function objectOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
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

function folders(path: string): string[] {
  return path.split("/").slice(0, -1);
}

export function isIgnoredPath(path: string): boolean {
  if (/\.min\.(js|css)$/.test(path) || path.endsWith(".map")) return true;
  return folders(path).some((segment) => IGNORED_DIRS.has(segment));
}

/** True for files inside test, fixture, example or docs folders. */
export function isLowValuePath(path: string): boolean {
  return folders(path).some((segment) => LOW_VALUE_DIRS.has(segment.toLowerCase()));
}

export function isGeneratedFile(path: string): boolean {
  return GENERATED_PATTERNS.some((pattern) => pattern.test(basename(path)));
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
    /^test_.+\.py$/.test(name) ||
    /^(tests?|conftest)\.py$/.test(name)
  );
}

export function isPythonRequirements(path: string): boolean {
  return /^requirements.*\.txt$/.test(basename(path)) || /(^|\/)requirements\/[^/]+\.txt$/.test(path);
}

export function isManifest(path: string): boolean {
  const name = basename(path);
  return MANIFEST_NAMES.has(name) || isPythonRequirements(path) || /\.(cs|fs)proj$/.test(name);
}

export function isWorkflowFile(path: string): boolean {
  return /^\.github\/workflows\/[^/]+\.ya?ml$/.test(path);
}

export function isConfigFile(path: string): boolean {
  const name = basename(path);
  return CONFIG_PATTERNS.some((pattern) => pattern.test(name)) || isWorkflowFile(path);
}

export function isEntryPoint(path: string): boolean {
  const name = basename(path);
  const stem = name.includes(".") ? name.slice(0, name.indexOf(".")) : name;
  return ENTRY_POINT_NAMES.has(stem.toLowerCase());
}

export function languageOf(path: string): string | undefined {
  return lookup(SOURCE_LANGUAGES, extension(path));
}

/** Sort key for manifests: shallow ones first, and ones in test, fixture or example folders last. */
export function manifestPriority(path: string): number {
  return depth(path) + (isLowValuePath(path) ? 100 : 0);
}

/** "React ^19.2.1 (in package.json and 3 other files)" */
export function describeTechnology(tech: Technology): string {
  const others = (tech.count ?? 1) - 1;
  const where = others > 0 ? `${tech.source} and ${others} other file${others === 1 ? "" : "s"}` : tech.source;
  return `${tech.name}${tech.version ? ` ${tech.version}` : ""} (in ${where})`;
}

// --- Technology detection -------------------------------------------------

const JS_PACKAGES: Record<string, string> = {
  react: "React", "react-dom": "React DOM", next: "Next.js", vue: "Vue", nuxt: "Nuxt",
  "@angular/core": "Angular", svelte: "Svelte", "@sveltejs/kit": "SvelteKit", "solid-js": "SolidJS",
  "react-native": "React Native", expo: "Expo", electron: "Electron", gatsby: "Gatsby",
  "@remix-run/react": "Remix", astro: "Astro", "react-scripts": "Create React App (react-scripts)",
  "@tanstack/react-start": "TanStack Start", "@tanstack/react-router": "TanStack Router",
  express: "Express", koa: "Koa", fastify: "Fastify", "@nestjs/core": "NestJS", hono: "Hono",
  "@trpc/server": "tRPC", graphql: "GraphQL", "@apollo/client": "Apollo Client",
  vite: "Vite", webpack: "webpack", parcel: "Parcel", rollup: "Rollup", esbuild: "esbuild",
  "@babel/core": "Babel", typescript: "TypeScript", "flow-bin": "Flow",
  turbo: "Turborepo", nx: "Nx", lerna: "Lerna",
  tailwindcss: "Tailwind CSS", "@mui/material": "Material UI", bootstrap: "Bootstrap",
  "styled-components": "styled-components", "@emotion/react": "Emotion", sass: "Sass",
  redux: "Redux", "@reduxjs/toolkit": "Redux Toolkit", zustand: "Zustand", mobx: "MobX",
  "@ngrx/store": "NgRx", pinia: "Pinia", vuex: "Vuex", rxjs: "RxJS", zod: "Zod",
  "react-router-dom": "React Router", "react-router": "React Router", "vue-router": "Vue Router",
  "@tanstack/react-query": "TanStack Query", axios: "axios",
  prisma: "Prisma", "@prisma/client": "Prisma Client", mongoose: "Mongoose", sequelize: "Sequelize",
  typeorm: "TypeORM", "drizzle-orm": "Drizzle ORM", pg: "PostgreSQL (pg)", mysql2: "MySQL (mysql2)",
  mongodb: "MongoDB driver", redis: "Redis", ioredis: "Redis (ioredis)", "better-sqlite3": "SQLite (better-sqlite3)",
  bullmq: "BullMQ", kafkajs: "Kafka (kafkajs)",
  "next-auth": "NextAuth.js", "better-auth": "Better Auth", firebase: "Firebase",
  "@supabase/supabase-js": "Supabase", stripe: "Stripe", "@sentry/node": "Sentry", "@sentry/react": "Sentry",
  jest: "Jest", vitest: "Vitest", mocha: "Mocha", karma: "Karma", cypress: "Cypress",
  "@playwright/test": "Playwright", "@testing-library/react": "React Testing Library", storybook: "Storybook",
  eslint: "ESLint", prettier: "Prettier", jquery: "jQuery", "socket.io": "Socket.IO",
};

const PYTHON_PACKAGES: Record<string, string> = {
  django: "Django", flask: "Flask", fastapi: "FastAPI", starlette: "Starlette", tornado: "Tornado",
  aiohttp: "aiohttp", djangorestframework: "Django REST framework", channels: "Django Channels",
  sqlalchemy: "SQLAlchemy", "flask-sqlalchemy": "Flask-SQLAlchemy", "flask-login": "Flask-Login",
  "flask-migrate": "Flask-Migrate", "flask-wtf": "Flask-WTF", alembic: "Alembic", pydantic: "Pydantic",
  psycopg: "PostgreSQL (psycopg)", psycopg2: "PostgreSQL (psycopg2)", "psycopg2-binary": "PostgreSQL (psycopg2)",
  mysqlclient: "MySQL (mysqlclient)", pymongo: "MongoDB (pymongo)", redis: "Redis", celery: "Celery", rq: "RQ",
  elasticsearch: "Elasticsearch", "django-storages": "django-storages", boto3: "boto3 (AWS)",
  stripe: "Stripe", "sentry-sdk": "Sentry", jinja2: "Jinja2", sphinx: "Sphinx",
  graphene: "Graphene (GraphQL)", "strawberry-graphql": "Strawberry (GraphQL)",
  pandas: "pandas", numpy: "NumPy", "scikit-learn": "scikit-learn", torch: "PyTorch",
  tensorflow: "TensorFlow", transformers: "Hugging Face Transformers", langchain: "LangChain",
  openai: "OpenAI SDK", anthropic: "Anthropic SDK", streamlit: "Streamlit", jupyter: "Jupyter",
  pytest: "pytest", uvicorn: "Uvicorn", gunicorn: "Gunicorn", requests: "Requests", httpx: "HTTPX",
};

const GO_MODULES: Record<string, string> = {
  "github.com/gin-gonic/gin": "Gin", "github.com/labstack/echo": "Echo",
  "github.com/gofiber/fiber": "Fiber", "github.com/go-chi/chi": "chi", "github.com/gorilla/mux": "Gorilla Mux",
  "gorm.io/gorm": "GORM", "github.com/go-sql-driver/mysql": "MySQL driver", "github.com/lib/pq": "PostgreSQL (lib/pq)",
  "github.com/jackc/pgx": "PostgreSQL (pgx)", "github.com/redis/go-redis": "Redis (go-redis)",
  "github.com/go-redis/redis": "Redis (go-redis)", "github.com/sirupsen/logrus": "logrus", "go.uber.org/zap": "zap",
  "github.com/stretchr/testify": "testify", "google.golang.org/grpc": "gRPC", "github.com/spf13/cobra": "Cobra",
};

const RUST_CRATES: Record<string, string> = {
  axum: "Axum", "actix-web": "Actix Web", rocket: "Rocket", tokio: "Tokio", warp: "warp",
  diesel: "Diesel", sqlx: "SQLx", "sea-orm": "SeaORM", redis: "Redis", reqwest: "reqwest",
  tracing: "tracing", tonic: "tonic (gRPC)", clap: "clap", tauri: "Tauri", bevy: "Bevy",
};

/** Maven/Gradle artifact names worth knowing about (their versions usually come from Spring Boot). */
const JVM_ARTIFACTS: Record<string, string> = {
  "spring-boot-starter-web": "Spring Web MVC", "spring-boot-starter-webflux": "Spring WebFlux",
  "spring-boot-starter-data-jpa": "Spring Data JPA", "spring-boot-starter-security": "Spring Security",
  "spring-boot-starter-thymeleaf": "Thymeleaf", "spring-boot-starter-cache": "Spring Cache",
  h2: "H2 database", "mysql-connector-j": "MySQL driver", "mysql-connector-java": "MySQL driver",
  postgresql: "PostgreSQL driver", testcontainers: "Testcontainers", caffeine: "Caffeine cache",
  lombok: "Lombok", "hibernate-core": "Hibernate", "spring-kafka": "Spring Kafka",
};

/** Versions defined once in pnpm-workspace.yaml and referenced as "catalog:" in package.json files. */
export function parsePnpmCatalogs(text: string): Map<string, Record<string, string>> {
  const catalogs = new Map<string, Record<string, string>>();
  const set = (catalog: string, name: string, version: string) => {
    catalogs.set(catalog, { ...catalogs.get(catalog), [name]: version });
  };
  let section: "catalog" | "catalogs" | null = null;
  let named: string | null = null;
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\s+#.*$/, "");
    if (!line.trim()) continue;
    if (!/^\s/.test(line)) {
      section = /^catalog:\s*$/.test(line) ? "catalog" : /^catalogs:\s*$/.test(line) ? "catalogs" : null;
      named = null;
      continue;
    }
    const entry = line.trim().match(/^(["']?)(@?[^\s"':]+)\1\s*:\s*(.*)$/);
    if (!entry || !section) continue;
    const [, , key, rawValue] = entry;
    const value = rawValue.trim().replace(/^["']|["']$/g, "");
    if (section === "catalog") {
      if (value) set("default", key, value);
    } else if (!value) {
      named = key;
    } else if (named) {
      set(named, key, value);
    }
  }
  return catalogs;
}

function fromPackageJson(file: FileContent, out: Technology[], catalogs: Map<string, Record<string, string>>) {
  let pkg: Record<string, unknown>;
  try {
    pkg = objectOf(JSON.parse(file.text));
  } catch {
    return;
  }
  const deps: Record<string, unknown> = {
    ...objectOf(pkg.peerDependencies),
    ...objectOf(pkg.devDependencies),
    ...objectOf(pkg.dependencies),
  };
  for (const [name, spec] of Object.entries(deps)) {
    const display = lookup(JS_PACKAGES, name);
    if (!display) continue;
    let version = String(spec);
    if (version.startsWith("catalog:")) {
      const catalog = version.slice("catalog:".length) || "default";
      version = catalogs.get(catalog)?.[name] ?? version;
    }
    out.push({ name: display, version, source: file.path });
  }
  const node = objectOf(pkg.engines).node;
  if (typeof node === "string") out.push({ name: "Node.js", version: node, source: file.path });
}

const OPERATOR = String.raw`(?:===?|~=|!=|<=|>=|<|>)`;
const REQUIREMENT = new RegExp(
  String.raw`^\s*([A-Za-z0-9][A-Za-z0-9_.-]*)\s*(?:\[[^\]]*\])?\s*(${OPERATOR}\s*[^,;#\s"']+(?:\s*,\s*${OPERATOR}\s*[^,;#\s"']+)*)?`,
);

/** "Django>=4.2,<5.0" → Django ">=4.2,<5.0"; an exact "==4.2.7" pin is shown as "4.2.7". */
function addRequirement(requirement: string, source: string, out: Technology[]) {
  const match = requirement.match(REQUIREMENT);
  const display = match && lookup(PYTHON_PACKAGES, match[1].toLowerCase());
  if (!match || !display) return;
  const spec = match[2]?.replace(/\s+/g, "");
  out.push({ name: display, version: spec?.startsWith("==") ? spec.slice(2) : spec || undefined, source });
}

function fromPython(file: FileContent, out: Technology[]) {
  if (isPythonRequirements(file.path)) {
    for (const line of file.text.split("\n")) {
      if (!line.trim().startsWith("-")) addRequirement(line.replace(/#.*$/, ""), file.path, out);
    }
  } else {
    // Quoted requirement strings: PEP 621 dependency arrays (on one line or many) and setup.py lists.
    for (const quoted of file.text.matchAll(/["']([A-Za-z0-9][^"'\n]*)["']/g)) addRequirement(quoted[1], file.path, out);
    // TOML tables such as Poetry's and Pipfile's: name = "spec" or name = { version = "spec" }.
    for (const line of file.text.split("\n")) {
      const entry = line.match(/^\s*([A-Za-z0-9][A-Za-z0-9_.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|\{[^}]*?version\s*=\s*"([^"]*)")/);
      if (!entry) continue;
      const spec = entry[2] ?? entry[3] ?? entry[4];
      const name = entry[1].toLowerCase();
      if (name === "python") out.push({ name: "Python", version: spec, source: file.path });
      const display = lookup(PYTHON_PACKAGES, name);
      if (display) out.push({ name: display, version: spec && spec !== "*" ? spec : undefined, source: file.path });
    }
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
    const match = line.match(/^([a-z0-9_-]+)\s*=\s*(?:"([^"]+)"|\{(.*)\})/);
    const display = match && lookup(RUST_CRATES, match[1]);
    if (!match || !display) continue;
    // `{ workspace = true }` inherits the version from the workspace root, which isn't known here.
    const version = match[2] ?? match[3]?.match(/version\s*=\s*"([^"]+)"/)?.[1];
    out.push({ name: display, version, source: file.path });
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
  for (const [artifact, display] of Object.entries(JVM_ARTIFACTS)) {
    if (new RegExp(`[>:'"]${artifact.replace(/[.]/g, "\\.")}[<:'"]`).test(text)) out.push({ name: display, source: file.path });
  }
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
  const gems = [
    ["rails", "Ruby on Rails"], ["sinatra", "Sinatra"], ["pg", "PostgreSQL (pg)"], ["redis", "Redis"],
    ["sidekiq", "Sidekiq"], ["devise", "Devise"], ["rspec-rails", "RSpec"], ["puma", "Puma"],
  ] as const;
  for (const [gem, display] of gems) {
    const match = file.text.match(new RegExp(`gem\\s+['"]${gem}['"](?:\\s*,\\s*['"]([^'"]+)['"])?`));
    if (match) out.push({ name: display, version: match[1], source: file.path });
  }
  const ruby = file.text.match(/^ruby\s+['"]([^'"]+)['"]/m);
  if (ruby) out.push({ name: "Ruby", version: ruby[1], source: file.path });
}

function fromComposer(file: FileContent, out: Technology[]) {
  let pkg: Record<string, unknown>;
  try {
    pkg = objectOf(JSON.parse(file.text));
  } catch {
    return;
  }
  const require = { ...objectOf(pkg["require-dev"]), ...objectOf(pkg.require) };
  const known: Record<string, string> = {
    php: "PHP",
    "laravel/framework": "Laravel",
    "symfony/framework-bundle": "Symfony",
    "doctrine/orm": "Doctrine ORM",
    "guzzlehttp/guzzle": "Guzzle",
    "phpunit/phpunit": "PHPUnit",
  };
  for (const [name, display] of Object.entries(known)) {
    if (typeof require[name] === "string") out.push({ name: display, version: require[name] as string, source: file.path });
  }
}

function fromDotnet(file: FileContent, out: Technology[]) {
  const framework = file.text.match(/<TargetFrameworks?>([^<]+)</)?.[1];
  if (framework) out.push({ name: ".NET", version: framework, source: file.path });
  if (/Sdk="Microsoft\.NET\.Sdk\.Web"/.test(file.text)) out.push({ name: "ASP.NET Core", source: file.path });
}

function fromDockerfile(file: FileContent, out: Technology[]) {
  const image = file.text.match(/^FROM\s+(?:--platform=\S+\s+)?(\S+)/im)?.[1];
  const known = image && !image.includes("${") ? `base image ${image}` : undefined;
  out.push({ name: "Docker", version: known, source: file.path });
}

/**
 * Finds frameworks and tools in the manifests that were read (versions copied as written, with
 * pnpm catalog references resolved), plus lockfiles and other telltale files in the tree.
 * Each technology appears once, with a count of how many files list it.
 */
export function detectTechnologies(contents: FileContent[], allPaths: string[] = []): Technology[] {
  const found: Technology[] = [];
  const workspace = contents.find((file) => basename(file.path) === "pnpm-workspace.yaml");
  const catalogs = workspace ? parsePnpmCatalogs(workspace.text) : new Map<string, Record<string, string>>();

  for (const file of contents) {
    const name = basename(file.path);
    if (name === "package.json") fromPackageJson(file, found, catalogs);
    else if (isPythonRequirements(file.path) || ["pyproject.toml", "Pipfile", "setup.py", "setup.cfg"].includes(name)) fromPython(file, found);
    else if (name === "go.mod") fromGoMod(file, found);
    else if (name === "Cargo.toml") fromCargo(file, found);
    else if (name === "pom.xml" || name.startsWith("build.gradle")) fromJvm(file, found);
    else if (name === "Gemfile") fromGemfile(file, found);
    else if (name === "composer.json") fromComposer(file, found);
    else if (/\.(cs|fs)proj$/.test(name)) fromDotnet(file, found);
    // A Dockerfile under .devcontainer is an editor environment, not how the app runs.
    else if (/^dockerfile$/i.test(name) && !isLowValuePath(file.path)) fromDockerfile(file, found);
  }

  // The shallowest depth in the tree: 0 for a whole repository, more when analyzing one folder.
  const top = allPaths.reduce((min, path) => Math.min(min, depth(path)), Number.POSITIVE_INFINITY);
  for (const path of [...allPaths].sort((a, b) => manifestPriority(a) - manifestPriority(b))) {
    if (isIgnoredPath(path) || isLowValuePath(path)) continue;
    const manager = lookup(LOCKFILES, basename(path));
    if (manager && depth(path) <= top + 2) found.push({ name: manager, source: path });
    const signal = lookup(SIGNAL_FILES, basename(path));
    if (signal && depth(path) === top) found.push({ name: signal, source: path });
    if (isWorkflowFile(path)) found.push({ name: "GitHub Actions", source: ".github/workflows" });
  }

  const merged = new Map<string, Technology>();
  for (const tech of found) {
    // A file like turbo.json adds nothing when a manifest already listed the same tool with its version.
    if (!tech.version && found.some((other) => other.name === tech.name && other.version)) continue;
    const key = `${tech.name}|${tech.version ?? ""}`;
    const existing = merged.get(key);
    if (existing) {
      if (existing.source !== tech.source) existing.count = (existing.count ?? 1) + 1;
    } else {
      merged.set(key, { ...tech });
    }
  }
  return [...merged.values()];
}

function languageShares(bytesByLanguage: Record<string, number>): Array<{ name: string; percent: number }> {
  const total = Object.values(bytesByLanguage).reduce((sum, bytes) => sum + bytes, 0);
  return Object.entries(bytesByLanguage)
    .sort((a, b) => b[1] - a[1])
    .map(([name, bytes]) => ({ name, percent: total ? Math.round((bytes / total) * 1000) / 10 : 0 }))
    .filter((lang) => lang.percent > 0)
    .slice(0, 8);
}

/** Measures the repository: file counts, estimated lines of code, languages and detected technologies. */
export function computeFacts(snapshot: RepoSnapshot): RepoFacts {
  const files = snapshot.files.filter((file) => !isIgnoredPath(file.path));
  const sources = files.filter((file) => isSourceFile(file.path));
  // Very large and generated files (compiled CSS, data dumps, protobuf output) would inflate the count.
  const isCounted = (file: RepoFile) => file.size <= LARGE_FILE_BYTES && !isGeneratedFile(file.path);
  const counted = sources.filter(isCounted);
  const countedBytes = counted.reduce((sum, file) => sum + file.size, 0);

  // Measure bytes-per-line on the source files we actually read, then apply it to the rest.
  const encoder = new TextEncoder();
  const sampled = snapshot.contents.filter((file) => isSourceFile(file.path) && !file.truncated && !isGeneratedFile(file.path));
  const sampledLines = sampled.reduce((sum, file) => sum + file.lines, 0);
  const sampledBytes = sampled.reduce((sum, file) => sum + encoder.encode(file.text).length, 0);
  const bytesPerLine = sampledLines >= 50 ? sampledBytes / sampledLines : DEFAULT_BYTES_PER_LINE;

  // GitHub's language numbers cover the whole repository, so a folder is measured from its own files.
  const languageBytes: Record<string, number> = {};
  if (snapshot.path) {
    for (const file of sources) {
      const language = languageOf(file.path);
      if (language) languageBytes[language] = (languageBytes[language] ?? 0) + file.size;
    }
  }

  const manifests = files
    .map((file) => file.path)
    .filter(isManifest)
    .sort((a, b) => manifestPriority(a) - manifestPriority(b) || a.localeCompare(b));

  return {
    owner: snapshot.ref.owner,
    name: snapshot.ref.repo,
    url: snapshot.url,
    branch: snapshot.branch,
    path: snapshot.path,
    description: snapshot.description,
    stars: snapshot.stars,
    license: snapshot.license,
    pushedAt: snapshot.pushedAt,
    totalFiles: files.length,
    sourceFiles: sources.length,
    testFiles: sources.filter((file) => isTestFile(file.path)).length,
    estimatedLines: Math.round(countedBytes / bytesPerLine),
    linesExcludedFiles: sources.length - counted.length,
    languages: languageShares(snapshot.path ? languageBytes : snapshot.languages),
    manifests: manifests.slice(0, 20),
    manifestCount: manifests.length,
    technologies: detectTechnologies(snapshot.contents, files.map((file) => file.path)),
    filesRead: snapshot.contents.length,
    treeTruncated: snapshot.treeTruncated,
  };
}
