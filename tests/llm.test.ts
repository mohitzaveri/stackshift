import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { AgentError } from "../lib/errors";
import {
  buildParams,
  collectSources,
  collectText,
  createClaudeClient,
  describeClaudeError,
  type AgentRequest,
  type MessageStreamLike,
  type MessagesApi,
} from "../lib/llm";
import type { RepoFacts } from "../lib/types";

type BetaMessage = Anthropic.Beta.BetaMessage;
type BetaContentBlock = Anthropic.Beta.BetaContentBlock;

const facts = { technologies: [] } as unknown as RepoFacts;

function request(overrides: Partial<AgentRequest> = {}): AgentRequest {
  return { step: "stack", prompt: "Analyze it", effort: "high", demo: { targetStack: "Next.js", facts }, ...overrides };
}

function message(content: unknown[], overrides: Record<string, unknown> = {}): BetaMessage {
  return {
    id: "msg_1",
    type: "message",
    role: "assistant",
    model: "claude-opus-5-5",
    content,
    stop_reason: "end_turn",
    stop_sequence: null,
    stop_details: null,
    usage: {
      input_tokens: 100,
      output_tokens: 50,
      cache_creation_input_tokens: 10,
      cache_read_input_tokens: 0,
      server_tool_use: { web_search_requests: 1, web_fetch_requests: 0 },
    },
    ...overrides,
  } as unknown as BetaMessage;
}

/** A fake Messages API that replays canned responses and records each request. */
function fakeApi(responses: BetaMessage[]) {
  const calls: Array<Parameters<MessagesApi["stream"]>[0]> = [];
  const api: MessagesApi = {
    stream(params) {
      calls.push(structuredClone(params));
      const response = responses[calls.length - 1];
      const listeners = { text: [] as Array<(d: string) => void>, contentBlock: [] as Array<(b: BetaContentBlock) => void> };
      const stream = {
        on(event: "text" | "contentBlock", listener: never) {
          (listeners[event] as unknown[]).push(listener);
          return stream;
        },
        async finalMessage() {
          for (const block of response.content) {
            if (block.type === "text") listeners.text.forEach((fn) => fn(block.text));
            listeners.contentBlock.forEach((fn) => fn(block));
          }
          return response;
        },
      };
      return stream as MessageStreamLike;
    },
  };
  return { api, calls };
}

describe("buildParams", () => {
  it("caches the shared context, opts into fallbacks and uses adaptive thinking", () => {
    const params = buildParams("claude-opus-5-5", request({ context: "SNAPSHOT" }));
    expect(params).toMatchObject({
      model: "claude-opus-5-5",
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      thinking: { type: "adaptive" },
      output_config: { effort: "high" },
    });
    expect(params.messages[0].content).toEqual([
      { type: "text", text: "SNAPSHOT", cache_control: { type: "ephemeral" } },
      { type: "text", text: "Analyze it" },
    ]);
    expect(params).not.toHaveProperty("tools");
    expect(params).not.toHaveProperty("temperature");
  });

  it("adds web search only when asked, and structured output only for JSON steps", () => {
    const research = buildParams("claude-opus-5-5", request({ step: "research", webSearch: { maxUses: 6 } }));
    expect(research.tools).toEqual([{ type: "web_search_20260209", name: "web_search", max_uses: 6 }]);
    expect(research.output_config).not.toHaveProperty("format");

    const schema = { type: "object", properties: {}, additionalProperties: false };
    const estimate = buildParams("claude-opus-5-5", request({ step: "estimate", jsonSchema: schema }));
    expect(estimate.output_config).toEqual({ effort: "high", format: { type: "json_schema", schema } });
  });
});

describe("collectText and collectSources", () => {
  it("joins citation-split text blocks and lists the cited sources", () => {
    const blocks = [
      { type: "thinking", thinking: "", signature: "x" },
      { type: "server_tool_use", id: "s1", name: "web_search", input: { query: "cra to next" } },
      {
        type: "web_search_tool_result",
        tool_use_id: "s1",
        content: [{ type: "web_search_result", url: "https://a.dev", title: "A", encrypted_content: "", page_age: null }],
      },
      { type: "text", text: "Next.js has an official guide", citations: null },
      {
        type: "text",
        text: " for this.",
        citations: [
          { type: "web_search_result_location", url: "https://nextjs.org/docs", title: "Next.js docs", cited_text: "", encrypted_index: "" },
          { type: "web_search_result_location", url: "https://nextjs.org/docs", title: "Next.js docs", cited_text: "", encrypted_index: "" },
        ],
      },
    ] as unknown as BetaContentBlock[];

    expect(collectText(blocks)).toBe("Next.js has an official guide for this.");
    expect(collectSources(blocks)).toEqual([{ url: "https://nextjs.org/docs", title: "Next.js docs" }]);
  });

  it("falls back to search results when nothing is cited", () => {
    const blocks = [
      {
        type: "web_search_tool_result",
        tool_use_id: "s1",
        content: [{ type: "web_search_result", url: "https://a.dev", title: "A", encrypted_content: "", page_age: null }],
      },
      { type: "text", text: "Summary.", citations: null },
    ] as unknown as BetaContentBlock[];
    expect(collectSources(blocks)).toEqual([{ url: "https://a.dev", title: "A" }]);
  });
});

describe("createClaudeClient", () => {
  it("resumes paused web-search turns and adds up usage", async () => {
    const searching = { type: "server_tool_use", id: "s1", name: "web_search", input: { query: "vue 3 migration" } };
    const { api, calls } = fakeApi([
      message([searching], { stop_reason: "pause_turn" }),
      message([{ type: "text", text: "Done.", citations: null }]),
    ]);
    const activity: string[] = [];
    const deltas: string[] = [];
    const client = createClaudeClient({ messages: api });
    const output = await client.run(request({ step: "research", webSearch: { maxUses: 6 } }), {
      onActivity: (m) => activity.push(m),
      onText: (t) => deltas.push(t),
    });

    expect(calls).toHaveLength(2);
    expect(calls[1].messages).toHaveLength(2);
    expect(calls[1].messages[1]).toEqual({ role: "assistant", content: [searching] });
    expect(output.text).toBe("Done.");
    expect(deltas).toEqual(["Done."]);
    expect(activity).toEqual(["Searching the web: “vue 3 migration”"]);
    expect(output.usage).toEqual({
      inputTokens: 200,
      outputTokens: 100,
      cacheWriteTokens: 20,
      cacheReadTokens: 0,
      webSearches: 2,
    });
  });

  it("reports refusals, empty answers and cut-off JSON as errors", async () => {
    const refused = createClaudeClient({
      messages: fakeApi([message([], { stop_reason: "refusal", stop_details: { type: "refusal", category: "cyber" } })]).api,
    });
    await expect(refused.run(request())).rejects.toThrow(/declined.*\(cyber\)/);

    const empty = createClaudeClient({ messages: fakeApi([message([])]).api });
    await expect(empty.run(request())).rejects.toBeInstanceOf(AgentError);

    const cutOff = createClaudeClient({
      messages: fakeApi([message([{ type: "text", text: '{"complexity":', citations: null }], { stop_reason: "max_tokens" })]).api,
    });
    await expect(cutOff.run(request({ step: "estimate", jsonSchema: {} }))).rejects.toThrow(/cut off/);
  });
});

describe("describeClaudeError", () => {
  it("explains missing credentials and ignores unrelated errors", () => {
    const missing = new Error(
      "Could not resolve authentication method. Expected one of apiKey, authToken, credentials, config, or profile to be set.",
    );
    expect(describeClaudeError(missing)).toMatch(/ANTHROPIC_API_KEY/);
    expect(describeClaudeError(new Error("something else"))).toBeNull();
  });
});
