import { apiFetch } from "@/lib/apiClient";
import { readSse, StreamError } from "@/lib/sse";
import type { SseEvent } from "@/types/api";

export async function streamQuery(
  query: string,
  signal: AbortSignal,
  onEvent: (event: SseEvent) => void,
): Promise<void> {
  const res = await apiFetch("/query", {
    method: "POST",
    body: JSON.stringify({ query }),
    signal,
  });
  if (!res.body) throw new StreamError("Empty response from the server");
  for await (const event of readSse(res.body)) {
    if (event.event === "error") throw new StreamError(event.data.message);
    onEvent(event);
    if (event.event === "done") return;
  }
  throw new StreamError("The answer stopped early. Try again.");
}
