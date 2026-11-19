import { afterEach, describe, expect, it } from "vitest";
import { CHAT_MAX_TURNS } from "@/constants";
import { newAnswer } from "@/lib/answer";
import { loadChat, saveChat, STOPPED_MESSAGE } from "@/lib/chatStorage";

afterEach(() => {
  localStorage.clear();
});

describe("chat storage", () => {
  it("keeps only the latest turns", () => {
    const turns = Array.from({ length: CHAT_MAX_TURNS + 5 }, (_, i) => ({
      ...newAnswer(`q${i}`),
      status: "done" as const,
    }));
    saveChat(turns);
    const loaded = loadChat();
    expect(loaded).toHaveLength(CHAT_MAX_TURNS);
    expect(loaded[0]?.question).toBe("q5");
  });

  it("marks unfinished turns as stopped and drops invalid ones", () => {
    localStorage.setItem("chat", JSON.stringify([newAnswer("open"), { question: 5 }, null]));
    expect(loadChat()).toEqual([
      expect.objectContaining({ question: "open", status: "error", error: STOPPED_MESSAGE }),
    ]);
  });

  it("removes the key for an empty chat", () => {
    saveChat([{ ...newAnswer("q"), status: "done" }]);
    saveChat([]);
    expect(localStorage.getItem("chat")).toBeNull();
  });
});
