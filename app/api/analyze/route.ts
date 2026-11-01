import { z } from "zod";
import { accessCodeMatches } from "@/lib/access-code";
import { getConfig } from "@/lib/config";
import { createDemoClient } from "@/lib/demo";
import { describeError } from "@/lib/describe-error";
import { StepError } from "@/lib/errors";
import { parseRepoUrl } from "@/lib/github";
import { createClaudeClient } from "@/lib/llm";
import { runAnalysis } from "@/lib/pipeline";
import { RateLimiter, clientKey, type LimitResult } from "@/lib/rate-limit";
import type { PipelineEvent } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HOUR_MS = 60 * 60 * 1000;
const HEARTBEAT_MS = 15_000;
/** Wrong access codes allowed per hour, from one visitor and from everyone together. */
const WRONG_CODES_PER_VISITOR = 10;
const WRONG_CODES_TOTAL = 100;

const perVisitor = new RateLimiter(HOUR_MS);
const perDay = new RateLimiter(24 * HOUR_MS);
const wrongCodesByVisitor = new RateLimiter(HOUR_MS);
const wrongCodesTotal = new RateLimiter(HOUR_MS);

const RATE_MESSAGE = "The hourly rate must be a number from 1 to 10,000.";

const Body = z.object({
  repoUrl: z
    .string({ error: "Enter a GitHub repository URL." })
    .trim()
    .min(1, "Enter a GitHub repository URL.")
    .max(300, "That repository URL is too long."),
  targetStack: z
    .string({ error: "Describe the stack you want to move to." })
    .trim()
    .min(2, "Describe the stack you want to move to.")
    .max(200, "Keep the target stack under 200 characters."),
  hourlyRate: z.number({ error: RATE_MESSAGE }).min(1, RATE_MESSAGE).max(10_000, RATE_MESSAGE).default(100),
  accessCode: z.string({ error: "The access code must be text." }).max(200).optional(),
});

function fail(status: number, error: string, headers?: HeadersInit): Response {
  return Response.json({ error }, { status, headers });
}

function tooMany(limit: LimitResult & { ok: false }, error: string): Response {
  return fail(429, error, { "Retry-After": String(limit.retryAfterSeconds) });
}

function minutes(seconds: number): string {
  const value = Math.max(1, Math.ceil(seconds / 60));
  return `${value} minute${value === 1 ? "" : "s"}`;
}

/** Runs an analysis and streams progress as newline-delimited JSON (one PipelineEvent per line). */
export async function POST(request: Request): Promise<Response> {
  const config = getConfig();
  const visitor = clientKey(request.headers);

  let body: z.infer<typeof Body>;
  try {
    const parsed = Body.safeParse(await request.json());
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return fail(400, issue?.path.length ? issue.message : "Send a JSON object with repoUrl and targetStack.");
    }
    body = parsed.data;
  } catch {
    return fail(400, "The request body must be JSON.");
  }

  if (config.accessCode) {
    // Wrong guesses are limited, and once a visitor runs out, even the right code is refused,
    // so guessing doesn't pay off.
    for (const [limiter, key, max] of [
      [wrongCodesByVisitor, visitor, WRONG_CODES_PER_VISITOR],
      [wrongCodesTotal, "all", WRONG_CODES_TOTAL],
    ] as const) {
      const left = limiter.peek(key, max);
      if (!left.ok) return tooMany(left, `Too many wrong access codes. Try again in ${minutes(left.retryAfterSeconds)}.`);
    }
    if (!accessCodeMatches(body.accessCode, config.accessCode)) {
      wrongCodesByVisitor.check(visitor, WRONG_CODES_PER_VISITOR);
      wrongCodesTotal.check("all", WRONG_CODES_TOTAL);
      return fail(401, "That access code isn't right.");
    }
  }

  const repo = parseRepoUrl(body.repoUrl);
  if (!repo) {
    return fail(400, "That doesn't look like a GitHub repository. Use a link like https://github.com/owner/repo.");
  }

  const visitorLeft = perVisitor.peek(visitor, config.rateLimitPerHour);
  if (!visitorLeft.ok) {
    return tooMany(
      visitorLeft,
      `This server allows ${config.rateLimitPerHour} analyses per hour. Try again in ${minutes(visitorLeft.retryAfterSeconds)}.`,
    );
  }
  const dayLeft = perDay.peek("all", config.dailyAnalysisLimit);
  if (!dayLeft.ok) {
    return tooMany(dayLeft, "This server has reached its daily limit of analyses. Try again tomorrow.");
  }
  perVisitor.check(visitor, config.rateLimitPerHour);
  perDay.check("all", config.dailyAnalysisLimit);

  const llm = config.demo ? createDemoClient() : createClaudeClient({ model: config.model });
  // Stop all work (and spending) as soon as the browser goes away.
  const abort = new AbortController();
  request.signal.addEventListener("abort", () => abort.abort(), { once: true });

  const encoder = new TextEncoder();
  let closed = false;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: PipelineEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          closed = true;
        }
      };
      // Keeps proxies from closing the connection during long silent stretches (thinking, searching).
      const heartbeat = setInterval(() => send({ type: "ping" }), HEARTBEAT_MS);
      try {
        await runAnalysis(
          { repo, targetStack: body.targetStack, hourlyRate: body.hourlyRate },
          {
            llm,
            emit: send,
            signal: abort.signal,
            effort: config.effort,
            github: { token: config.githubToken, allowPrivate: config.allowPrivateRepos },
          },
        );
      } catch (err) {
        if (!abort.signal.aborted) {
          send({ type: "error", message: describeError(err), step: err instanceof StepError ? err.step : undefined });
        }
      } finally {
        clearInterval(heartbeat);
        if (!closed) {
          closed = true;
          controller.close();
        }
      }
    },
    cancel() {
      closed = true;
      abort.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      // no-transform also stops `next start` from compressing (and so buffering) the stream.
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
