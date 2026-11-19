import { createContext, useContext, type ComponentProps } from "react";
import Markdown, { type Components } from "react-markdown";
import { isNotFound, type Answer } from "@/lib/answer";
import { citationNumber, remarkCitations } from "@/lib/citations";

const MARKDOWN_CLASS =
  "text-sm leading-relaxed [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_h1]:font-semibold [&_h2]:font-semibold [&_h3]:font-semibold [&_li]:my-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-2 [&_pre]:overflow-x-auto [&_ul]:list-disc [&_ul]:pl-5";

const CiteContext = createContext<(n: number) => void>(() => undefined);

function MarkdownLink({ href, children }: ComponentProps<"a">) {
  const onCite = useContext(CiteContext);
  const n = citationNumber(href);
  if (n === null) {
    return (
      <a href={href} target="_blank" rel="noreferrer" className="underline underline-offset-4">
        {children}
      </a>
    );
  }
  return (
    <button
      type="button"
      aria-label={`Citation ${n}`}
      onClick={() => onCite(n)}
      className="mx-0.5 inline-flex size-5 items-center justify-center rounded-full bg-muted align-text-top text-xs font-medium hover:bg-primary hover:text-primary-foreground"
    >
      {n}
    </button>
  );
}

const COMPONENTS: Components = { a: MarkdownLink };

export function AnswerView({ answer, onCite }: { answer: Answer; onCite: (n: number) => void }) {
  return (
    <div className="flex flex-col gap-4">
      {answer.status === "loading" && (
        <p role="status" className="text-sm text-muted-foreground">
          {answer.citations ? "Writing the answer..." : "Searching your saved items..."}
        </p>
      )}
      {isNotFound(answer) ? (
        <p className="text-muted-foreground italic">{answer.text}</p>
      ) : (
        answer.text && (
          <div data-testid="answer" className={MARKDOWN_CLASS}>
            <CiteContext value={onCite}>
              <Markdown
                components={COMPONENTS}
                remarkPlugins={[remarkCitations(answer.citations?.length ?? 0)]}
                disallowedElements={["img"]}
              >
                {answer.text}
              </Markdown>
            </CiteContext>
          </div>
        )
      )}
      {answer.error && (
        <p role="alert" className="text-sm text-destructive">
          {answer.error}
        </p>
      )}
    </div>
  );
}
