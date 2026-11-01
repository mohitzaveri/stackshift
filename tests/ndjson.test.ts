import { describe, expect, it } from "vitest";
import { readNdjson } from "../lib/ndjson";

function streamOf(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

async function collect<T>(body: ReadableStream<Uint8Array>): Promise<T[]> {
  const values: T[] = [];
  for await (const value of readNdjson<T>(body)) values.push(value);
  return values;
}

describe("readNdjson", () => {
  it("handles lines split across chunks, including multi-byte characters", async () => {
    const bytes = new TextEncoder().encode('{"text":"React → Next.js"}\n\n{"n":2}\n{"n":3}');
    // Split inside the arrow character (3 bytes in UTF-8) and inside the second line.
    const arrow = bytes.indexOf(0xe2);
    const chunks = [bytes.slice(0, arrow + 1), bytes.slice(arrow + 1, arrow + 15), bytes.slice(arrow + 15)];
    expect(await collect(streamOf(chunks))).toEqual([{ text: "React → Next.js" }, { n: 2 }, { n: 3 }]);
  });
});
