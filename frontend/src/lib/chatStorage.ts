import { CHAT_MAX_TURNS } from "@/constants";
import { isPending, type Answer } from "@/lib/answer";

const CHAT_KEY = "chat";
const STATUSES = new Set(["loading", "streaming", "done", "error"]);

export const STOPPED_MESSAGE = "Stopped before the answer finished.";

function isTurn(value: unknown): value is Answer {
  if (typeof value !== "object" || value === null) return false;
  const turn = value as Answer;
  return (
    typeof turn.id === "string" &&
    typeof turn.question === "string" &&
    typeof turn.text === "string" &&
    STATUSES.has(turn.status) &&
    (turn.citations === null || Array.isArray(turn.citations))
  );
}

export function stopTurn(turn: Answer): Answer {
  return { ...turn, status: "error", error: STOPPED_MESSAGE };
}

export function loadChat(): Answer[] {
  try {
    const turns: unknown = JSON.parse(localStorage.getItem(CHAT_KEY) ?? "[]");
    if (!Array.isArray(turns)) return [];
    return turns.filter(isTurn).map((turn) => (isPending(turn) ? stopTurn(turn) : turn));
  } catch {
    return [];
  }
}

export function saveChat(turns: Answer[]): void {
  try {
    if (turns.length === 0) localStorage.removeItem(CHAT_KEY);
    else localStorage.setItem(CHAT_KEY, JSON.stringify(turns.slice(-CHAT_MAX_TURNS)));
  } catch {
    return;
  }
}
