import { describe, expect, it } from "vitest";
import { createSseParser, readSse, StreamError } from "@/lib/sse";
import type { SseEvent } from "@/types/api";

const citations = 'event: citations\ndata: [{"n":1}]\n\n';
const token = 'event: token\ndata: {"text":"Hi [1]"}\n\n';
const done = "event: done\ndata: {}\n\n";

describe("createSseParser", () => {
  it("parses multiple events in one chunk", () => {
    const parse = createSseParser();
    expect(parse(citations + token + done)).toEqual([
      { event: "citations", data: [{ n: 1 }] },
      { event: "token", data: { text: "Hi [1]" } },
      { event: "done", data: {} },
    ]);
  });

  it("joins an event split across chunks at any point", () => {
    const text = token + done;
    for (let cut = 1; cut < text.length; cut++) {
      const parse = createSseParser();
      const events = [...parse(text.slice(0, cut)), ...parse(text.slice(cut))];
      expect(events).toEqual([
        { event: "token", data: { text: "Hi [1]" } },
        { event: "done", data: {} },
      ]);
    }
  });

  it("returns nothing until the blank line arrives", () => {
    const parse = createSseParser();
    expect(parse('event: token\ndata: {"text":"a"}\n')).toEqual([]);
    expect(parse("\n")).toEqual([{ event: "token", data: { text: "a" } }]);
  });

  it("handles CRLF line endings, no space after the colon and comments", () => {
    const parse = createSseParser();
    expect(parse(': ping\r\n\r\nevent:token\r\ndata:{"text":"x"}\r\n\r\n')).toEqual([
      { event: "token", data: { text: "x" } },
    ]);
  });

  it("keeps newlines inside the JSON text", () => {
    const parse = createSseParser();
    expect(parse('event: token\ndata: {"text":"a\\n\\nb"}\n\n')).toEqual([
      { event: "token", data: { text: "a\n\nb" } },
    ]);
  });

  it("throws a StreamError for data that is not JSON", () => {
    const parse = createSseParser();
    expect(() => parse("event: token\ndata: {oops\n\n")).toThrow(StreamError);
  });

  it("skips unknown events", () => {
    const parse = createSseParser();
    expect(parse("event: ping\ndata: {}\n\n" + done)).toEqual([{ event: "done", data: {} }]);
  });
});

describe("readSse", () => {
  it("decodes a byte stream with a multi-byte char split across chunks", async () => {
    const bytes = new TextEncoder().encode('event: token\ndata: {"text":"₹ 5"}\n\n');
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, 27));
        controller.enqueue(bytes.slice(27));
        controller.close();
      },
    });
    const events: SseEvent[] = [];
    for await (const event of readSse(body)) events.push(event);
    expect(events).toEqual([{ event: "token", data: { text: "₹ 5" } }]);
  });
});
