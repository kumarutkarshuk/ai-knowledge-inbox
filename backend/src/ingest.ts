import { createHash } from "node:crypto";
import { NOTE_TITLE_FALLBACK_CHARS } from "./constants.js";
import type { KnowledgeBaseRow } from "./db.js";

export function normalizeUrl(url: string): string {
  const parsed = new URL(url);
  parsed.hash = "";
  if (parsed.pathname !== "/") parsed.pathname = parsed.pathname.replace(/\/+$/, "") || "/";
  return parsed.toString();
}

export function hashNote(content: string): string {
  return createHash("sha256").update(content.trim()).digest("hex");
}

export function noteTitle(content: string, title?: string): string {
  return title?.trim() || content.trim().slice(0, NOTE_TITLE_FALLBACK_CHARS);
}

export type ExistingItem = Pick<KnowledgeBaseRow, "status" | "deleted_at">;

export type IngestDecision = "INSERT" | "CONFLICT" | "RESTORE" | "RESTORE_AND_REQUEUE";

export function decideIngest(existing: ExistingItem | undefined): IngestDecision {
  if (!existing) return "INSERT";
  if (existing.deleted_at === null) return "CONFLICT";
  return existing.status === "FAILED" ? "RESTORE_AND_REQUEUE" : "RESTORE";
}
