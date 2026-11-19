import { ArrowUp, Info } from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { useOutletContext } from "react-router";
import { ChatTurn } from "@/components/ChatTurn";
import type { LayoutContext } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { QUERY_MAX_CHARS } from "@/constants";
import { applyEvent, citationId, isPending, newAnswer, type Answer } from "@/lib/answer";
import { ApiError } from "@/lib/apiClient";
import { loadChat, saveChat } from "@/lib/chatStorage";
import { streamQuery } from "@/lib/query";
import { StreamError } from "@/lib/sse";
import { useFollowScroll } from "@/lib/useFollowScroll";

const HIGHLIGHT_MS = 2000;

export const NO_HISTORY_WARNING =
  "Each question is answered on its own. Earlier messages are not sent to the AI. The chat is saved only in this browser.";

interface Highlight {
  turnId: string;
  n: number;
}

function errorMessage(err: unknown): string {
  if (err instanceof ApiError || err instanceof StreamError) return err.message;
  return "Could not reach the server. Try again.";
}

export function AskPage() {
  const [input, setInput] = useState("");
  const [turns, setTurns] = useState<Answer[]>(loadChat);
  const [active, setActive] = useState<Highlight | null>(null);
  const controller = useRef<AbortController | null>(null);
  const highlightTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(
    () => () => {
      controller.current?.abort();
      clearTimeout(highlightTimer.current);
    },
    [],
  );

  useEffect(() => {
    if (!turns.some((turn) => turn.status === "streaming")) saveChat(turns);
  }, [turns]);

  const followScroll = useFollowScroll(turns);

  const query = input.trim();
  const busy = turns.some(isPending);
  const layout = useOutletContext<LayoutContext | undefined>();
  const setAnswering = layout?.setAnswering;
  const setClearChat = layout?.setClearChat;
  useEffect(() => {
    setAnswering?.(busy);
    return () => setAnswering?.(false);
  }, [busy, setAnswering]);
  const canAsk = !busy && query.length > 0 && query.length <= QUERY_MAX_CHARS;

  function updateTurn(id: string, change: (turn: Answer) => Answer) {
    setTurns((prev) => prev.map((turn) => (turn.id === id ? change(turn) : turn)));
  }

  async function ask() {
    if (!canAsk) return;
    const current = new AbortController();
    controller.current = current;
    const turn = newAnswer(query);
    setActive(null);
    setInput("");
    followScroll.resume();
    setTurns((prev) => [...prev, turn]);
    try {
      await streamQuery(query, current.signal, (event) => {
        if (!current.signal.aborted) updateTurn(turn.id, (t) => applyEvent(t, event));
      });
    } catch (err) {
      if (current.signal.aborted) return;
      updateTurn(turn.id, (t) => ({ ...t, status: "error", error: errorMessage(err) }));
    }
  }

  const clearChat = useCallback(() => {
    if (!window.confirm("Clear the whole chat?")) return;
    controller.current?.abort();
    setActive(null);
    setTurns([]);
  }, []);

  const hasTurns = turns.length > 0;
  useEffect(() => {
    setClearChat?.(hasTurns ? clearChat : null);
    return () => setClearChat?.(null);
  }, [hasTurns, clearChat, setClearChat]);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void ask();
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void ask();
    }
  }

  function onCite(turnId: string, n: number) {
    document.getElementById(citationId(turnId, n))?.scrollIntoView?.({
      behavior: "smooth",
      block: "nearest",
    });
    setActive({ turnId, n });
    clearTimeout(highlightTimer.current);
    highlightTimer.current = setTimeout(() => setActive(null), HIGHLIGHT_MS);
  }

  const form = (
    <form onSubmit={onSubmit} className="flex w-full flex-col gap-2">
      <div className="relative">
        <Textarea
          aria-label="Question"
          placeholder="Ask anything about your saved notes and links..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          maxLength={QUERY_MAX_CHARS}
          rows={turns.length ? 1 : 3}
          className="max-h-48 resize-none py-3 pr-14 text-[1.0625rem]"
        />
        <Button
          type="submit"
          size="icon-sm"
          aria-label="Ask"
          disabled={!canAsk}
          className="absolute right-2 bottom-2"
        >
          <ArrowUp />
        </Button>
      </div>
      <div className="flex items-start gap-3 text-sm text-muted-foreground">
        <p role="note" className="flex flex-1 items-start gap-1">
          <Info aria-hidden className="mt-1 size-3.5 shrink-0" />
          {NO_HISTORY_WARNING}
        </p>
        {input.length > QUERY_MAX_CHARS * 0.9 && (
          <span className="font-figure whitespace-nowrap tabular-nums">
            {input.length} / {QUERY_MAX_CHARS}
          </span>
        )}
      </div>
    </form>
  );

  if (turns.length === 0) {
    return (
      <div className="mx-auto flex min-h-[55svh] w-full max-w-2xl flex-col justify-center gap-6">
        <h1 className="text-3xl">What do you want to know?</h1>
        {form}
      </div>
    );
  }

  return (
    <div className="flex min-h-[calc(100svh-9rem)] flex-col">
      <h1 className="sr-only">Chat</h1>
      <div className="flex flex-1 flex-col divide-y divide-hairline">
        {turns.map((turn) => (
          <ChatTurn
            key={turn.id}
            turn={turn}
            activeN={active?.turnId === turn.id ? active.n : null}
            onCite={(n) => onCite(turn.id, n)}
          />
        ))}
      </div>
      <div className="sticky bottom-0 z-(--z-sticky) border-t border-hairline bg-background pt-4 pb-4">
        {form}
      </div>
    </div>
  );
}
