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
      className="grid scroll-mt-28 grid-cols-[minmax(0,1fr)] gap-6 py-8 first:pt-2 lg:grid-cols-[minmax(0,1fr)_18rem] lg:gap-x-10"
    >
      <h2 className="text-2xl break-words lg:col-span-2">{turn.question}</h2>
      {citations.length > 0 && !isNotFound(turn) && (
        <section
          aria-label="Sources"
          className="flex flex-col gap-2 lg:sticky lg:top-24 lg:col-start-2 lg:row-start-2 lg:self-start lg:border-l lg:border-hairline lg:pl-6"
        >
          <h3 className="font-sans text-sm font-medium tracking-normal text-muted-foreground">
            Sources
          </h3>
          <ol className="-mx-3 grid gap-x-6 sm:grid-cols-2 lg:grid-cols-1">
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
      <div className="min-w-0 lg:col-start-1 lg:row-start-2">
        <AnswerView answer={turn} onCite={onCite} />
      </div>
    </article>
  );
}
