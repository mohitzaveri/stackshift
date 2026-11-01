import { z } from "zod";
import { getConfig } from "@/lib/config";
import { createDemoClient } from "@/lib/demo";
import { describeError } from "@/lib/describe-error";
import { StepError } from "@/lib/errors";
import { parseRepoUrl } from "@/lib/github";
import { createClaudeClient } from "@/lib/llm";
import { runAnalysis } from "@/lib/pipeline";
import { RateLimiter, clientKey } from "@/lib/rate-limit";
import type { PipelineEvent } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEARTBEAT_MS = 15_000;
const limiter = new RateLimiter(60 * 60 * 1000);

const Body = z.object({
  repoUrl: z.string().trim().min(1).max(300),
  targetStack: z.string().trim().min(2, "Describe the stack you want to move to.").max(200),
  hourlyRate: z.number().positive().max(10_000).default(100),
  accessCode: z.string().max(200).optional(),
});

function fail(status: number, error: string, headers?: HeadersInit): Response {
  return Response.json({ error }, { status, headers });
}

/** Runs an analysis and streams progress as newline-delimited JSON (one PipelineEvent per line). */
export async function POST(request: Request): Promise<Response> {
  const config = getConfig();

  let body: z.infer<typeof Body>;
  try {
    const parsed = Body.safeParse(await request.json());
    if (!parsed.success) return fail(400, parsed.error.issues[0]?.message ?? "Invalid request.");
    body = parsed.data;
  } catch {
    return fail(400, "The request body must be JSON.");
  }

  if (config.accessCode && body.accessCode !== config.accessCode) {
    return fail(401, "That access code isn't right.");
  }
  const repo = parseRepoUrl(body.repoUrl);
  if (!repo) {
    return fail(400, "That doesn't look like a GitHub repository. Use a link like https://github.com/owner/repo.");
  }
  const allowed = limiter.check(clientKey(request.headers), config.rateLimitPerHour);
  if (!allowed.ok) {
    const minutes = Math.ceil(allowed.retryAfterSeconds / 60);
    return fail(
      429,
      `This server allows ${config.rateLimitPerHour} analyses per hour. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
      { "Retry-After": String(allowed.retryAfterSeconds) },
    );
  }

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
          { llm, emit: send, signal: abort.signal, effort: config.effort, github: { token: config.githubToken } },
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
