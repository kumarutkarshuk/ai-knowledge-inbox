import { AnswerView } from "@/components/AnswerView";
import { CitationCard } from "@/components/CitationCard";
import { citationId, isNotFound, type Answer } from "@/lib/answer";

interface Props {
  turn: Answer;
  activeN: number | null;
  onCite: (n: number) => void;
}

export function ChatTurn({ turn, activeN, onCite }: Props) {
  const citations = turn.citations ?? [];
  return (
    <article
      id={`turn-${turn.id}`}
      aria-label={turn.question}
      className="flex scroll-mt-20 flex-col gap-4"
    >
      <h2 className="text-2xl font-semibold break-words">{turn.question}</h2>
      {citations.length > 0 && !isNotFound(turn) && (
        <section aria-label="Sources" className="flex flex-col gap-2">
          <h3 className="text-sm font-medium text-muted-foreground">Sources</h3>
          <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {citations.map((citation) => (
              <CitationCard
                key={citation.n}
                id={citationId(turn.id, citation.n)}
                citation={citation}
                active={activeN === citation.n}
              />
            ))}
          </ol>
        </section>
      )}
      <AnswerView answer={turn} onCite={onCite} />
    </article>
  );
}
