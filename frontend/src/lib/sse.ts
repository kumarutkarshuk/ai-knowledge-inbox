import type { SseEvent } from "@/types/api";

export class StreamError extends Error {}

const EVENT_NAMES = new Set<string>(["citations", "token", "done", "error"]);

function parseBlock(block: string): SseEvent | null {
  let event = "message";
  const data: string[] = [];
  for (const line of block.split("\n")) {
    if (!line || line.startsWith(":")) continue;
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") event = value;
    if (field === "data") data.push(value);
  }
  if (!EVENT_NAMES.has(event) || data.length === 0) return null;
  try {
    return { event, data: JSON.parse(data.join("\n")) } as SseEvent;
  } catch {
    throw new StreamError("Invalid response from the server");
  }
}

export function createSseParser() {
  let buffer = "";
  return (chunk: string): SseEvent[] => {
    buffer = (buffer + chunk).replace(/\r\n?/g, "\n");
    const blocks = buffer.split("\n\n");
    buffer = blocks.pop() ?? "";
    return blocks.map(parseBlock).filter((e): e is SseEvent => e !== null);
  };
}

export async function* readSse(body: ReadableStream<Uint8Array>): AsyncGenerator<SseEvent> {
  const parse = createSseParser();
  const decoder = new TextDecoder();
  const reader = body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      yield* parse(decoder.decode(value, { stream: true }));
    }
  } finally {
    reader.cancel().catch(() => undefined);
  }
}
