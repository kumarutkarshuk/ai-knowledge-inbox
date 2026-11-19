import { JINA_READER_URL, URL_CONTENT_MAX_CHARS } from "../constants.js";
import { withTimeout } from "../rag/timeout.js";

function clean(value: unknown): string {
  return typeof value === "string" ? value.replaceAll("\u0000", "") : "";
}

interface JinaReaderResponse {
  data?: { title?: unknown; content?: unknown };
}

export async function extractUrl(
  url: string,
  apiKey: string,
  signal?: AbortSignal,
): Promise<{ title: string | null; content: string }> {
  const res = await fetch(`${JINA_READER_URL}${url}`, {
    headers: { Accept: "application/json", Authorization: `Bearer ${apiKey}` },
    signal: withTimeout(signal),
  });
  if (!res.ok) throw new Error(`Jina Reader failed with HTTP ${res.status}`);
  const { data } = (await res.json()) as JinaReaderResponse;
  const content = clean(data?.content);
  if (!content.trim()) throw new Error("No text content found");
  const title = clean(data?.title).trim() || null;
  return { title, content: content.slice(0, URL_CONTENT_MAX_CHARS) };
}
