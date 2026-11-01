import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "../app/api/analyze/route";
import { readNdjson } from "../lib/ndjson";
import type { PipelineEvent } from "../lib/types";
import { fakeFetch, reactApp, repoRoutes } from "./fixtures";

// The route's limiters live for the whole file, so every test uses its own visitor addresses.
const ENV = ["DEMO_MODE", "RATE_LIMIT_PER_HOUR", "DAILY_ANALYSIS_LIMIT", "ACCESS_CODE", "GITHUB_TOKEN", "ALLOW_PRIVATE_REPOS"];
const valid = { repoUrl: "https://github.com/acme/food-app", targetStack: "Next.js 16" };
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(ENV.map((key) => [key, process.env[key]]));
  for (const key of ENV) delete process.env[key];
  process.env.DEMO_MODE = "1";
  process.env.RATE_LIMIT_PER_HOUR = "0";
  process.env.DAILY_ANALYSIS_LIMIT = "0";
  vi.stubGlobal("fetch", fakeFetch(repoRoutes(reactApp)).fetch);
});

afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  vi.unstubAllGlobals();
});

function post(body: unknown, visitor = "192.0.2.1"): Promise<Response> {
  return POST(
    new Request("http://localhost/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-for": visitor },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

/** Starts an analysis and stops it straight away; only the status code matters. */
async function status(body: unknown, visitor: string): Promise<number> {
  const res = await post(body, visitor);
  await res.body?.cancel();
  return res.status;
}

async function errorOf(res: Response): Promise<string> {
  return ((await res.json()) as { error: string }).error;
}

async function events(res: Response): Promise<PipelineEvent[]> {
  const all: PipelineEvent[] = [];
  for await (const event of readNdjson<PipelineEvent>(res.body!)) all.push(event);
  return all;
}

describe("POST /api/analyze", () => {
  it("explains bad input, naming what's wrong", async () => {
    expect(await errorOf(await post({ targetStack: "Vue" }))).toBe("Enter a GitHub repository URL.");
    expect(await errorOf(await post({ ...valid, targetStack: "" }))).toBe("Describe the stack you want to move to.");
    expect(await errorOf(await post({ ...valid, hourlyRate: "100" }))).toBe("The hourly rate must be a number from 1 to 10,000.");
    expect(await errorOf(await post({ ...valid, hourlyRate: 0.5 }))).toBe("The hourly rate must be a number from 1 to 10,000.");
    expect(await errorOf(await post(null))).toBe("Send a JSON object with repoUrl and targetStack.");
    expect(await errorOf(await post("{oops"))).toBe("The request body must be JSON.");
    expect(await errorOf(await post({ ...valid, repoUrl: "https://gitlab.com/a/b" }))).toMatch(/doesn't look like a GitHub repository/);
  });

  it("can't be tricked past the per-visitor limit with a fake X-Forwarded-For", async () => {
    process.env.RATE_LIMIT_PER_HOUR = "2";
    // Each request claims a different address, but the proxy-added last entry is the same.
    const codes = [];
    for (let i = 0; i < 3; i++) codes.push(await status(valid, `10.0.0.${i}, 198.51.100.7`));
    expect(codes).toEqual([200, 200, 429]);
  });

  it("caps analyses per day across all visitors", async () => {
    process.env.DAILY_ANALYSIS_LIMIT = "1";
    expect(await status(valid, "198.51.100.20")).toBe(200);
    const res = await post(valid, "198.51.100.21");
    expect(res.status).toBe(429);
    expect(await errorOf(res)).toMatch(/daily limit/);
    process.env.DAILY_ANALYSIS_LIMIT = "0";
  });

  it("stops accepting even the right access code after too many wrong guesses", async () => {
    process.env.ACCESS_CODE = "open-sesame";
    const guesser = "203.0.113.50";
    for (let i = 0; i < 10; i++) expect(await status({ ...valid, accessCode: `guess-${i}` }, guesser)).toBe(401);
    expect(await status({ ...valid, accessCode: "guess-10" }, guesser)).toBe(429);
    expect(await status({ ...valid, accessCode: "open-sesame" }, guesser)).toBe(429);
    expect(await status({ ...valid, accessCode: "open-sesame" }, "203.0.113.51")).toBe(200);
  });

  it("refuses private repositories unless allowed, with the same message as a missing one", async () => {
    process.env.GITHUB_TOKEN = "secret";
    vi.stubGlobal("fetch", fakeFetch(repoRoutes({ ...reactApp, private: true })).fetch);
    const privateRepo = (await events(await post(valid, "198.51.100.40"))).at(-1);
    const missingRepo = (await events(await post({ ...valid, repoUrl: "acme/nope" }, "198.51.100.40"))).at(-1);
    expect(privateRepo).toMatchObject({ type: "error", step: "repo" });
    expect(privateRepo).toEqual(missingRepo);

    process.env.ALLOW_PRIVATE_REPOS = "1";
    for await (const event of readNdjson<PipelineEvent>((await post(valid, "198.51.100.40")).body!)) {
      if (event.type === "error") throw new Error(event.message);
      if (event.type === "step" && event.step === "repo" && event.status === "done") break;
    }
  });

  it("streams a complete analysis in demo mode", async () => {
    const all = await events(await post({ ...valid, hourlyRate: 120 }, "198.51.100.60"));
    const last = all.at(-1);
    expect(last?.type).toBe("result");
    if (last?.type === "result") {
      expect(last.result.demo).toBe(true);
      expect(last.result.estimate.hourlyRate).toBe(120);
      expect(last.result.repo.technologies.map((tech) => tech.name)).toContain("React");
    }
  }, 15_000);
});
