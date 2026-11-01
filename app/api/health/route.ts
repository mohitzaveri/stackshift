import { getConfig } from "@/lib/config";

export const dynamic = "force-dynamic";

/** Tells the browser how this server is set up. Never includes secrets. */
export function GET(): Response {
  const config = getConfig();
  return Response.json({
    status: "ok",
    demo: config.demo,
    model: config.demo ? "demo" : config.model,
    accessCodeRequired: Boolean(config.accessCode),
    rateLimitPerHour: config.rateLimitPerHour,
  });
}
