import { ArrowUp } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { AnswerView } from "@/components/AnswerView";
import { CitationCard } from "@/components/CitationCard";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { QUERY_MAX_CHARS } from "@/constants";
import { applyEvent, isNotFound, newAnswer, type Answer } from "@/lib/answer";
import { ApiError } from "@/lib/apiClient";
import { streamQuery } from "@/lib/query";
import { StreamError } from "@/lib/sse";

const HIGHLIGHT_MS = 2000;

function errorMessage(err: unknown): string {
  if (err instanceof ApiError || err instanceof StreamError) return err.message;
  return "Could not reach the server. Try again.";
}

export function AskPage() {
  const [input, setInput] = useState("");
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [active, setActive] = useState<number | null>(null);
  const controller = useRef<AbortController | null>(null);
  const highlightTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(
    () => () => {
      controller.current?.abort();
      clearTimeout(highlightTimer.current);
    },
    [],
  );

  const query = input.trim();
  const canAsk = query.length > 0 && query.length <= QUERY_MAX_CHARS;

  async function ask() {
    if (!canAsk) return;
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setActive(null);
    setInput("");
    setAnswer(newAnswer(query));
    try {
      await streamQuery(query, current.signal, (event) => {
        if (!current.signal.aborted) setAnswer((prev) => prev && applyEvent(prev, event));
      });
    } catch (err) {
      if (current.signal.aborted) return;
      setAnswer((prev) => prev && { ...prev, status: "error", error: errorMessage(err) });
    }
  }

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

  function onCite(n: number) {
    document.getElementById(`citation-${n}`)?.scrollIntoView?.({
      behavior: "smooth",
      block: "nearest",
    });
    setActive(n);
    clearTimeout(highlightTimer.current);
    highlightTimer.current = setTimeout(() => setActive(null), HIGHLIGHT_MS);
  }

  const form = (
    <form onSubmit={onSubmit} className="relative w-full">
      <Textarea
        aria-label="Question"
        placeholder="Ask anything about your saved notes and links..."
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={onKeyDown}
        maxLength={QUERY_MAX_CHARS}
        rows={answer ? 1 : 3}
        className="max-h-48 resize-none bg-background pr-12 shadow-sm"
      />
      <Button
        type="submit"
        size="icon-sm"
        aria-label="Ask"
        disabled={!canAsk}
        className="absolute right-2 bottom-2 rounded-full"
      >
        <ArrowUp />
      </Button>
      {input.length > QUERY_MAX_CHARS * 0.9 && (
        <p className="mt-1 text-right text-xs text-muted-foreground">
          {input.length} / {QUERY_MAX_CHARS}
        </p>
      )}
    </form>
  );

  if (!answer) {
    return (
      <div className="flex min-h-[60svh] flex-col items-center justify-center gap-6">
        <h1 className="text-3xl font-semibold">What do you want to know?</h1>
        <div className="w-full max-w-2xl">{form}</div>
      </div>
    );
  }

  return (
    <div className="flex min-h-[calc(100svh-6rem)] flex-col gap-6">
      <div className="flex flex-1 flex-col gap-6">
        <h1 className="text-2xl font-semibold break-words">{answer.question}</h1>
        {answer.citations && answer.citations.length > 0 && !isNotFound(answer) && (
          <section aria-label="Sources" className="flex flex-col gap-2">
            <h2 className="text-sm font-medium text-muted-foreground">Sources</h2>
            <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {answer.citations.map((citation) => (
                <CitationCard key={citation.n} citation={citation} active={active === citation.n} />
              ))}
            </ol>
          </section>
        )}
        <AnswerView answer={answer} onCite={onCite} />
      </div>
      <div className="sticky bottom-0 bg-background pt-2 pb-4">{form}</div>
    </div>
  );
}
