import { NOT_FOUND_ANSWER } from "@/constants";
import type { Citation, SseEvent } from "@/types/api";

export interface Answer {
  id: string;
  question: string;
  citations: Citation[] | null;
  text: string;
  status: "loading" | "streaming" | "done" | "error";
  error: string | null;
}

export function newAnswer(question: string): Answer {
  return {
    id: crypto.randomUUID(),
    question,
    citations: null,
    text: "",
    status: "loading",
    error: null,
  };
}

export function applyEvent(answer: Answer, event: SseEvent): Answer {
  if (event.event === "citations") return { ...answer, citations: event.data };
  if (event.event === "token") {
    return { ...answer, status: "streaming", text: answer.text + event.data.text };
  }
  if (event.event === "done") return { ...answer, status: "done" };
  return answer;
}

export function isNotFound(answer: Answer): boolean {
  return answer.status === "done" && answer.text.trim() === NOT_FOUND_ANSWER;
}

export function isPending(answer: Answer): boolean {
  return answer.status === "loading" || answer.status === "streaming";
}

export function citationId(turnId: string, n: number): string {
  return `citation-${turnId}-${n}`;
}
