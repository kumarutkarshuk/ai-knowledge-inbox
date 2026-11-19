import type { Response } from "express";
import type { SseEvent } from "./types/api.js";

export function openSse(res: Response): void {
  res.status(200).set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();
}

export function formatSse({ event, data }: SseEvent): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export function writeSse(res: Response, event: SseEvent): void {
  if (!res.writableEnded && !res.destroyed) res.write(formatSse(event));
}
